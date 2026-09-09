import { beforeEach, describe, expect, it, vi } from 'vitest';

// What the reader turns a Yoto card into decides what a "song" means in the UI,
// so it decides what a delete removes.

const yotoFetch = vi.fn<(path: string) => Promise<unknown>>();
vi.mock('../src/lib/auth', () => ({ yotoFetch: (p: string) => yotoFetch(p) }));

const { fetchCardDetail } = await import('../src/lib/content');

const ok = (card: unknown) => ({ ok: true, status: 200, json: async () => ({ card }) });

beforeEach(() => vi.clearAllMocks());

describe('one track per chapter (how this app writes cards)', () => {
  it('maps each chapter to one row, keeping order, title, icon and key', async () => {
    yotoFetch.mockResolvedValue(
      ok({
        cardId: 'card1',
        title: 'Bedtime',
        content: {
          chapters: [
            { key: '00', title: 'One', duration: 60, fileSize: 10, display: { icon16x16: 'yoto:#i1' }, tracks: [{ key: '01', trackUrl: 'yoto:#a' }] },
            { key: '01', title: 'Two', duration: 90, fileSize: 20, tracks: [{ key: '01', trackUrl: 'yoto:#b' }] },
          ],
        },
      }),
    );

    const d = await fetchCardDetail('card1');

    expect(d.tracks.map((t) => t.title)).toEqual(['One', 'Two']);
    expect(d.tracks.map((t) => t.key)).toEqual(['00', '01']);
    expect(d.tracks[0].icon).toContain('i1');
  });

  it('gives every row a unique id, so selecting one can never select another', async () => {
    yotoFetch.mockResolvedValue(
      ok({
        cardId: 'card1',
        content: {
          chapters: [
            { key: '00', title: 'Same name', tracks: [{ key: '01', trackUrl: 'yoto:#a' }] },
            { key: '01', title: 'Same name', tracks: [{ key: '01', trackUrl: 'yoto:#b' }] },
          ],
        },
      }),
    );

    const d = await fetchCardDetail('card1');

    expect(new Set(d.tracks.map((t) => t.uid)).size).toBe(2);
  });
});

describe('chapters that hold more than one track', () => {
  const multi = {
    cardId: 'card1',
    content: {
      chapters: [
        {
          key: '00',
          title: 'Side A',
          tracks: [
            { key: '01', title: 'Song 1', trackUrl: 'yoto:#s1' },
            { key: '02', title: 'Song 2', trackUrl: 'yoto:#s2' },
            { key: '03', title: 'Song 3', trackUrl: 'yoto:#s3' },
          ],
        },
      ],
    },
  };

  // KNOWN LIMITATION, pinned here on purpose: a card built in the Yoto app can
  // pack several songs into one chapter, and this reader collapses that chapter
  // into a single row. Removing that row therefore removes all three songs.
  // publish.ts no longer drops the hidden tracks on unrelated saves (see its
  // tests), but the row still means "the whole chapter".
  it('currently collapses the chapter into a single row', async () => {
    yotoFetch.mockResolvedValue(ok(multi));

    const d = await fetchCardDetail('card1');

    expect(d.tracks).toHaveLength(1);
    expect(d.tracks[0].title).toBe('Side A');
  });

  it.todo('shows each track of a multi-track chapter as its own deletable row');
});
