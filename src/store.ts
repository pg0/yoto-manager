import { create } from 'zustand';
import { DEFAULT_SETTINGS, type Card, type CardSettings, type DrawerMode, type RenameResult, type SortKey, type Track, type TrackEnd } from './types';
import { mockCards } from './data/mock';
import { fetchMe, logout as apiLogout } from './lib/api';
import { fetchCardDetail, fetchCardList, deleteCardRemote } from './lib/content';
import { fetchNumberIcons } from './lib/icons';
import { generateNumberIcon } from './lib/numbergen';
import { pixelNumDataUrl, pixelNumColorsDataUrl, suggestGroups, groupIconColors } from './lib/pixelnum';
import { updatePlaylist } from './lib/publish';
import { uploadAudioFile } from './lib/upload';

const DRAFT_KEY = 'yoto-manager:draft:v1';
const STATS_KEY = 'yoto-manager:stats:v1';
const CARDS_KEY = 'yoto-manager:cards:v1';

/** Cache the real card shells so the rail paints instantly on reload (no
 *  empty→demo→real flash). Tracks are dropped; they lazy-load on open. */
function loadCardCache(): Card[] {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Card[]).map((c) => ({
      ...c,
      tracks: [],
      loaded: false,
      settings: { ...DEFAULT_SETTINGS, ...c.settings },
    }));
  } catch {
    return [];
  }
}
function saveCardCache(cards: Card[]) {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards.map((c) => ({ ...c, tracks: [] }))));
  } catch {
    /* quota / private mode */
  }
}

/** Per-card stats cached in localStorage so counts show instantly on reload. */
interface CardStats {
  trackCount: number;
  durationSec: number;
  updatedAt?: string;
}
function loadStats(): Record<string, CardStats> {
  try {
    return JSON.parse(localStorage.getItem(STATS_KEY) || '{}') as Record<string, CardStats>;
  } catch {
    return {};
  }
}
function saveStats(map: Record<string, CardStats>) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(map));
  } catch {
    /* quota/private mode */
  }
}

/** Load the local draft from localStorage, else seed with mock data. */
function loadCards(): Card[] {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const cards = JSON.parse(raw) as Card[];
      // migrate drafts written before card settings existed
      return cards.map((c) => ({ ...c, settings: { ...DEFAULT_SETTINGS, ...c.settings } }));
    }
  } catch {
    /* ignore corrupt draft */
  }
  return mockCards();
}

/** Sorted + filtered view of the active card's tracks, paired with real index. */
export function visibleTracks(s: State): { t: Track; index: number }[] {
  const card = s.cards.find((c) => c.id === s.activeId);
  if (!card) return [];
  let rows = card.tracks.map((t, index) => ({ t, index }));
  if (s.trackFilter) {
    const q = s.trackFilter.toLowerCase();
    rows = rows.filter((r) => r.t.title.toLowerCase().includes(q));
  }
  if (s.sortKey !== 'index') {
    const key = s.sortKey;
    const dir = s.sortDir;
    rows = rows.slice().sort((a, b) => {
      if (key === 'title') {
        const x = a.t.title.toLowerCase();
        const y = b.t.title.toLowerCase();
        return x < y ? -dir : x > y ? dir : 0;
      }
      return (a.t[key] - b.t[key]) * dir;
    });
  } else if (s.sortDir === -1) {
    rows = rows.slice().reverse();
  }
  return rows;
}

interface State {
  cards: Card[];
  activeId: string;
  selected: Set<string>;
  lastClickIdx: number | null;
  sortKey: SortKey;
  sortDir: 1 | -1;
  trackFilter: string;
  cardFilter: string;
  drawer: DrawerMode;
  /** when the icon picker targets one clicked track instead of the selection */
  iconTargetUid: string | null;
  /** the track being trimmed in the audio editor */
  audioEditUid: string | null;
  toast: string | null;
  undoStack: string[];
  publishing: boolean;
  /** true right after an update that changed >= 3 playlist tracks - drives the
   *  confetti "Yay!" dialog; auto-dismissed by the UI after 2s */
  celebrate: boolean;
  dismissCelebrate: () => void;

  // auth + real-data hydration
  authed: boolean;
  displayName: string | null;
  /** signed-in account's Yoto userId; the rail labels this group as "yours" */
  myUserId: string | null;
  loading: boolean;

