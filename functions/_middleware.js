// 全站密碼保護（HTTP Basic Auth）
// 密碼從 Cloudflare Pages 環境變數 AUTH_PASS 讀取
// 設置：CF Dashboard → Pages → quick-input → Settings → 變數和祕密 → 新增 → Type=Secret, Name=AUTH_PASS, Value=你的密碼

export async function onRequest(context) {
  const { request, env, next } = context;
  const auth = request.headers.get('Authorization') || '';

  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(':');
      const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
      const expected = env.AUTH_PASS || '';
      if (expected && pass === expected) {
        return next();
      }
    } catch(_) {}
  }

  return new Response('需要登入 / Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="quick-input — 個資保護"',
      'content-type': 'text/plain; charset=utf-8'
    }
  });
}
