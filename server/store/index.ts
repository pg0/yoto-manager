import { config } from '../config.js';
import { decrypt, encrypt } from '../crypto.js';
import { refresh as refreshTokens, type TokenResponse } from '../oauth.js';
import { FileTokenStore } from './file.js';
import { PostgresTokenStore } from './postgres.js';
import type { TokenRecord, TokenStore } from './types.js';

export const store: TokenStore =
  config.store === 'postgres' ? new PostgresTokenStore() : new FileTokenStore();

/** refresh in flight per user, so a single-use refresh token is never spent twice */
const inflight = new Map<string, Promise<string>>();

/** 60s early-refresh margin so a request never races the expiry boundary. */
const SKEW_MS = 60_000;

export async function saveTokens(userId: string, t: TokenResponse, displayName?: string) {
  if (!t.refresh_token) throw new Error('Yoto did not return a refresh_token (need offline_access scope).');
  const rec: TokenRecord = {
    userId,
    refreshEnc: encrypt(t.refresh_token),
    accessToken: t.access_token,
    accessExpiresAt: Date.now() + t.expires_in * 1000,
    displayName,
    updatedAt: Date.now(),
  };
  await store.put(rec);
}

/**
 * Return a valid access token, refreshing (and rotating the refresh token) if
 * needed. `force` skips the cache to recover from a 401 on a not-yet-expired token.
 */
export function getValidAccessToken(userId: string, force = false): Promise<string> {
  const existing = inflight.get(userId);
  if (existing) return existing;

  const p = (async () => {
    const rec = await store.get(userId);
    if (!rec) throw new Error('not-authenticated');
    if (!force && Date.now() < rec.accessExpiresAt - SKEW_MS) return rec.accessToken;

    const t = await refreshTokens(decrypt(rec.refreshEnc));
    const next: TokenRecord = {
      ...rec,
      // Yoto rotates: a new refresh_token comes back; keep the old only if absent.
      refreshEnc: t.refresh_token ? encrypt(t.refresh_token) : rec.refreshEnc,
      accessToken: t.access_token,
      accessExpiresAt: Date.now() + t.expires_in * 1000,
      updatedAt: Date.now(),
    };
    await store.put(next);
    return next.accessToken;
  })().finally(() => inflight.delete(userId));

  inflight.set(userId, p);
  return p;
}

export async function logout(userId: string) {
  await store.delete(userId);
}

export async function accountInfo(userId: string) {
  const rec = await store.get(userId);
  return rec ? { displayName: rec.displayName ?? null } : null;
}