  // in-app audio preview
  playingUid: string | null;
  playTrack: (uid: string | null) => void;
  /** advance to the next playable track in the visible list (auto-play on end) */
  playNext: () => void;
  /** nonce the Player watches to toggle play/pause (spacebar) */
  playToggle: number;
  requestToggle: () => void;

  /** create a new empty local playlist and open it (saved to Yoto on Update) */
  newCard: () => void;

  /** permanently delete a card on Yoto (DELETE /content/{id}); local-only cards
   *  are just dropped. Returns true on success. */
  deleteCard: (id: string) => Promise<boolean>;

  // drag-drop MP3 upload into the active card
  uploads: { id: string; name: string; pct: number; status: 'uploading' | 'processing' | 'done' | 'error' }[];
  uploadFiles: (files: File[]) => Promise<void>;

  activeCard: () => Card | undefined;

  /** one-shot on mount: check session, and if signed in pull real cards */
  init: () => Promise<void>;
  /** lazy-load one card's chapters/tracks the first time it's opened */
  ensureLoaded: (id: string) => Promise<void>;
  /** background-fill track counts for all cards (throttled) and cache them */
  hydrateStats: () => Promise<void>;
  /** end the session and fall back to local/mock mode */
  signOut: () => Promise<void>;

  openCard: (id: string) => void;
  /** force a fresh detail fetch from Yoto (signed URLs + canonical structure),
   *  replacing local tracks and clearing dirty - used after a successful publish */
  reloadCard: (id: string) => Promise<void>;
  setCardFilter: (v: string) => void;
  setTrackFilter: (v: string) => void;

  toggleSel: (uid: string, visIdx: number, shift: boolean, exclusive: boolean) => void;
  selectAll: (on: boolean) => void;
  clearSel: () => void;
  /** replace the selection wholesale (used by marquee drag-select) */
  setSelectedUids: (uids: string[]) => void;

  sortBy: (key: SortKey) => void;
  move: (act: 'top' | 'up' | 'down' | 'bottom') => void;
  reorder: (uids: string[], targetUid: string, after: boolean) => void;
  removeSelected: () => void;
  setTrackEnd: (uid: string, val: TrackEnd) => void;
  renameOne: (uid: string, title: string) => void;
  applyRename: (results: RenameResult[]) => void;
  applyIcon: (iconUrl: string) => void;
  /** number the selected tracks with Yoto's 1-30 number icons, continuing past
   *  the highest number icon already present on the card */
  applyNumberIcons: () => Promise<void>;
  /** paint pixel-progress "PixelNum" icons across the selected tracks.
   *  `groupByName` colours each auto-detected name group differently;
   *  `fillPrevious` lights the already-finished tracks in the same colour too. */
  applyPixelNum: (
    current: string,
    fill: string,
    blockSide: number,
    opts?: { groupByName?: boolean; fillPrevious?: boolean },
  ) => void;
  setCover: (dataUrl: string) => void;
  /** rename the active card (title); no-op on empty/unchanged */
  setCardTitle: (title: string) => void;
  /** set the active card's description */
  setCardDescription: (description: string) => void;
  setSetting: <K extends keyof CardSettings>(key: K, value: CardSettings[K]) => void;

  openDrawer: (m: DrawerMode) => void;
  openIconPicker: (uid?: string) => void;
  /** open the audio trim editor for one track */
  openAudioEditor: (uid: string) => void;
  /** replace a track's audio after a cut (new yoto:# ref + duration/size), dirty */
  applyTrackAudio: (uid: string, patch: { trackUrl: string; duration: number; size: number }) => void;
  closeDrawer: () => void;

  undo: () => void;
  publish: () => void;
  discardDraft: () => void;
  showToast: (msg: string) => void;
}

function persist(cards: Card[]) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(cards));
  } catch {
    /* quota / private mode: draft just won't survive reload */
  }
}

/**
 * Count PLAYLIST-level edits between a baseline and the current tracks: added,
 * removed, reordered, renamed, re-iconed, or re-badged tracks. Card title,
 * description and cover are NOT tracks, so they never count here. Used to gate
 * the celebration (needs >= 3 real track changes).
 */
