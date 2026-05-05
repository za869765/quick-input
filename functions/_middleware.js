// 全站登入保護 — Cookie session-based
// 密碼存 CF Pages 環境變數 AUTH_PASS
// Cookie 值是 SHA-256(AUTH_PASS + salt) 的 hex，httpOnly 防 XSS

const COOKIE_NAME = 'qi_auth';
const SALT = 'qi-2026-salt';

async function deriveToken(secret) {
  const data = new TextEncoder().encode(secret + ':' + SALT);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isAllowedPath(path) {
  // 登入頁與登入 API 不需要驗證
  return path === '/login.html' ||
         path === '/api/login' ||
         path === '/api/logout' ||
         path === '/favicon.ico';
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (isAllowedPath(path)) return next();

  // 檢查 cookie
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(COOKIE_NAME + '=([a-f0-9]+)'));
  if (m && env.AUTH_PASS) {
    try {
      const expected = await deriveToken(env.AUTH_PASS);
      if (m[1] === expected) return next();
    } catch(_) {}
  }

  // 未登入：API 回 401，網頁導向 login.html
  if (path.startsWith('/api/')) {
    return new Response(JSON.stringify({ ok: false, err: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
  }
  return Response.redirect(url.origin + '/login.html', 302);
}

// Export for login API to use
export { deriveToken, COOKIE_NAME };
