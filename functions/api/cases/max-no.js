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
    // v0.3.5：只看 cases 表的 MAX（不 union cases_history）
    // → 刪除的編號會被下一筆「填回去」，保持序號連續、不跳號
    // 還原機制：list.html 歷史頁仍可從 cases_history reason='delete' 的 snapshot 還原
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
