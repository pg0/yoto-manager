import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sign, unsign } from './crypto.js';
import { config } from './config.js';

const SID = 'ym_sid'; // holds the signed Yoto user id (sub)
const OAUTH_STATE = 'ym_oauth_state';
const PKCE = 'ym_pkce'; // holds the signed PKCE code_verifier during login

const base = {
  httpOnly: true,
  sameSite: 'Lax' as const,
  secure: config.isProd,
  path: '/',
};

export function setSession(c: Context, userId: string) {
  setCookie(c, SID, sign(userId), { ...base, maxAge: 60 * 60 * 24 * 30 });
}

export function getSession(c: Context): string | null {
  const raw = getCookie(c, SID);
  return raw ? unsign(raw) : null;
}

export function clearSession(c: Context) {
  deleteCookie(c, SID, { path: '/' });
}

export function setOAuthState(c: Context, state: string) {
  setCookie(c, OAUTH_STATE, sign(state), { ...base, maxAge: 600 });
}

export function takeOAuthState(c: Context): string | null {
  const raw = getCookie(c, OAUTH_STATE);
  deleteCookie(c, OAUTH_STATE, { path: '/' });
  return raw ? unsign(raw) : null;
}

export function setPkceVerifier(c: Context, verifier: string) {
  setCookie(c, PKCE, sign(verifier), { ...base, maxAge: 600 });
}

export function takePkceVerifier(c: Context): string | null {
  const raw = getCookie(c, PKCE);
  deleteCookie(c, PKCE, { path: '/' });
  return raw ? unsign(raw) : null;
}