function countPlaylistChanges(base: Track[], cur: Track[]): number {
  const baseUids = new Set(base.map((t) => t.uid));
  const curUids = new Set(cur.map((t) => t.uid));
  let n = 0;
  for (const t of cur) if (!baseUids.has(t.uid)) n++; // added
  for (const t of base) if (!curUids.has(t.uid)) n++; // removed
  base.forEach((bt, bi) => {
    const ci = cur.findIndex((t) => t.uid === bt.uid);
    if (ci === -1) return;
    const ct = cur[ci];
    if (ct.title !== bt.title) n++;
    if ((ct.icon || '') !== (bt.icon || '')) n++;
    if ((ct.overlayLabel || '') !== (bt.overlayLabel || '')) n++;
    if (ci !== bi) n++; // moved
  });
  return n;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useStore = create<State>((set, get) => ({
  // start empty; init() seeds real cards (from cache, instantly) or demo mode.
  // this removes the empty→demo→real flash a signed-in user used to see.
  cards: [],
  activeId: '',
  selected: new Set(),
  lastClickIdx: null,
  sortKey: 'index',
  sortDir: 1,
  trackFilter: '',
  cardFilter: '',
  drawer: null,
  iconTargetUid: null,
  audioEditUid: null,
  toast: null,
  undoStack: [],
  publishing: false,
  celebrate: false,
  dismissCelebrate: () => set({ celebrate: false }),

  authed: false,
  displayName: null,
  myUserId: null,
  loading: false,

  playingUid: null,
  playTrack: (uid) => set({ playingUid: uid }),
  playNext: () => {
    const s = get();
    const streamable = (t: Track) => !!t.trackUrl && /^https?:\/\//.test(t.trackUrl);
    const rows = visibleTracks(s);
    const idx = rows.findIndex((r) => r.t.uid === s.playingUid);
    if (idx === -1) {
      set({ playingUid: null });
      return;
    }
    for (let i = idx + 1; i < rows.length; i++) {
      if (streamable(rows[i].t)) {
        set({ playingUid: rows[i].t.uid });
        return;
      }
    }
    // end of list: loop back to the first playable track if the card loops
    if (s.activeCard()?.settings.loop) {
      const first = rows.find((r) => streamable(r.t));
      if (first && first.t.uid !== s.playingUid) {
        set({ playingUid: first.t.uid });
        return;
      }
    }
    set({ playingUid: null });
  },
  playToggle: 0,
  requestToggle: () => set((s) => ({ playToggle: s.playToggle + 1 })),

  newCard: () => {
    const s = get();
    const id = `new_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    const card: Card = {
      id,
      title: 'New playlist',
      slug: '',
      cover: '',
      dirty: true,
      loaded: true,
      durationSec: 0,
      trackCount: 0,
      owner: s.myUserId ?? undefined,
      settings: { ...DEFAULT_SETTINGS },
      tracks: [],
    };
    const cards = [card, ...s.cards];
    persist(cards);
    set({ cards, activeId: id, selected: new Set(), undoStack: [], cardFilter: '' });
  },

  deleteCard: async (id) => {
    const s = get();
    const card = s.cards.find((c) => c.id === id);
    if (!card) return false;
    // real Yoto cards have a short id; locally-created ones start with "new_"
    const isRemote = s.authed && !id.startsWith('new_');
    if (isRemote) {
      try {
        await deleteCardRemote(id);
      } catch (e) {
        get().showToast(`Couldn't delete: ${(e as Error).message}`);
        return false;
      }
    }
    const cards = s.cards.filter((c) => c.id !== id);
    const nextActive = s.activeId === id ? (cards[0]?.id ?? '') : s.activeId;
    persist(cards);
    saveCardCache(cards);
    set({
      cards,
      activeId: nextActive,
      selected: new Set(),
      undoStack: [],
      lastClickIdx: null,
    });
    if (nextActive && nextActive !== s.activeId) void get().ensureLoaded(nextActive);
    get().showToast(`Deleted "${card.title}"`);
    return true;
  },

  uploads: [],
  uploadFiles: async (files) => {
    const s = get();
    const card = s.activeCard();
    if (!card) return;
    if (!s.authed) {
      s.showToast('Sign in to Yoto to upload audio');
      return;
    }
    for (const file of files) {
      const id = `up_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
      const upd = (patch: Partial<State['uploads'][number]>) =>
        set((st) => ({ uploads: st.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
      set((st) => ({
        uploads: [...st.uploads, { id, name: file.name, pct: 5, status: 'uploading' as const }],
      }));
      try {
        const res = await uploadAudioFile(file, (p) =>
          upd({ pct: p, status: p >= 55 ? 'processing' : 'uploading' }),
        );
        const cur = get();
        const c = cur.cards.find((x) => x.id === card.id);
        if (c) {
          const track: Track = {
            key: String(c.tracks.length).padStart(2, '0'),
            uid: `${c.id}:new:${id}`,
            title: file.name.replace(/\.[^.]+$/, ''),
            duration: res.duration,
            size: res.fileSize,
            icon: null,
            emoji: null,
            trackUrl: res.trackUrl, // yoto:#<sha> - becomes playable after publish+refetch
          };
          const cards = cur.cards.map((x) =>
            x.id === c.id ? { ...x, tracks: [...x.tracks, track], dirty: true } : x,
          );
          persist(cards);
          set({ cards });
        }
        upd({ pct: 100, status: 'done' });
        setTimeout(() => set((st) => ({ uploads: st.uploads.filter((u) => u.id !== id) })), 2500);
      } catch (e) {
        upd({ status: 'error' });
        get().showToast(`Upload failed: ${(e as Error).message}`);
        setTimeout(() => set((st) => ({ uploads: st.uploads.filter((u) => u.id !== id) })), 4000);
      }
    }
  },

  activeCard: () => get().cards.find((c) => c.id === get().activeId),

  init: async () => {
    // paint the cached real cards instantly (if we have them) so there's no
    // empty→demo→real flash while /content/mine resolves
    const cached = loadCardCache();
    if (cached.length) set({ cards: cached, activeId: cached[0].id, loading: true });
    else set({ loading: true });

    const me = fetchMe();
    if (!me.authenticated) {
      // signed out → demo mode (local draft or mock sample)
      const demo = loadCards();
      set({
        authed: false,
        displayName: null,
        myUserId: null,
        cards: demo,
        activeId: demo[0]?.id ?? '',
        loading: false,
      });
      return;
    }
    set({ authed: true, displayName: me.displayName ?? null, myUserId: me.userId ?? null });
    try {
      const cards = await fetchCardList();
      if (cards.length === 0) {
        saveCardCache([]);
        set({ cards: [], activeId: '', loading: false });
        get().showToast('No cards in your Yoto library yet');
        return;
      }
      // real library is the source of truth; drop any leftover mock draft
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      // seed counts/minutes from the localStorage stats cache (instant), keeping
      // only entries whose Yoto updatedAt still matches
      const stats = loadStats();
      const seeded = cards.map((c) => {
        const st = stats[c.id];
        return st && st.updatedAt === c.updatedAt
          ? { ...c, trackCount: st.trackCount, durationSec: st.durationSec }
          : c;
      });
      saveCardCache(seeded);
      // keep the current selection if it still exists, else open the first card
      const prev = get().activeId;
      const activeId = seeded.some((c) => c.id === prev) ? prev : seeded[0].id;
      set({ cards: seeded, activeId, selected: new Set(), undoStack: [], loading: false });
      void get().ensureLoaded(activeId);
      void get().hydrateStats();
    } catch (e) {
      set({ loading: false });
      get().showToast(`Couldn't load your cards: ${(e as Error).message}`);
    }
  },

  hydrateStats: async () => {
    // fill track counts for cards not already covered by the cache, throttled so
    // we don't fan out 35 detail requests at once; cache each result
    const pending = get().cards.filter((c) => c.trackCount === undefined);
    let i = 0;
    const CONCURRENCY = 4;
    const worker = async () => {
      while (i < pending.length) {
        const card = pending[i++];
        if (!get().authed) return;
        try {
          const d = await fetchCardDetail(card.id);
          const durationSec = d.tracks.reduce((a, t) => a + t.duration, 0);
          const trackCount = d.tracks.length;
          set((st) => ({
            cards: st.cards.map((c) =>
              c.id === card.id ? { ...c, trackCount, durationSec } : c,
            ),
          }));
          const map = loadStats();
          map[card.id] = { trackCount, durationSec, updatedAt: card.updatedAt };
          saveStats(map);
        } catch {
          /* leave this card as a shell; it'll load on open */
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  },

  ensureLoaded: async (id) => {
    const card = get().cards.find((c) => c.id === id);
    if (!card || card.loaded || !get().authed) return;
    try {
      const d = await fetchCardDetail(id);
      const durationSec = d.tracks.reduce((a, t) => a + t.duration, 0);
      const cards = get().cards.map((c) =>
        c.id === id
          ? {
              ...c,
              tracks: d.tracks,
              cover: c.cover || d.cover,
              title: c.title || d.title,
              slug: c.slug || d.slug,
              durationSec,
              trackCount: d.tracks.length,
              settings: { showTrackNumbers: d.showTrackNumbers, loop: d.loop },
              loaded: true,
            }
          : c,
      );
      set({ cards });
      const map = loadStats();
      map[id] = { trackCount: d.tracks.length, durationSec, updatedAt: card.updatedAt };
      saveStats(map);
    } catch (e) {
      get().showToast(`Couldn't open card: ${(e as Error).message}`);
    }
  },

  signOut: async () => {
    apiLogout();
    try {
      localStorage.removeItem(CARDS_KEY);
    } catch {
      /* ignore */
    }
    const fresh = mockCards();
    set({
      authed: false,
      displayName: null,
      myUserId: null,
      cards: fresh,
      activeId: fresh[0]?.id ?? '',
      selected: new Set(),
      undoStack: [],
      loading: false,
    });
  },

  reloadCard: async (id) => {
    if (!get().authed) return;
    try {
      const d = await fetchCardDetail(id);
      const durationSec = d.tracks.reduce((a, t) => a + t.duration, 0);
      const cards = get().cards.map((c) =>
        c.id === id
          ? {
              ...c,
              tracks: d.tracks,
              cover: d.cover || c.cover,
              title: d.title || c.title,
              slug: d.slug || c.slug,
              durationSec,
              trackCount: d.tracks.length,
              settings: { showTrackNumbers: d.showTrackNumbers, loop: d.loop },
              loaded: true,
              dirty: false,
            }
          : c,
      );
      persist(cards);
      saveCardCache(cards);
      set({ cards, undoStack: [] });
    } catch {
      /* keep current state if the refetch fails */
    }
  },

  openCard: (id) => {
    if (id === get().activeId) return;
    set({
      activeId: id,
      selected: new Set(),
      lastClickIdx: null,
      sortKey: 'index',
      sortDir: 1,
      trackFilter: '',
      undoStack: [],
    });
    void get().ensureLoaded(id);
  },

  setCardFilter: (v) => set({ cardFilter: v }),
  setTrackFilter: (v) => set({ trackFilter: v }),

  toggleSel: (uid, visIdx, shift, exclusive) => {
    const s = get();
    const rows = visibleTracks(s);
    const next = new Set(s.selected);
    let lastClickIdx = s.lastClickIdx;
    if (shift && s.lastClickIdx !== null) {
      const [a, b] = [s.lastClickIdx, visIdx].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) next.add(rows[i].t.uid);
    } else if (exclusive) {
      const wasOnly = next.size === 1 && next.has(uid);
      next.clear();
      if (!wasOnly) next.add(uid);
      lastClickIdx = visIdx;
    } else {
      next.has(uid) ? next.delete(uid) : next.add(uid);
      lastClickIdx = visIdx;
    }
    set({ selected: next, lastClickIdx });
  },

  selectAll: (on) => {
    const s = get();
    if (!s.activeCard()) return;
    // only the currently visible (filtered/sorted) rows, so "select all" under
    // an active filter never reaches hidden tracks
    const visible = visibleTracks(s).map((r) => r.t.uid);
    set({ selected: on ? new Set(visible) : new Set() });
  },
  clearSel: () => set({ selected: new Set() }),
  setSelectedUids: (uids) => set({ selected: new Set(uids) }),

  sortBy: (key) => {
    const s = get();
    if (s.sortKey === key) set({ sortDir: (s.sortDir * -1) as 1 | -1 });
    else set({ sortKey: key, sortDir: 1 });
  },

  move: (act) => {
    const s = get();
    const card = s.activeCard();
    if (!card || s.selected.size === 0) return;
    // moves operate on real order; drop any sorted view first
    const forcedNatural = s.sortKey !== 'index';

    const undoStack = [...s.undoStack, JSON.stringify(card.tracks)].slice(-50);
    const sel = s.selected;
    const picked = card.tracks.filter((t) => sel.has(t.uid));
    const rest = card.tracks.filter((t) => !sel.has(t.uid));
    let arr = card.tracks.slice();

    if (act === 'top') arr = [...picked, ...rest];
    else if (act === 'bottom') arr = [...rest, ...picked];
    else if (act === 'up') {
      for (let i = 1; i < arr.length; i++) {
        if (sel.has(arr[i].uid) && !sel.has(arr[i - 1].uid)) {
          [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        }
      }
    } else if (act === 'down') {
      for (let i = arr.length - 2; i >= 0; i--) {
        if (sel.has(arr[i].uid) && !sel.has(arr[i + 1].uid)) {
          [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        }
      }
    }

    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks: arr, dirty: true } : c));
    persist(cards);
    set({
      cards,
      undoStack,
      sortKey: 'index',
      sortDir: 1,
      toast: forcedNatural ? 'Committed sorted view to order' : s.toast,
    });
  },

  reorder: (uids, targetUid, after) => {
    const s = get();
    const card = s.activeCard();
    if (!card || uids.length === 0) return;
    const moving = new Set(uids);
    if (moving.has(targetUid)) return; // dropped onto the dragged block: no-op
    const undoStack = [...s.undoStack, JSON.stringify(card.tracks)].slice(-50);
    const picked = card.tracks.filter((t) => moving.has(t.uid)); // keep their order
    const rest = card.tracks.filter((t) => !moving.has(t.uid));
    let idx = rest.findIndex((t) => t.uid === targetUid);
    idx = idx === -1 ? rest.length : after ? idx + 1 : idx;
    const arr = [...rest.slice(0, idx), ...picked, ...rest.slice(idx)];
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks: arr, dirty: true } : c));
    persist(cards);
    // drag defines an explicit manual order → drop any active sort
    set({ cards, undoStack, sortKey: 'index', sortDir: 1 });
  },

  removeSelected: () => {
    const s = get();
    const card = s.activeCard();
    if (!card || s.selected.size === 0) return;
    const undoStack = [...s.undoStack, JSON.stringify(card.tracks)].slice(-50);
    const tracks = card.tracks.filter((t) => !s.selected.has(t.uid));
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks, dirty: true } : c));
    persist(cards);
    set({ cards, selected: new Set(), undoStack });
  },

  setTrackEnd: (uid, val) => {
    const s = get();
    const card = s.activeCard();
    if (!card) return;
    const t = card.tracks.find((x) => x.uid === uid);
    if (!t || (t.onEnd ?? 'continue') === val) return;
    const undoStack = [...s.undoStack, JSON.stringify(card.tracks)].slice(-50);
    const tracks = card.tracks.map((x) => (x.uid === uid ? { ...x, onEnd: val } : x));
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks, dirty: true } : c));
    persist(cards);
    set({ cards, undoStack });
  },

  renameOne: (uid, title) => {
    const s = get();
    const card = s.activeCard();
    if (!card) return;
    const t = card.tracks.find((x) => x.uid === uid);
    if (!t || t.title === title || title.trim() === '') return;
    const undoStack = [...s.undoStack, JSON.stringify(card.tracks)].slice(-50);
    const tracks = card.tracks.map((x) => (x.uid === uid ? { ...x, title } : x));
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks, dirty: true } : c));
    persist(cards);
    set({ cards, undoStack });
  },

  applyRename: (results) => {
    const s = get();
    const card = s.activeCard();
    if (!card) return;
    const map = new Map(results.map((r) => [r.uid, r.next]));
    const undoStack = [...s.undoStack, JSON.stringify(card.tracks)].slice(-50);
    const tracks = card.tracks.map((t) => (map.has(t.uid) ? { ...t, title: map.get(t.uid)! } : t));
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks, dirty: true } : c));
    persist(cards);
    set({ cards, undoStack, drawer: null });
    get().showToast(`Renamed ${results.length} track(s)`);
  },

  applyIcon: (iconUrl) => {
    const s = get();
    const card = s.activeCard();
    if (!card) return;
    // a clicked-row target overrides the multi-selection
    const targets = s.iconTargetUid ? new Set([s.iconTargetUid]) : s.selected;
    if (targets.size === 0) return;
    const undoStack = [...s.undoStack, JSON.stringify(card.tracks)].slice(-50);
    const tracks = card.tracks.map((t) => (targets.has(t.uid) ? { ...t, icon: iconUrl } : t));
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks, dirty: true } : c));
    persist(cards);
    set({ cards, undoStack, drawer: null, iconTargetUid: null });
    get().showToast(`Icon set on ${targets.size} track(s)`);
  },

  applyNumberIcons: async () => {
    const s = get();
    const card = s.activeCard();
    if (!card) return;
    // number the clicked-row target if there is one, else the whole selection
    const targetUids = s.iconTargetUid ? [s.iconTargetUid] : [...s.selected];
    if (targetUids.length === 0) {
      get().showToast('Select tracks to number');
      return;
    }
    const targets = new Set(targetUids);
    // each selection numbers fresh from 1 (a story/group), in the visible order.
    // NO continuation off other tracks - that picked up unrelated numbers.
    const ordered = visibleTracks(get())
      .filter((r) => targets.has(r.t.uid))
      .map((r) => r.t.uid);
    // real Yoto icons for 1-30; generated (matching 9-colour cycle) for 31-100
    const map = await fetchNumberIcons();
    const iconFor = (n: number) => {
      const real = n <= 30 ? map?.get(n) : undefined;
      return real ?? generateNumberIcon(n);
    };
    const assign = new Map<string, string>();
    ordered.forEach((uid, i) => {
      const n = i + 1;
      if (n <= 100) assign.set(uid, iconFor(n));
    });
    if (assign.size === 0) return;
    const undoStack = [...s.undoStack, JSON.stringify(card.tracks)].slice(-50);
    const tracks = card.tracks.map((t) => (assign.has(t.uid) ? { ...t, icon: assign.get(t.uid)! } : t));
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks, dirty: true } : c));
    persist(cards);
    set({ cards, undoStack, drawer: null, iconTargetUid: null });
    const over = ordered.length - assign.size;
    get().showToast(
      `Numbered ${assign.size} track(s): 1–${assign.size}` +
        (over > 0 ? ` (${over} past 100 skipped)` : ''),
    );
  },

  applyPixelNum: (current, fill, blockSide, opts) => {
    const s = get();
    const card = s.activeCard();
    if (!card) return;
    const targetUids = s.iconTargetUid ? [s.iconTargetUid] : [...s.selected];
    if (targetUids.length === 0) {
      get().showToast('Select tracks to number');
      return;
    }
    const targets = new Set(targetUids);
    // position within the selection, in the visible (sorted/filtered) order
    const orderedRows = visibleTracks(get()).filter((r) => targets.has(r.t.uid));
    const ordered = orderedRows.map((r) => r.t.uid);
    const count = ordered.length;
    // when grouping, each track's lit pixel takes its name-group's colour
    const groups = opts?.groupByName ? suggestGroups(orderedRows.map((r) => r.t.title)) : null;
    const fillPrevious = opts?.fillPrevious ?? false;
    const iconByUid = new Map<string, string>();
    ordered.forEach((uid, i) => {
      // grouped: earlier groups' finished pixels stay the fill colour, only the
      // current group's progress takes its group colour (see groupIconColors).
      const icon = groups
        ? pixelNumColorsDataUrl(groupIconColors(i, groups, fill, fillPrevious), blockSide)
        : pixelNumDataUrl(i, count, current, fill, blockSide, fillPrevious);
      iconByUid.set(uid, icon);
    });
    const undoStack = [...s.undoStack, JSON.stringify(card.tracks)].slice(-50);
    const tracks = card.tracks.map((t) =>
      iconByUid.has(t.uid) ? { ...t, icon: iconByUid.get(t.uid)! } : t,
    );
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks, dirty: true } : c));
    persist(cards);
    set({ cards, undoStack, drawer: null, iconTargetUid: null });
    const maxBlocks = Math.floor(16 / blockSide) ** 2;
    const over = count - Math.min(count, maxBlocks);
    const groupCount = groups ? Math.max(...groups) + 1 : 0;
    get().showToast(
      `PixelNum painted on ${count} track(s)` +
        (groups ? ` in ${groupCount} group(s)` : '') +
        (over > 0 ? ` (${over} beyond ${maxBlocks} skipped)` : ''),
    );
  },

  setCover: (dataUrl) => {
    const s = get();
    const card = s.activeCard();
    if (!card) return;
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, cover: dataUrl, dirty: true } : c));
    persist(cards);
    set({ cards });
    get().showToast('Cover updated');
  },

  setCardTitle: (title) => {
    const s = get();
    const card = s.activeCard();
    const next = title.trim();
    if (!card || !next || next === card.title) return;
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, title: next, dirty: true } : c));
    persist(cards);
    set({ cards });
    get().showToast('Title updated');
  },

  setCardDescription: (description) => {
    const s = get();
    const card = s.activeCard();
    if (!card || (card.description ?? '') === description) return;
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, description, dirty: true } : c));
    persist(cards);
    set({ cards });
  },

  setSetting: (key, value) => {
    const s = get();
    const card = s.activeCard();
    if (!card || card.settings[key] === value) return;
    const settings = { ...card.settings, [key]: value };
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, settings, dirty: true } : c));
    persist(cards);
    set({ cards });
  },

  openDrawer: (m) => set({ drawer: m, iconTargetUid: null }),
  openIconPicker: (uid) => set({ drawer: 'icon', iconTargetUid: uid ?? null }),
  openAudioEditor: (uid) => set({ drawer: 'audioedit', audioEditUid: uid }),
  applyTrackAudio: (uid, patch) => {
    const s = get();
    const card = s.activeCard();
    if (!card) return;
    const undoStack = [...s.undoStack, JSON.stringify(card.tracks)].slice(-50);
    const tracks = card.tracks.map((t) =>
      t.uid === uid ? { ...t, trackUrl: patch.trackUrl, duration: patch.duration, size: patch.size } : t,
    );
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks, dirty: true } : c));
    persist(cards);
    set({ cards, undoStack, drawer: null, audioEditUid: null });
    get().showToast('Audio trimmed - publish to save it on Yoto');
  },
  closeDrawer: () => set({ drawer: null, iconTargetUid: null, audioEditUid: null }),

  undo: () => {
    const s = get();
    const card = s.activeCard();
    if (!card || s.undoStack.length === 0) {
      get().showToast('Nothing to undo');
      return;
    }
    const stack = s.undoStack.slice();
    const prev = JSON.parse(stack.pop()!) as Track[];
    const cards = s.cards.map((c) => (c.id === card.id ? { ...c, tracks: prev } : c));
    persist(cards);
    set({ cards, undoStack: stack, selected: new Set() });
  },

  publish: async () => {
    const s = get();
    const card = s.activeCard();
    if (!card) return;
    if (!s.authed) {
      get().showToast('Sign in to Yoto to save changes');
      return;
    }
    set({ publishing: true });
    try {
      const res = await updatePlaylist(card);
      if (!res.ok) {
        set({ publishing: false });
        if (res.needScope) {
          get().showToast('Saving needs content access - sign out and back in to grant it');
        } else {
          get().showToast(`Update failed: ${res.reason ?? 'unknown error'}`);
        }
        return;
      }
      // how much of the PLAYLIST changed (undoStack[0] = tracks before the first
      // edit this session). Card title/description/cover aren't tracks, so they
      // never count. 3+ track changes earns the celebration.
      const baseline = s.undoStack.length ? (JSON.parse(s.undoStack[0]) as Track[]) : card.tracks;
      const playlistChanges = countPlaylistChanges(baseline, card.tracks);

      // committed on Yoto: clear the dirty flag and re-number locally to match.
      // On create, adopt the server-assigned cardId so future edits update it.
      const newId = res.newCardId ?? card.id;
      const st = get();
      const numbered = card.settings.showTrackNumbers;
      const tracks = card.tracks.map((t, i) => ({
        ...t,
        overlayLabel: numbered ? String(i + 1) : undefined,
      }));
      const cards = st.cards.map((c) =>
        c.id === card.id ? { ...c, id: newId, dirty: false, loaded: true, tracks } : c,
      );
      persist(cards);
      saveCardCache(cards);
      set({
        cards,
        activeId: st.activeId === card.id ? newId : st.activeId,
        publishing: false,
        undoStack: [],
        celebrate: playlistChanges >= 3,
      });
      get().showToast(res.newCardId ? `Created "${card.title}" on Yoto` : `Updated "${card.title}" on Yoto`);
      // pull server truth back: fresh signed stream URLs + resolved icons, and a
      // clean dirty/undo state (also makes a just-uploaded track playable).
      void get().reloadCard(newId);
    } catch (e) {
      set({ publishing: false });
      get().showToast(`Update failed: ${(e as Error).message}`);
    }
  },

  discardDraft: () => {
    const s = get();
    const card = s.activeCard();
    if (!card || !card.dirty) return;
    set({ selected: new Set() });
    if (s.authed) {
      // real card: refetch canonical state from Yoto (clears dirty/undo)
      void s.reloadCard(card.id);
      get().showToast('Draft discarded, reloaded from Yoto');
      return;
    }
    // mock mode (no OAuth): reset just this card from fresh mock
    const fresh = mockCards().find((c) => c.id === card.id);
    if (!fresh) return;
    const cards = s.cards.map((c) => (c.id === card.id ? fresh : c));
    persist(cards);
    set({ cards, undoStack: [] });
    get().showToast('Draft discarded, reloaded from Yoto');
  },

  showToast: (msg) => {
    set({ toast: msg });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 1900);
  },
}));
