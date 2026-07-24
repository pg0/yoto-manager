/** Persisted per-user token record. Refresh token is stored encrypted. */
export interface TokenRecord {
  userId: string;
  /** encrypted refresh token (single-use, rotated on every refresh) */
  refreshEnc: string;
  /** plaintext access token cache + expiry (epoch ms); re-fetched on expiry */
  accessToken: string;
  accessExpiresAt: number;
  /** Yoto account label for the UI, best-effort */
  displayName?: string;
  updatedAt: number;
}

export interface TokenStore {
  get(userId: string): Promise<TokenRecord | null>;
  put(rec: TokenRecord): Promise<void>;
  delete(userId: string): Promise<void>;
}
