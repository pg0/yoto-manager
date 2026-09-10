import { beforeEach, describe, expect, it } from 'vitest';
import type { RawCardFull } from '../src/lib/content';
import { listSnapshots, saveSnapshot, SNAPSHOTS_PER_CARD } from '../src/lib/snapshots';

// The snapshot is the only way back after a bad save, so it has to be there,
// be the newest first, and not vanish under its own weight.

const card = (n: number): RawCardFull => ({
  cardId: 'card1',
  title: 'Bedtime',
  content: { chapters: Array.from({ length: n }, (_, i) => ({ key: String(i), title: `T${i}` })) },
});

beforeEach(() => localStorage.clear());

describe('snapshots', () => {
  it('keeps a copy per card, newest first', () => {
    saveSnapshot(card(3), new Date('2026-09-10T10:00:00Z'));
    saveSnapshot(card(2), new Date('2026-09-10T11:00:00Z'));
    const list = listSnapshots('card1');
    expect(list.map((s) => s.card.content?.chapters?.length)).toEqual([2, 3]);
    expect(list[0].at).toBe('2026-09-10T11:00:00.000Z');
  });

  it('does not store the same version twice in a row', () => {
    saveSnapshot(card(3));
    saveSnapshot(card(3));
    expect(listSnapshots('card1')).toHaveLength(1);
  });

  it('rolls the oldest off past the per-card limit', () => {
    for (let i = 1; i <= SNAPSHOTS_PER_CARD + 2; i++) saveSnapshot(card(i));
    const list = listSnapshots('card1');
    expect(list).toHaveLength(SNAPSHOTS_PER_CARD);
    expect(list[0].card.content?.chapters).toHaveLength(SNAPSHOTS_PER_CARD + 2);
  });

  it('still keeps the newest copy when storage is full', () => {
    const real = localStorage.setItem.bind(localStorage);
    let calls = 0;
    // the first two attempts hit the quota, then it fits
    localStorage.setItem = (k: string, v: string) => {
      if (++calls <= 2) throw new Error('QuotaExceededError');
      real(k, v);
    };
    saveSnapshot(card(3));
    saveSnapshot(card(4));
    localStorage.setItem = real;
    expect(listSnapshots('card1')[0].card.content?.chapters).toHaveLength(4);
  });
});
