// Node has no Storage; auth.ts grabs localStorage at import time and the store
// persists drafts to it, so give both a real in-memory implementation.
class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', { value: new MemStorage(), writable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: new MemStorage(), writable: true });
