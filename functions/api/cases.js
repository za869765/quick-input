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
    where.push('(no LIKE ? OR name LIKE ? OR id_no LIKE ? OR consult LIKE ?)');
    const like = '%' + q + '%';
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
  const noList = rows.map(r => r.no);
  let existingMap = new Map();
  try {
    const placeholders = noList.map(() => '?').join(',');
    const sel = await env.DB
      .prepare(`SELECT * FROM cases WHERE no IN (${placeholders})`)
      .bind(...noList)
      .all();
    for (const old of (sel.results || [])) {
      existingMap.set(old.no, old);
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

  let inserted = 0, updated = 0, snapshots = 0;
  for (const r of rows) {
    const old = existingMap.get(r.no);
    if (old) {
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
    await env.DB.batch(batchStmts);
    return json({
      ok: true,
      inserted,
      updated,
      snapshots,
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
    let stmt;
    if (id) stmt = env.DB.prepare('DELETE FROM cases WHERE id = ?').bind(parseInt(id, 10));
    else stmt = env.DB.prepare('DELETE FROM cases WHERE no = ?').bind(no);
    const r = await stmt.run();
    return json({ ok: true, changes: r.meta?.changes || 0 });
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
