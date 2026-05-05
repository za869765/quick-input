// GET /api/cases/max-no?prefix=1150505
// 回傳該 prefix 已用最大流水號 + 下一筆建議
export async function onRequestGet({ env, request }) {
  if (!env.DB) return json({ ok: false, err: 'DB not bound' }, 500);
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || '';
  if (!prefix) {
    return json({ ok: false, err: 'prefix required' }, 400);
  }
  try {
    // SUBSTR start position is 1-based; prefix.length+1 = first char after prefix
    const sql = `
      SELECT MAX(CAST(SUBSTR(no, ?) AS INTEGER)) AS max_serial
      FROM cases WHERE no LIKE ?
    `;
    const { results } = await env.DB.prepare(sql).bind(prefix.length + 1, prefix + '%').all();
    const maxSerial = results[0]?.max_serial || 0;
    return json({
      ok: true,
      prefix,
      maxSerial,
      nextSerial: maxSerial + 1,
      nextNo: prefix + String(maxSerial + 1).padStart(4, '0')
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
