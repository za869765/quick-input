// /api/cases
// GET    ?prefix=11505&limit=50  → 查詢
// POST   { ... } 或 [{...}, ...]   → 新增/批次新增
// DELETE ?id=N or ?no=XXX          → 刪除

export async function onRequestGet({ env, request }) {
  if (!env.DB) return json({ ok: false, err: 'DB not bound' }, 500);
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
  const mode = url.searchParams.get('mode') || ''; // named/anon
  const q = url.searchParams.get('q') || ''; // 模糊搜尋姓名/身分證/編號

  let where = [];
  let binds = [];
  if (prefix) { where.push('no LIKE ?'); binds.push(prefix + '%'); }
  if (mode) { where.push('mode = ?'); binds.push(mode); }
  if (q) {
    where.push('(no LIKE ? OR name LIKE ? OR id_no LIKE ? OR consult LIKE ?)');
    const like = '%' + q + '%';
    binds.push(like, like, like, like);
  }
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

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ ok: false, err: 'DB not bound' }, 500);
  let body;
  try { body = await request.json(); }
  catch (e) { return json({ ok: false, err: 'invalid JSON' }, 400); }

  const rows = Array.isArray(body) ? body : [body];
  if (rows.length === 0) return json({ ok: false, err: 'empty payload' }, 400);
  if (rows.length > 1000) return json({ ok: false, err: 'too many rows (max 1000)' }, 400);

  const stmt = env.DB.prepare(
    `INSERT INTO cases (no, mode, name, consult, birth, id_no, sex, target,
      sample_date, reason, unit, send_date, source_file, apply_no)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const batch = rows.map(r => stmt.bind(
    String(r.no || '').trim(),
    r.mode || 'named',
    r.name || null,
    r.consult || null,
    r.birth || null,
    r.id || r.id_no || null,
    r.sex || null,
    r.target || null,
    r.sampleDate || r.sample_date || null,
    r.reason || null,
    r.unit || null,
    r.sendDate || r.send_date || null,
    r.source_file || null,
    r.apply_no || null
  ));

  try {
    const result = await env.DB.batch(batch);
    return json({ ok: true, inserted: rows.length, result: result.length });
  } catch (e) {
    return json({ ok: false, err: e.message }, 500);
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
