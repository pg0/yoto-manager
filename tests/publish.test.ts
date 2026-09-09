import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Track } from '../src/types';
import type { RawCardFull } from '../src/lib/content';

// The publish path is where a delete becomes permanent, so these tests pin the
// exact JSON that goes to Yoto. Everything that talks to the network is mocked;
// the assertions are all about the payload we would have sent.

const fetchCanonicalCard = vi.fn<(id: string) => Promise<RawCardFull | null>>();
const yotoFetch = vi.fn<(path: string, init?: { body?: string }) => Promise<{ ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> }>>();
const uploadDisplayIcon = vi.fn(async (_dataUrl: string) => 'yoto:#uploaded-icon');

vi.mock('../src/lib/content', () => ({ fetchCanonicalCard: (id: string) => fetchCanonicalCard(id) }));
vi.mock('../src/lib/auth', () => ({ yotoFetch: (p: string, init?: { body?: string }) => yotoFetch(p, init) }));
vi.mock('../src/lib/icons', () => ({ uploadDisplayIcon: (d: string) => uploadDisplayIcon(d) }));

const { updatePlaylist } = await import('../src/lib/publish');

/** the chapters array we would have POSTed on the last call */
function sentChapters() {
  const calls = yotoFetch.mock.calls;
  const body = JSON.parse(calls[calls.length - 1][1]!.body!);
  return body.content.chapters as {
    key: string;
    title: string;
    display?: { icon16x16?: string };
    tracks: { title: string; trackUrl?: string; display?: { icon16x16?: string } }[];
  }[];
}

const chapter = (key: string, title: string, sha: string, extra: object = {}) => ({
  key,
  title,
  display: { icon16x16: `yoto:#icon-${sha}` },
  tracks: [{ key: '01', title, trackUrl: `yoto:#${sha}`, duration: 60, fileSize: 1000, type: 'audio' }],
  ...extra,
});

const row = (key: string, title: string, over: Partial<Track> = {}): Track => ({
  key,
  uid: `card1:${key}:x`,
  title,
  duration: 60,
  size: 1000,
  icon: null,
  emoji: null,
  ...over,
});

const card = (tracks: Track[]): Card => ({
  id: 'card1',
  title: 'Bedtime',
  slug: 'bedtime',
  cover: '',
  dirty: true,
  settings: { showTrackNumbers: false, loop: false, shuffle: false },
  tracks,
});

beforeEach(() => {
  vi.clearAllMocks();
  yotoFetch.mockResolvedValue({ ok: true, json: async () => ({}), text: async () => '' });
  fetchCanonicalCard.mockResolvedValue({
    cardId: 'card1',
    title: 'Bedtime',
    content: { chapters: [chapter('00', 'One', 'aaa'), chapter('01', 'Two', 'bbb'), chapter('02', 'Three', 'ccc')] },
  } as RawCardFull);
});

describe('deleting one track', () => {
  it('removes only that chapter and leaves the other media refs untouched', async () => {
    const res = await updatePlaylist(card([row('00', 'One'), row('02', 'Three')]));

    expect(res.ok).toBe(true);
    const ch = sentChapters();
    expect(ch.map((c) => c.title)).toEqual(['One', 'Three']);
    expect(ch.map((c) => c.tracks[0].trackUrl)).toEqual(['yoto:#aaa', 'yoto:#ccc']);
  });

  it('re-keys the survivors from array position so play order matches the list', async () => {
    await updatePlaylist(card([row('02', 'Three'), row('00', 'One')]));

    const ch = sentChapters();
    expect(ch.map((c) => c.key)).toEqual(['00', '01']);
    expect(ch.map((c) => c.tracks[0].trackUrl)).toEqual(['yoto:#ccc', 'yoto:#aaa']);
  });

  it('never empties a card it was only asked to trim', async () => {
    await updatePlaylist(card([row('00', 'One'), row('01', 'Two')]));

    expect(sentChapters()).toHaveLength(2);
  });
});

describe('chapters that hold more than one track', () => {
  // A playlist built in the Yoto app can put several songs in one chapter. The
  // UI shows that chapter as a single row, so a rebuild that writes only the
  // first track would delete the rest of the songs on every save.
  it('keeps every track of a chapter, not just the one the row shows', async () => {
    fetchCanonicalCard.mockResolvedValue({
      cardId: 'card1',
      content: {
        chapters: [
          {
            key: '00',
            title: 'Side A',
            tracks: [
              { key: '01', title: 'Song 1', trackUrl: 'yoto:#s1', duration: 60, fileSize: 10, type: 'audio' },
              { key: '02', title: 'Song 2', trackUrl: 'yoto:#s2', duration: 60, fileSize: 10, type: 'audio' },
              { key: '03', title: 'Song 3', trackUrl: 'yoto:#s3', duration: 60, fileSize: 10, type: 'audio' },
            ],
          },
          chapter('01', 'Side B', 'bbb'),
        ],
      },
    } as RawCardFull);

    await updatePlaylist(card([row('00', 'Side A'), row('01', 'Side B')]));

    const ch = sentChapters();
    expect(ch[0].tracks.map((t) => t.trackUrl)).toEqual(['yoto:#s1', 'yoto:#s2', 'yoto:#s3']);
  });
});

describe('refusing to write a card that would lose audio', () => {
  it('aborts when a local track key is gone from the card on Yoto', async () => {
    // keys drift when a publish succeeds but the refetch behind it fails
    const res = await updatePlaylist(card([row('00', 'One'), row('09', 'Ghost')]));

    expect(res.ok).toBe(false);
    expect(res.stale).toBe(true);
    expect(yotoFetch).not.toHaveBeenCalled();
  });

  it('still allows a freshly uploaded track, which brings its own ref', async () => {
    const res = await updatePlaylist(
      card([row('00', 'One'), row('99', 'New upload', { trackUrl: 'yoto:#fresh' })]),
    );

    expect(res.ok).toBe(true);
    expect(sentChapters()[1].tracks[0].trackUrl).toBe('yoto:#fresh');
  });

  it('aborts before any write when the canonical read is forbidden', async () => {
    fetchCanonicalCard.mockResolvedValue(null);

    const res = await updatePlaylist(card([row('00', 'One')]));

    expect(res).toMatchObject({ ok: false, needScope: true });
    expect(yotoFetch).not.toHaveBeenCalled();
  });
});

describe('media refs', () => {
  it('sends the canonical yoto: ref, never the signed https URL used for playback', async () => {
    await updatePlaylist(card([row('00', 'One', { trackUrl: 'https://secure-media.yotoplay.com/x.mp3?sig=1' })]));

    expect(sentChapters()[0].tracks[0].trackUrl).toBe('yoto:#aaa');
  });

  it('uploads a generated data: icon and sends the returned ref', async () => {
    await updatePlaylist(card([row('00', 'One', { icon: 'data:image/png;base64,AAA' })]));

    expect(uploadDisplayIcon).toHaveBeenCalledOnce();
    expect(sentChapters()[0].display?.icon16x16).toBe('yoto:#uploaded-icon');
  });
});
