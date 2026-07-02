// /api/cases
// GET    ?prefix=11505&limit=50  → 查詢
// POST   { ... } 或 [{...}, ...]   → UPSERT（新增或覆蓋；覆蓋前自動寫入 cases_history）
// DELETE ?id=N or ?no=XXX          → 刪除

export async function onRequestGet({ env, request }) {
  if (!env.DB) return json({ ok: false, err: 'DB not bound' }, 500);
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
  const mode = url.searchParams.get('mode') || ''; // named/anon
  const q = url.searchParams.get('q') || ''; // 模糊搜尋姓名/身分證/編號

  // v0.3.0：新增採檢日期區間 filter（民國格式字串可直接比較）
  const sampleFrom = url.searchParams.get('sample_date_from') || '';
  const sampleTo = url.searchParams.get('sample_date_to') || '';

  let where = [];
  let binds = [];
  if (prefix) { where.push('no LIKE ?'); binds.push(prefix + '%'); }
  if (mode) { where.push('mode = ?'); binds.push(mode); }
  if (q) {
    /* v0.3.7：escape LIKE 萬用字元 % _ \，避免使用者輸 % 拿到全部資料 */
    const escQ = String(q).replace(/[\\%_]/g, '\\$&');
    where.push("(no LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR id_no LIKE ? ESCAPE '\\' OR consult LIKE ? ESCAPE '\\')");
    const like = '%' + escQ + '%';
    binds.push(like, like, like, like);
  }
  if (sampleFrom) { where.push('sample_date >= ?'); binds.push(sampleFrom); }
  if (sampleTo) { where.push('sample_date <= ?'); binds.push(sampleTo); }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const sql = 'SELECT * FROM cases' + whereSql + ' ORDER BY no DESC LIMIT ?';
  binds.push(limit);

  try {
    const stmt = env.DB.prepare(sql).bind(...binds);
    const { results } = await stmt.all();
    return json({ ok: true, rows: results, count: results.length });
  } catch (e) {
    return json({ ok: false, err: e.message }, 500);
  }
}

