// /api/cases/history
// GET  ?no=XXXX                 → 列出該編號的覆蓋歷史（新→舊）
// GET  ?id=N                    → 看單筆歷史 row
// POST { history_id: N }        → 還原：把該歷史 snapshot 寫回 cases，原本的最新版本再進歷史

export async function onRequestGet({ env, request }) {
  if (!env.DB) return json({ ok: false, err: 'DB not bound' }, 500);
  const url = new URL(request.url);
  const no = url.searchParams.get('no');
  const id = url.searchParams.get('id');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500);

  try {
    if (id) {
      const r = await env.DB
        .prepare('SELECT * FROM cases_history WHERE id = ?')
        .bind(parseInt(id, 10))
        .first();
      if (!r) return json({ ok: false, err: 'history not found' }, 404);
      return json({ ok: true, row: r, snapshot: safeParse(r.snapshot_json) });
    }
    if (!no) return json({ ok: false, err: 'need no or id' }, 400);
    const { results } = await env.DB
      .prepare('SELECT id, case_id, no, replaced_at, reason FROM cases_history WHERE no = ? ORDER BY id DESC LIMIT ?')
      .bind(no, limit)
      .all();
    return json({ ok: true, no, rows: results, count: results.length });
  } catch (e) {
    return json({ ok: false, err: e.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, err: 'DB not bound' }, 500);
  let body;
  try { body = await request.json(); }
  catch (e) { return json({ ok: false, err: 'invalid JSON' }, 400); }

  const historyId = parseInt(body.history_id, 10);
  if (!historyId) return json({ ok: false, err: 'need history_id' }, 400);

  try {
    const hist = await env.DB
      .prepare('SELECT * FROM cases_history WHERE id = ?')
      .bind(historyId)
      .first();
    if (!hist) return json({ ok: false, err: 'history not found' }, 404);

    const snap = safeParse(hist.snapshot_json);
    if (!snap || !snap.no) return json({ ok: false, err: 'snapshot corrupted' }, 500);

    // 還原前先把當前最新版本也存進歷史（reason='restore'）
    const current = await env.DB
      .prepare('SELECT * FROM cases WHERE no = ?')
      .bind(snap.no)
      .first();

    /* v0.3.6 M5：冪等保護 — 若 current 與 snapshot 內容已相同，直接 return 不重寫 history */
    if (current) {
      const compareKeys = ['mode','name','consult','birth','id_no','sex','target','sample_date','reason','unit','send_date'];
      const same = compareKeys.every(k => (current[k] || null) === (snap[k] || null));
      if (same) {
        return json({ ok: true, restored_no: snap.no, replaced_current: true, idempotent_skip: true });
      }
    }

    const stmts = [];
    if (current) {
      stmts.push(env.DB
        .prepare('INSERT INTO cases_history (case_id, no, snapshot_json, reason) VALUES (?,?,?,?)')
        .bind(current.id, current.no, JSON.stringify(current), 'restore'));
      stmts.push(env.DB.prepare(
        `UPDATE cases SET mode=?, name=?, consult=?, birth=?, id_no=?, sex=?, target=?,
           sample_date=?, reason=?, unit=?, send_date=?, source_file=?, apply_no=?,
           updated_at=strftime('%s','now')
         WHERE no=?`
      ).bind(
        snap.mode || 'named', snap.name || null, snap.consult || null,
        snap.birth || null, snap.id_no || null, snap.sex || null, snap.target || null,
        snap.sample_date || null, snap.reason || null, snap.unit || null,
        snap.send_date || null, snap.source_file || null, snap.apply_no || null,
        snap.no
      ));
    } else {
      stmts.push(env.DB.prepare(
        `INSERT INTO cases (no, mode, name, consult, birth, id_no, sex, target,
           sample_date, reason, unit, send_date, source_file, apply_no)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        snap.no, snap.mode || 'named', snap.name || null, snap.consult || null,
        snap.birth || null, snap.id_no || null, snap.sex || null, snap.target || null,
        snap.sample_date || null, snap.reason || null, snap.unit || null,
        snap.send_date || null, snap.source_file || null, snap.apply_no || null
      ));
    }
    await env.DB.batch(stmts);
    return json({ ok: true, restored_no: snap.no, replaced_current: !!current });
  } catch (e) {
    return json({ ok: false, err: e.message }, 500);
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
