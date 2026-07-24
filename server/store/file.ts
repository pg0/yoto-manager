import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import type { TokenRecord, TokenStore } from './types.js';

/**
 * Dev-default store: a single encrypted-fields JSON file. Fine for local login
 * testing and single-box deploys; use the Postgres store for multi-instance.
 */
export class FileTokenStore implements TokenStore {
  private file = join(config.dataDir, 'tokens.json');
  private cache: Record<string, TokenRecord> | null = null;

  private async load(): Promise<Record<string, TokenRecord>> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      this.cache = {};
    }
    return this.cache!;
  }

  private async flush() {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf8');
    await rename(tmp, this.file); // atomic replace
  }

  async get(userId: string): Promise<TokenRecord | null> {
    return (await this.load())[userId] ?? null;
  }

  async put(rec: TokenRecord): Promise<void> {
    const db = await this.load();
    db[rec.userId] = rec;
    await this.flush();
  }

  async delete(userId: string): Promise<void> {
    const db = await this.load();
    delete db[userId];
    await this.flush();
  }
}
