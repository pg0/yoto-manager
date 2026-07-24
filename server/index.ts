import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { newId, pkceChallenge, pkceVerifier } from './crypto.js';
import { buildAuthorizeUrl, decodeIdToken, exchangeCode } from './oauth.js';
import {
  clearSession,
  getSession,
  setOAuthState,
  setPkceVerifier,
  setSession,
  takeOAuthState,
  takePkceVerifier,
} from './session.js';
import { accountInfo, getValidAccessToken, logout, saveTokens } from './store/index.js';

const app = new Hono();

// --- auth flow ---
app.get('/auth/login', (c) => {
  const state = newId();
  setOAuthState(c, state);
  if (config.authFlow === 'public-pkce') {
    const verifier = pkceVerifier();
    setPkceVerifier(c, verifier);
    return c.redirect(buildAuthorizeUrl(state, pkceChallenge(verifier)));
  }
  return c.redirect(buildAuthorizeUrl(state));
});

app.get('/auth/callback', async (c) => {
  const { code, state, error, error_description } = c.req.query();
  if (error) return c.text(`Yoto login error: ${error} ${error_description ?? ''}`, 400);
  const expected = takeOAuthState(c);
  const verifier = takePkceVerifier(c);
  if (!code || !state || !expected || state !== expected) {
    return c.text('Invalid OAuth state. Start again at /auth/login.', 400);
  }
  try {
    const tokens = await exchangeCode(code, verifier ?? undefined);
    // Prefer the id_token subject (needs the openid scope); fall back to the
    // access token, which is itself a JWT carrying `sub` for our API audience.
    const id = decodeIdToken(tokens.id_token);
    const at = decodeIdToken(tokens.access_token);
    const userId = id.sub ?? at.sub;
    if (!userId) return c.text('No subject in id_token or access_token.', 500);
    await saveTokens(userId, tokens, id.name ?? id.email ?? at.name ?? at.email);
    setSession(c, userId);
    return c.redirect(config.appOrigin);
  } catch (e) {
    return c.text(`Token exchange failed: ${(e as Error).message}`, 502);
  }
});

app.post('/auth/logout', async (c) => {
  const userId = getSession(c);
  if (userId) await logout(userId);
  clearSession(c);
  return c.json({ ok: true });
});

app.get('/api/me', async (c) => {
  const userId = getSession(c);
  if (!userId) return c.json({ authenticated: false });
  const info = await accountInfo(userId);
  return c.json({ authenticated: !!info, displayName: info?.displayName ?? null, userId });
});

// --- media proxy (same-origin audio so the browser can decode a waveform) ---
// Locked to yotoplay.com hosts; forwards Range for <audio> seeking.
app.get('/api/media', async (c) => {
  const userId = getSession(c);
  if (!userId) return c.json({ error: 'not-authenticated' }, 401);
  const target = c.req.query('url');
  if (!target) return c.text('missing url', 400);
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return c.text('bad url', 400);
  }
  if (u.protocol !== 'https:' || !/(^|\.)yotoplay\.com$/.test(u.hostname)) {
    return c.text('host not allowed', 403);
  }
  const range = c.req.header('range');
  const res = await fetch(u, { headers: range ? { range } : {} });
  const buf = await res.arrayBuffer();
  const headers: Record<string, string> = {
    'content-type': res.headers.get('content-type') ?? 'audio/mpeg',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
  };
  const cr = res.headers.get('content-range');
  if (cr) headers['content-range'] = cr;
  return new Response(buf, { status: res.status, headers });
});

// --- authenticated proxy to the Yoto API ---
// Anything under /api/yoto/* is forwarded to api.yotoplay.com with the caller's
// bearer token. The browser never sees a Yoto token.
app.all('/api/yoto/*', async (c) => {
  const userId = getSession(c);
  if (!userId) return c.json({ error: 'not-authenticated' }, 401);

  const path = c.req.path.replace(/^\/api\/yoto\//, '');
  const url = new URL(`${config.apiBase}/${path}`);
  url.search = new URL(c.req.url).search;

  const method = c.req.method;
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody ? await c.req.arrayBuffer() : undefined;

  async function forward(token: string) {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const ct = c.req.header('content-type');
    if (ct) headers['content-type'] = ct;
    return fetch(url, { method, headers, body: body ? Buffer.from(body) : undefined });
  }

  try {
    let token = await getValidAccessToken(userId);
    let res = await forward(token);
    if (res.status === 401) {
      // token rejected despite not being expired: force a rotation, retry once
      token = await getValidAccessToken(userId, true);
      res = await forward(token);
    }
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (e) {
    const msg = (e as Error).message;
    return c.json({ error: msg }, msg === 'not-authenticated' ? 401 : 502);
  }
});

// --- static SPA in prod (dev serves the SPA from Vite on APP_ORIGIN) ---
if (config.isProd && existsSync('./dist')) {
  app.use('/assets/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`yoto-manager backend on http://127.0.0.1:${info.port}`);
  console.log(`  login:  http://127.0.0.1:${info.port}/auth/login`);
  console.log(`  flow:   ${config.authFlow}`);
  console.log(`  store:  ${config.store}`);
});