// 把前端送來的 row 正規化成 cases 表的欄位物件
function normalize(r) {
  return {
    no: String(r.no || '').trim(),
    mode: r.mode || 'named',
    name: r.name || null,
    consult: r.consult || null,
    birth: r.birth || null,
    id_no: r.id || r.id_no || null,
    sex: r.sex || null,
    target: r.target || null,
    sample_date: r.sampleDate || r.sample_date || null,
    reason: r.reason || null,
    unit: r.unit || null,
    send_date: r.sendDate || r.send_date || null,
    source_file: r.source_file || null,
    apply_no: r.apply_no || null,
  };
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, err: 'DB not bound' }, 500);
  let body;
  try { body = await request.json(); }
  catch (e) { return json({ ok: false, err: 'invalid JSON' }, 400); }

  const raw = Array.isArray(body) ? body : [body];
  if (raw.length === 0) return json({ ok: false, err: 'empty payload' }, 400);
  if (raw.length > 1000) return json({ ok: false, err: 'too many rows (max 1000)' }, 400);

  const rows = raw.map(normalize).filter(r => r.no);
  if (rows.length === 0) return json({ ok: false, err: 'no valid rows (missing no)' }, 400);

  // v0.3.6 M4：同 batch 內若有重複 no 直接拒絕（避免 INSERT/UPDATE 混亂導致 D1 batch fail）
  const seenNo = new Set();
  const dups = [];
  for (const r of rows) {
    if (seenNo.has(r.no)) dups.push(r.no);
    else seenNo.add(r.no);
  }
  if (dups.length) {
    return json({ ok: false, err: '同批次重複編號：' + Array.from(new Set(dups)).join(', ') + '（請先去重再送）' }, 400);
  }

  // Phase 0：idempotent 自動建 cases_history 表（讓使用者不必手動跑 migration SQL）
  try {
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS cases_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER, no TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        replaced_at INTEGER DEFAULT (strftime('%s','now')),
        reason TEXT
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_history_no ON cases_history(no)`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_history_replaced_at ON cases_history(replaced_at)`),
    ]);
  } catch (e) {
    return json({ ok: false, err: 'history table init failed: ' + e.message }, 500);
  }

  // Phase 1：批次查既有 row（每筆編號）
  // v0.3.12：IN(...) 分塊 ≤90 — D1 限制每查詢最多 100 個綁定變數，
  // 一次送 335 筆會爆 too many SQL variables
  const noList = rows.map(r => r.no);
  let existingMap = new Map();
  try {
    for (let i = 0; i < noList.length; i += 90) {
      const part = noList.slice(i, i + 90);
      const placeholders = part.map(() => '?').join(',');
      const sel = await env.DB
        .prepare(`SELECT * FROM cases WHERE no IN (${placeholders})`)
        .bind(...part)
        .all();
      for (const old of (sel.results || [])) {
        existingMap.set(old.no, old);
      }
    }
  } catch (e) {
    return json({ ok: false, err: 'lookup failed: ' + e.message }, 500);
  }

  // Phase 2：組成 batch — 既有 → 寫 history + UPDATE；不存在 → INSERT
  const batchStmts = [];
  const insertStmt = env.DB.prepare(
    `INSERT INTO cases (no, mode, name, consult, birth, id_no, sex, target,
       sample_date, reason, unit, send_date, source_file, apply_no)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const updateStmt = env.DB.prepare(
    `UPDATE cases SET
       mode=?, name=?, consult=?, birth=?, id_no=?, sex=?, target=?,
       sample_date=?, reason=?, unit=?, send_date=?, source_file=?, apply_no=?,
       updated_at=strftime('%s','now')
     WHERE no=?`
  );
  const historyStmt = env.DB.prepare(
    `INSERT INTO cases_history (case_id, no, snapshot_json, reason)
     VALUES (?,?,?,?)`
  );

  /* v0.3.7 H3：UPSERT 冪等比對 — 若 incoming 與 existing 11 個關鍵欄位內容相同
     則 skip 整個寫入（不寫 history、不 UPDATE），避免網路 retry 時製造假 history snapshot */
  const _same = (old, r) => {
    return (old.mode || 'named') === (r.mode || 'named') &&
           (old.name || null) === (r.name || null) &&
           (old.consult || null) === (r.consult || null) &&
           (old.birth || null) === (r.birth || null) &&
           (old.id_no || null) === (r.id_no || null) &&
           (old.sex || null) === (r.sex || null) &&
           (old.target || null) === (r.target || null) &&
           (old.sample_date || null) === (r.sample_date || null) &&
           (old.reason || null) === (r.reason || null) &&
           (old.unit || null) === (r.unit || null) &&
           (old.send_date || null) === (r.send_date || null);
  };
  /* v0.3.8 H1：偵測「真實衝突」並重 allocate 新 no
     場景：A、B 兩端同時拿同一個 max-no → 各填不同人 → 後到的會撞到 existing。
     舊版會直接覆寫（UPDATE）後者覆蓋前者；新版改成 server 自動分配新 no 給後者，
     並在 response 帶 reallocations 通知前端更新 UI。
     冪等情況（同筆內容）走原本 _same skip 邏輯。 */
  const _isRealConflict = (old, r) => {
    const oldFilled = !!(old.name || old.id_no || old.consult);
    const newFilled = !!(r.name || r.id_no || r.consult);
    if (!oldFilled || !newFilled) return false; // 任一邊空殼 → 視為同步、非衝突
    const oldSig = (old.name || '') + '|' + (old.id_no || '') + '|' + (old.consult || '');
    const newSig = (r.name || '') + '|' + (r.id_no || '') + '|' + (r.consult || '');
    return oldSig !== newSig;
  };
  const reallocations = [];
  const newAllocated = new Set(); // 本批內已重 allocate 的 no，避免二次衝突
  for (const r of rows) {
    const old = existingMap.get(r.no);
    if (!old) continue;
    if (!_isRealConflict(old, r)) continue;
    const prefix = r.no.slice(0, -4);
    if (prefix.length === 0) continue;
    let maxSerial = 0;
    try {
      const sel = await env.DB.prepare(
        `SELECT MAX(CAST(SUBSTR(no, ?) AS INTEGER)) AS m FROM cases WHERE no LIKE ?`
      ).bind(prefix.length + 1, prefix + '%').all();
      maxSerial = (sel.results?.[0]?.m) || 0;
    } catch (e) {
      return json({ ok: false, err: 'reallocate lookup failed: ' + e.message }, 500);
    }
    let newSerial = maxSerial + 1;
    let newNo = prefix + String(newSerial).padStart(4, '0');
    /* v0.3.12：也要跳過本次 request 自己帶進來的編號（seenNo），
       否則重配的新號會撞到同批後面的列 → 同 batch 兩個 INSERT 同號 → UNIQUE 爆掉整批 rollback */
    while (newAllocated.has(newNo) || existingMap.has(newNo) || seenNo.has(newNo)) {
      newSerial++;
      newNo = prefix + String(newSerial).padStart(4, '0');
    }
    reallocations.push({ originalNo: r.no, newNo });
    r.no = newNo;
    newAllocated.add(newNo);
  }

  let inserted = 0, updated = 0, snapshots = 0, idempotentSkipped = 0;
  for (const r of rows) {
    const old = existingMap.get(r.no);
    if (old) {
      if (_same(old, r)) {
        /* 冪等 skip：incoming 與 existing 完全相同 → 不寫 history、不 UPDATE */
        idempotentSkipped++;
        continue;
      }
      // 寫舊版本快照
      batchStmts.push(historyStmt.bind(
        old.id, old.no, JSON.stringify(old), 'upsert'
      ));
      // 覆蓋更新
      batchStmts.push(updateStmt.bind(
        r.mode, r.name, r.consult, r.birth, r.id_no, r.sex, r.target,
        r.sample_date, r.reason, r.unit, r.send_date, r.source_file, r.apply_no,
        r.no
      ));
      updated++; snapshots++;
    } else {
      batchStmts.push(insertStmt.bind(
        r.no, r.mode, r.name, r.consult, r.birth, r.id_no, r.sex, r.target,
        r.sample_date, r.reason, r.unit, r.send_date, r.source_file, r.apply_no
      ));
      inserted++;
    }
  }

  try {
    /* v0.3.7：batchStmts 為空（全部 idempotent skip）時不需打 D1 */
    if (batchStmts.length) await env.DB.batch(batchStmts);
    return json({
      ok: true,
      inserted,
      updated,
      snapshots,
      idempotentSkipped,
      reallocations,
      total: rows.length,
    });
  } catch (e) {
    return json({ ok: false, err: 'write failed: ' + e.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ ok: false, err: 'DB not bound' }, 500);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const no = url.searchParams.get('no');
  if (!id && !no) return json({ ok: false, err: 'need id or no' }, 400);
  try {
    // v0.3.4：刪除前先寫一份 history snapshot（reason='delete'），讓誤刪可救回
    // 確保 cases_history 表存在（首次刪除時自動建）
    await env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS cases_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_id INTEGER, no TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        replaced_at INTEGER DEFAULT (strftime('%s','now')),
        reason TEXT
      )`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_history_no ON cases_history(no)`),
    ]);

    const old = id
      ? await env.DB.prepare('SELECT * FROM cases WHERE id = ?').bind(parseInt(id, 10)).first()
      : await env.DB.prepare('SELECT * FROM cases WHERE no = ?').bind(no).first();
    if (!old) return json({ ok: true, changes: 0, snapshot: false });

    const stmts = [
      env.DB.prepare('INSERT INTO cases_history (case_id, no, snapshot_json, reason) VALUES (?,?,?,?)')
        .bind(old.id, old.no, JSON.stringify(old), 'delete'),
      env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(old.id),
    ];
    const result = await env.DB.batch(stmts);
    const changes = result[1]?.meta?.changes || 0;
    return json({ ok: true, changes, snapshot: true, snapshot_no: old.no });
  } catch (e) {
    return json({ ok: false, err: e.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
