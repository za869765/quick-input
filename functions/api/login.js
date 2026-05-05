// POST /api/login  body: { password }
// 成功 → 設 httpOnly cookie，回 { ok: true }
// 失敗 → 401 { ok: false, err }

const COOKIE_NAME = 'qi_auth';
const SALT = 'qi-2026-salt';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

async function deriveToken(secret) {
  const data = new TextEncoder().encode(secret + ':' + SALT);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch (e) { return json({ ok: false, err: '無效格式' }, 400); }

  const pwd = (body.password || '').trim();
  const expected = (env.AUTH_PASS || '').trim();

  if (!expected) {
    return json({ ok: false, err: 'AUTH_PASS 未設定' }, 500);
  }
  if (!pwd || pwd !== expected) {
    return json({ ok: false, err: '密碼錯誤' }, 401);
  }

  const token = await deriveToken(expected);
  const cookie = `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'Set-Cookie': cookie
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}
