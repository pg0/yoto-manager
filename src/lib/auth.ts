// Client-side OAuth against Yoto's Auth0 tenant. There is no backend: the SPA
// runs the Authorization Code + PKCE flow itself, keeps the tokens in this
// browser, and calls api.yotoplay.com directly (every endpoint this app uses
// answers `Access-Control-Allow-Origin: *` and accepts an Authorization header).
//
// Tradeoff, deliberately taken: a refresh token in browser storage is readable
// by any script that gets injected into this origin. That is the standard
// public-client SPA posture (and the flow Yoto's own tooling uses), so the app
// ships no third-party scripts and everything lives in one bundle. Swap
// STORE for sessionStorage below to trade persistent sign-in for a smaller
// blast radius.

const env = import.meta.env;

export const AUTH_BASE = env.VITE_YOTO_AUTH_BASE ?? 'https://login.yotoplay.com';
export const API_BASE = env.VITE_YOTO_API_BASE ?? 'https://api.yotoplay.com';
const AUDIENCE = env.VITE_YOTO_AUDIENCE ?? 'https://api.yotoplay.com';
const CLIENT_ID = env.VITE_YOTO_CLIENT_ID ?? '';
const SCOPES =
  env.VITE_YOTO_SCOPES ??
  // family:devices:control is what the MQTT player channel authorises against -
  // without it the box connection is refused, everything else still works
  'openid profile user:content:view user:content:manage user:icons:manage family:devices:view family:devices:control offline_access';

/** Registered as an Allowed Callback URL in the Yoto dashboard. The directory
 *  the app is served from is used (not a /callback route) so plain static
 *  hosting needs no rewrite rule, and a subfolder deploy works unchanged. */
const redirectUri = () => location.origin + location.pathname.replace(/[^/]*$/, '');

const STORE = localStorage;
const SESSION_KEY = 'yoto-manager:auth:v1';
const PKCE_KEY = 'yoto-manager:pkce:v1'; // sessionStorage, lives only across the redirect

/** True when a client id is configured at build time; without one the app stays
 *  in local/demo mode and never offers a sign-in. */
export const AUTH_CONFIGURED = !!CLIENT_ID;

// --- base64url helpers -------------------------------------------------------

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + (norm.length % 4 ? '='.repeat(4 - (norm.length % 4)) : '');
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decode a JWT payload without verifying it - display name and subject only. */
function decodeJwt(token?: string): { sub?: string; name?: string; email?: string } {
  if (!token) return {};
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(token.split('.')[1])));
  } catch {
    return {};
  }
}

const randomB64 = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

// --- stored session ----------------------------------------------------------

interface StoredSession {
  accessToken: string;
  /** epoch ms; refreshed 60s early so a request never races the boundary */
  expiresAt: number;
  refreshToken?: string;
  userId?: string;
  displayName?: string;
}

