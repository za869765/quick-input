// POST /api/logout  → 清 cookie
export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'Set-Cookie': 'qi_auth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
    }
  });
}
export const onRequestGet = onRequestPost;
