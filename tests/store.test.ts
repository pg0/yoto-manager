import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Track } from '../src/types';

// "Delete a song" is two steps: the local edit, then the publish that commits
// it. These tests hold the line on both - the local edit must touch exactly one
// track, and the publish must leave the store's keys matching what Yoto now has.

const updatePlaylist = vi.fn<(c: Card) => Promise<{ ok: boolean; newCardId?: string }>>();
const fetchCardDetail = vi.fn<(id: string) => Promise<unknown>>();

vi.mock('../src/lib/publish', async (orig) => ({
  ...(await orig<typeof import('../src/lib/publish')>()),
  updatePlaylist: (c: Card) => updatePlaylist(c),
}));
vi.mock('../src/lib/content', () => ({
  fetchCardDetail: (id: string) => fetchCardDetail(id),
  fetchCardList: vi.fn(async () => []),
  deleteCardRemote: vi.fn(async () => undefined),
  ICON_HOST: 'https://icons.test/',
}));

const { useStore } = await import('../src/store');

const row = (key: string, title: string): Track => ({
  key,
  uid: `card1:${key}:x`,
  title,
  duration: 60,
  size: 1000,
  icon: null,
  emoji: null,
  trackUrl: `https://media.test/${key}.mp3`,
});

const card = (): Card => ({
  id: 'card1',
  title: 'Bedtime',
  slug: 'bedtime',
  cover: '',
  dirty: false,
  loaded: true,
  settings: { showTrackNumbers: false, loop: false, shuffle: false },
  tracks: [row('00', 'One'), row('01', 'Two'), row('02', 'Three')],
});

const active = () => useStore.getState().cards.find((c) => c.id === 'card1')!;

beforeEach(() => {
  vi.clearAllMocks();
  updatePlaylist.mockResolvedValue({ ok: true });
  fetchCardDetail.mockRejectedValue(new Error('offline'));
  useStore.setState({
    cards: [card()],
    activeId: 'card1',
    authed: true,
    selected: new Set(),
    undoStack: [],
    publishing: false,
  });
});

describe('removing a track', () => {
  it('drops only the selected track and keeps the playlist', () => {
    useStore.setState({ selected: new Set(['card1:01:x']) });
    useStore.getState().removeSelected();

    expect(useStore.getState().cards).toHaveLength(1);
    expect(active().tracks.map((t) => t.title)).toEqual(['One', 'Three']);
    expect(active().dirty).toBe(true);
  });

  it('keeps the playlist even when its last track is removed', () => {
    useStore.getState().selectAll(true);
    useStore.getState().removeSelected();

    expect(useStore.getState().cards.map((c) => c.id)).toEqual(['card1']);
    expect(active().tracks).toEqual([]);
  });

  it('is undoable', () => {
    useStore.setState({ selected: new Set(['card1:01:x']) });
    useStore.getState().removeSelected();
    useStore.getState().undo();

    expect(active().tracks.map((t) => t.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('does nothing when nothing is selected', () => {
    useStore.getState().removeSelected();

    expect(active().tracks).toHaveLength(3);
    expect(active().dirty).toBe(false);
  });
});

describe('after publishing', () => {
  it('re-keys the tracks to the chapter keys just written, even if the refetch fails', async () => {
    useStore.setState({ selected: new Set(['card1:00:x']) });
    useStore.getState().removeSelected();
    await useStore.getState().publish();

    // the refetch that normally re-keys is mocked as failing; the keys must
    // still match what the publish wrote, or the NEXT publish looks its
    // chapters up under keys Yoto no longer has
    expect(active().tracks.map((t) => t.key)).toEqual(['00', '01']);
    expect(active().dirty).toBe(false);
  });

  it('leaves the card alone when the publish is refused', async () => {
    updatePlaylist.mockResolvedValue({ ok: false });
    useStore.setState({ selected: new Set(['card1:00:x']) });
    useStore.getState().removeSelected();
    await useStore.getState().publish();

    expect(active().dirty).toBe(true);
    expect(useStore.getState().cards).toHaveLength(1);
  });
});

describe('deleting the playlist itself', () => {
  it('is the only thing that removes a card from the library', async () => {
    useStore.setState({ selected: new Set(['card1:01:x']) });
    useStore.getState().removeSelected();
    expect(useStore.getState().cards).toHaveLength(1);

    await useStore.getState().deleteCard('card1');
    expect(useStore.getState().cards).toHaveLength(0);
  });
});
