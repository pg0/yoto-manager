import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { config } from './config.js';

const KEY = Buffer.from(config.tokenEncKey, 'hex');
if (KEY.length !== 32) {
  throw new Error('TOKEN_ENC_KEY must be 32 bytes of hex (64 hex chars).');
}

/** AES-256-GCM encrypt to `iv:tag:ciphertext` (all base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString('base64url')).join(':');
}

export function decrypt(blob: string): string {
  const [ivB, tagB, ctB] = blob.split(':');
  const iv = Buffer.from(ivB, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
}

// --- signed session cookie (HMAC-SHA256) ---
const SECRET = Buffer.from(config.sessionSecret);

export function sign(value: string): string {
  const mac = createHmac('sha256', SECRET).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function unsign(signed: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot < 0) return null;
  const value = signed.slice(0, dot);
  const mac = signed.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(value).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}

export const newId = () => randomBytes(16).toString('base64url');

// --- PKCE (RFC 7636, S256) for the public-client flow ---
/** A high-entropy code_verifier (43-128 chars, base64url). */
export const pkceVerifier = () => randomBytes(32).toString('base64url');
/** The S256 code_challenge derived from a verifier. */
export const pkceChallenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');
