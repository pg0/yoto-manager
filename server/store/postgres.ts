import { config } from '../config.js';
import type { TokenRecord, TokenStore } from './types.js';

/**
 * Postgres store for prod / multi-instance. `pg` is imported lazily so local
 * dev (file store) never needs the dependency installed.
 */
export class PostgresTokenStore implements TokenStore {
  private pool: any;
  private ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init() {
    const { default: pg } = await import('pg');
    this.pool = new pg.Pool({ connectionString: config.databaseUrl });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS yoto_tokens (
        user_id           text PRIMARY KEY,
        refresh_enc       text NOT NULL,
        access_token      text NOT NULL,
        access_expires_at bigint NOT NULL,
        display_name      text,
        updated_at        bigint NOT NULL
      )
    `);
  }

  async get(userId: string): Promise<TokenRecord | null> {
    await this.ready;
    const { rows } = await this.pool.query('SELECT * FROM yoto_tokens WHERE user_id = $1', [userId]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      userId: r.user_id,
      refreshEnc: r.refresh_enc,
      accessToken: r.access_token,
      accessExpiresAt: Number(r.access_expires_at),
      displayName: r.display_name ?? undefined,
      updatedAt: Number(r.updated_at),
    };
  }

  async put(rec: TokenRecord): Promise<void> {
    await this.ready;
    await this.pool.query(
      `INSERT INTO yoto_tokens (user_id, refresh_enc, access_token, access_expires_at, display_name, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id) DO UPDATE SET
         refresh_enc = EXCLUDED.refresh_enc,
         access_token = EXCLUDED.access_token,
         access_expires_at = EXCLUDED.access_expires_at,
         display_name = EXCLUDED.display_name,
         updated_at = EXCLUDED.updated_at`,
      [rec.userId, rec.refreshEnc, rec.accessToken, rec.accessExpiresAt, rec.displayName ?? null, rec.updatedAt],
    );
  }

  async delete(userId: string): Promise<void> {
    await this.ready;
    await this.pool.query('DELETE FROM yoto_tokens WHERE user_id = $1', [userId]);
  }
}
