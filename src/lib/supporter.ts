// Offline supporter-key verification (ECDSA P-256 + SHA-256, WebCrypto only,
// no network calls). TS port of C:\code\vibes\supporter-key\src\supporter.js -
// the crypto contract is fixed across every tool that embeds it, see
// C:\AI\context\patrick\kb\howto\supporter-key-integration.md. One keypair
// signs keys for every tool; the public key below is the shared value.
//
// Key format: PG1.<payloadB64url>.<sigB64url>
// Payload: base64url (no padding) of UTF-8 JSON {"v":1,"n":"<name>","d":"YYYY-MM-DD"}
// Signed bytes: the raw UTF-8 bytes of the payloadB64url STRING segment itself
// (never the decoded JSON - avoids canonicalization mismatches).

const SUPPORTER_PUBLIC_KEY_B64 =
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE+ZpcXXJzYzpTZx7LBzOqgtssV4agWJl7XAPEHtW7BBuz2FW3bjsdcfebnW8H0s5Gsa6OxlZ2PtqCFccqU9o0kg==';

export interface SupporterInfo {
  name: string;
  date: string;
}

export interface VerifyResult {
  valid: boolean;
  name?: string;
  date?: string;
}

function stdB64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return stdB64ToBytes(padded);
}

function utf8Encode(str: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(str);
}

function utf8DecodeStrict(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

let cachedKeyPromise: Promise<CryptoKey> | null = null;
function getPublicKey(): Promise<CryptoKey> {
  if (!cachedKeyPromise) {
    const spkiBytes = stdB64ToBytes(SUPPORTER_PUBLIC_KEY_B64);
    cachedKeyPromise = crypto.subtle.importKey(
      'spki',
      spkiBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  }
  return cachedKeyPromise;
}

/** Verify a `PG1.<payload>.<sig>` supporter key. Strict parsing - any
 *  malformed input or crypto failure resolves to `{ valid: false }`, never
 *  throws. */
export async function verifySupporterKey(keyString: string): Promise<VerifyResult> {
  try {
    if (typeof keyString !== 'string') return { valid: false };
    const parts = keyString.split('.');
    if (parts.length !== 3) return { valid: false };
    const [prefix, payloadB64url, sigB64url] = parts;
    if (prefix !== 'PG1') return { valid: false };
    if (!payloadB64url || !sigB64url) return { valid: false };

    const payloadJson = utf8DecodeStrict(b64urlToBytes(payloadB64url));
    const payload = JSON.parse(payloadJson) as { v?: number; n?: string; d?: string };
    if (
      !payload ||
      payload.v !== 1 ||
      typeof payload.n !== 'string' ||
      typeof payload.d !== 'string'
    ) {
      return { valid: false };
    }

    const sigBytes = b64urlToBytes(sigB64url);
    const dataBytes = utf8Encode(payloadB64url); // sign/verify the STRING segment itself
    const key = await getPublicKey();
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      sigBytes,
      dataBytes,
    );
    if (!ok) return { valid: false };
    return { valid: true, name: payload.n, date: payload.d };
  } catch {
    return { valid: false };
  }
}

/** Read a supporter key from `?key=` or `#key=` (query wins if both present). */
export function readSupporterUrlKey(): { key: string; fromHash: boolean } | null {
  try {
    const url = new URL(window.location.href);
    const k = url.searchParams.get('key');
    if (k) return { key: k, fromHash: false };
    if (window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const hk = hashParams.get('key');
      if (hk) return { key: hk, fromHash: true };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Strip `key` from the URL (query or hash, matching where it was read from)
 *  without a reload. */
export function stripSupporterUrlKey(fromHash: boolean): void {
  try {
    const url = new URL(window.location.href);
    if (fromHash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      hashParams.delete('key');
      const newHash = hashParams.toString();
      url.hash = newHash ? newHash : '';
    } else {
      url.searchParams.delete('key');
    }
    window.history.replaceState({}, '', url.toString());
  } catch {
    /* ignore */
  }
}
