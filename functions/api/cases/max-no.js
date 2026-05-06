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
    // v0.3.4：cases + cases_history 雙表取 MAX，避免被刪除的編號被重用
    //   - 沒寫過 history 的舊資料庫也安全（COALESCE 把 NULL 當 0）
    //   - cases_history 表不存在時走 catch，回退到只看 cases
    let maxFromCases = 0, maxFromHistory = 0;
    {
      const r = await env.DB.prepare(
        'SELECT MAX(CAST(SUBSTR(no, ?) AS INTEGER)) AS m FROM cases WHERE no LIKE ?'
      ).bind(prefix.length + 1, prefix + '%').all();
      maxFromCases = r.results?.[0]?.m || 0;
    }
    try {
      const r = await env.DB.prepare(
        'SELECT MAX(CAST(SUBSTR(no, ?) AS INTEGER)) AS m FROM cases_history WHERE no LIKE ?'
      ).bind(prefix.length + 1, prefix + '%').all();
      maxFromHistory = r.results?.[0]?.m || 0;
    } catch (_) { /* 表不存在就跳過 */ }
    const maxSerial = Math.max(maxFromCases, maxFromHistory);
    return json({
      ok: true,
      prefix,
      maxSerial,
      maxFromCases,
      maxFromHistory,
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
