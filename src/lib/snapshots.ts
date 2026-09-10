import type { RawCardFull } from './content';

// A copy of the card exactly as Yoto had it, taken right before every write.
// Lives in localStorage, so it survives a bad save even if the app is reloaded.
// The restore path (publish.ts restoreCard) POSTs one of these back verbatim.

const KEY = 'yoto-manager:snapshots:v1';
/** versions kept per card; older ones roll off */
export const SNAPSHOTS_PER_CARD = 5;

export interface Snapshot {
  /** ISO timestamp of when the copy was taken (just before the write) */
  at: string;
  card: RawCardFull;
}
type SnapshotStore = Record<string, Snapshot[]>;

function load(): SnapshotStore {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as SnapshotStore;
  } catch {
    return {};
  }
}

/** Write the store; on quota failure drop the oldest snapshot of the fullest
 *  card and retry, so a big library can't stop new snapshots being kept. */
function save(store: SnapshotStore) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
      return;
    } catch {
      const fullest = Object.keys(store).sort((a, b) => store[b].length - store[a].length)[0];
      if (!fullest) return;
      store[fullest].pop();
      if (store[fullest].length === 0) delete store[fullest];
    }
  }
}

/** Keep a copy of `card` (newest first). An unchanged card is not stored twice. */
export function saveSnapshot(card: RawCardFull, now: Date = new Date()): void {
  if (!card?.cardId) return;
  const store = load();
  const list = store[card.cardId] ?? [];
  const json = JSON.stringify(card);
  if (list[0] && JSON.stringify(list[0].card) === json) return;
  store[card.cardId] = [{ at: now.toISOString(), card: JSON.parse(json) as RawCardFull }, ...list].slice(
    0,
    SNAPSHOTS_PER_CARD,
  );
  save(store);
}

/** Saved versions of one card, newest first. */
export function listSnapshots(cardId: string): Snapshot[] {
  return load()[cardId] ?? [];
}

export const chapterCount = (s: Snapshot) => s.card.content?.chapters?.length ?? 0;
