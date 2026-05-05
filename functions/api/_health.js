// GET /api/_health  — 連線測試
export async function onRequestGet({ env }) {
  try {
    if (!env.DB) {
      return json({ ok: false, dbBound: false, msg: 'D1 binding "DB" not configured' }, 200);
    }
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS cnt FROM cases').all();
    return json({
      ok: true,
      dbBound: true,
      caseCount: results[0]?.cnt ?? 0,
      time: new Date().toISOString()
    });
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