function readSession(): StoredSession | null {
  try {
    const raw = STORE.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeSession(s: StoredSession) {
  try {
    STORE.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* storage full / blocked - session just won't survive a reload */
  }
}

export function clearSession() {
  try {
    STORE.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export interface SessionInfo {
  authenticated: boolean;
  displayName: string | null;
  userId: string | null;
}

export function currentSession(): SessionInfo {
  const s = readSession();
  if (!s) return { authenticated: false, displayName: null, userId: null };
  return {
    authenticated: true,
    displayName: s.displayName ?? null,
    userId: s.userId ?? null,
  };
}

// --- token endpoint ----------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as TokenResponse;
}

/** Persist a token response, carrying the old refresh token forward if Auth0
 *  returned none (rotation normally hands back a fresh single-use one). */
function persist(t: TokenResponse, prev?: StoredSession | null) {
  const id = decodeJwt(t.id_token);
  const at = decodeJwt(t.access_token);
  writeSession({
    accessToken: t.access_token,
    expiresAt: Date.now() + t.expires_in * 1000,
    refreshToken: t.refresh_token ?? prev?.refreshToken,
    userId: id.sub ?? at.sub ?? prev?.userId,
    displayName: id.name ?? id.email ?? prev?.displayName,
  });
}

// --- login / callback --------------------------------------------------------

/** Start the redirect flow. Never returns - the page navigates away. */
export async function login(): Promise<void> {
  if (!CLIENT_ID) throw new Error('VITE_YOTO_CLIENT_ID is not set in this build.');
  const verifier = randomB64(32);
  const state = randomB64(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  const challenge = b64url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  const params = new URLSearchParams({
    audience: AUDIENCE,
    scope: SCOPES,
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  location.assign(`${AUTH_BASE}/authorize?${params.toString()}`);
}

export type CallbackResult = { status: 'none' } | { status: 'signed-in' } | { status: 'error'; message: string };

/**
 * Complete the redirect if this page load is an OAuth callback. Always strips
 * `code`/`state`/`error` from the URL afterwards so a reload can't replay a
 * spent authorization code.
 */
export async function handleRedirectCallback(): Promise<CallbackResult> {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  const state = q.get('state');
  const error = q.get('error');
  if (!code && !error) return { status: 'none' };

  const stripUrl = () => history.replaceState({}, '', location.pathname + location.hash);

  if (error) {
    stripUrl();
    return { status: 'error', message: `${error}: ${q.get('error_description') ?? ''}`.trim() };
  }

  let stashed: { verifier?: string; state?: string } = {};
  try {
    stashed = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? '{}');
  } catch {
    /* ignore */
  }
  sessionStorage.removeItem(PKCE_KEY);
  stripUrl();

  if (!stashed.verifier || !state || state !== stashed.state) {
    return { status: 'error', message: 'Invalid OAuth state - start the sign-in again.' };
  }

  try {
    const t = await tokenRequest(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        code: code!,
        redirect_uri: redirectUri(),
        code_verifier: stashed.verifier,
        audience: AUDIENCE,
      }),
    );
    persist(t);
    return { status: 'signed-in' };
  } catch (e) {
    return { status: 'error', message: (e as Error).message };
  }
}

// --- access tokens -----------------------------------------------------------

/** 60s early-refresh margin so a request never races the expiry boundary. */
const SKEW_MS = 60_000;

/** One refresh in flight at a time: Yoto's refresh tokens are single-use, so two
 *  parallel refreshes would spend the same token twice and log the user out. */
let inflight: Promise<string> | null = null;

/**
 * A valid access token, refreshing (and rotating the refresh token) when needed.
 * `force` skips the cache to recover from a 401 on a not-yet-expired token.
 * Throws `not-authenticated` when there is no usable session.
 */
export function getAccessToken(force = false): Promise<string> {
  if (inflight) return inflight;

  const s = readSession();
  if (!s) return Promise.reject(new Error('not-authenticated'));
  if (!force && Date.now() < s.expiresAt - SKEW_MS) return Promise.resolve(s.accessToken);
  if (!s.refreshToken) {
    // no offline_access → the session simply ends when the access token expires
    if (Date.now() < s.expiresAt) return Promise.resolve(s.accessToken);
    clearSession();
    return Promise.reject(new Error('not-authenticated'));
  }

  const p = (async () => {
    try {
      const t = await tokenRequest(
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: s.refreshToken!,
          audience: AUDIENCE,
        }),
      );
      persist(t, s);
      return t.access_token;
    } catch (e) {
      // a rejected refresh token is terminal - drop the session so the UI can
      // fall back to demo mode and offer a fresh sign-in
      clearSession();
      throw e;
    }
  })().finally(() => {
    inflight = null;
  });

  inflight = p;
  return p;
}

/**
 * Authenticated call against the Yoto API. Takes a path (`content/mine`) or a
 * full URL, injects the bearer token, and retries once on a 401 after forcing a
 * token rotation. Returns a synthetic 401 instead of throwing when signed out,
 * so callers can treat "no session" like any other failed request.
 */
export async function yotoFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = /^https?:\/\//.test(path) ? path : `${API_BASE}/${path.replace(/^\/+/, '')}`;

  const call = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return new Response(JSON.stringify({ error: 'not-authenticated' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const res = await call(token);
  if (res.status !== 401) return res;
  try {
    return await call(await getAccessToken(true));
  } catch {
    return res;
  }
}
