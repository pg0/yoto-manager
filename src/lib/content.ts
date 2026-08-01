import { DEFAULT_SETTINGS, type Card, type Track } from '../types';
import { yotoFetch } from './auth';

// Read path against the documented Yoto content API (yoto.dev/api/content,
// yoto.dev/reference/card-content-schema, yoto.dev/myo/how-playlists-work).
// Calls go straight to api.yotoplay.com; yotoFetch attaches this browser's
// bearer token and refreshes it when needed.

// --- documented raw shapes (only the fields we read) ---
interface RawDisplay {
  /** yoto:#<sha> reference */
  icon16x16?: string;
  /** fully-qualified 16x16 png URL */
  iconUrl16x16?: string;
}
interface RawTrack {
  key: string;
  title?: string;
  duration?: number; // seconds
  fileSize?: number; // bytes
  overlayLabel?: string;
  display?: RawDisplay;
  trackUrl?: string;
  type?: string; // 'audio'
  format?: string;
  channels?: string;
}
interface RawChapter {
  key: string;
  title?: string;
  overlayLabel?: string;
  duration?: number; // seconds (chapter total)
  fileSize?: number; // bytes (chapter total)
  display?: RawDisplay;
  tracks?: RawTrack[];
}
interface RawContent {
  chapters?: RawChapter[];
  config?: {
    autoadvance?: 'next' | 'repeat' | 'none';
    /** chapter ranges to shuffle; present and non-empty means shuffle is on */
    shuffle?: { start: number; end: number; limit: number }[];
  } & Record<string, unknown>;
  [k: string]: unknown;
}
interface RawCardMeta {
  cover?: { imageL?: string };
  media?: { duration?: number; fileSize?: number };
  description?: string;
  author?: string;
}
interface RawCardListItem {
  cardId: string;
  title?: string;
  slug?: string;
  metadata?: RawCardMeta;
  updatedAt?: string;
  /** owning account (auth0|…); same for all of /content/mine, differs for shared */
  userId?: string;
}
export interface RawCardFull extends RawCardListItem {
  content?: RawContent;
  metadata?: RawCardMeta;
  cardId: string;
}

/** Host that serves 16x16 icon PNGs by mediaId (no auth needed for GET). A
 *  `yoto:#<mediaId>` ref resolves to `${ICON_HOST}<mediaId>` - verified 200
 *  image/png, and it's the same host the icon library returns URLs on. */
export const ICON_HOST = 'https://media-secure-v2.api.yotoplay.com/icons/';

/** Resolve a display object to a usable icon URL, else null (UI shows default).
 *  The content API returns MYO icons ONLY as `yoto:#<mediaId>` refs (no resolved
 *  URL), so we map the ref to its media host - otherwise every loaded card shows
 *  blank/default icons. */
function iconOf(d?: RawDisplay): string | null {
  if (!d) return null;
  if (d.iconUrl16x16) return d.iconUrl16x16;
  if (d.icon16x16) {
    if (/^https?:\/\//.test(d.icon16x16)) return d.icon16x16;
    const m = d.icon16x16.match(/^yoto:#(.+)$/);
    if (m) return ICON_HOST + m[1];
  }
  return null;
}

/**
 * GET /content/mine - the user's own MYO cards. Documented as metadata-only
 * (no chapters); we build shells and lazy-load each card's tracks on open.
 */
export async function fetchCardList(): Promise<Card[]> {
  const r = await yotoFetch('content/mine');
  if (!r.ok) throw new Error(`GET /content/mine → ${r.status}`);
  const j = (await r.json()) as { cards?: RawCardListItem[] };
  return (j.cards ?? []).map(toShell);
}

function toShell(c: RawCardListItem): Card {
  return {
    id: c.cardId,
    title: c.title || '(untitled)',
    slug: c.slug || '',
    description: c.metadata?.description ?? '',
    cover: c.metadata?.cover?.imageL || '',
    dirty: false,
    loaded: false,
    durationSec: c.metadata?.media?.duration ?? 0,
    updatedAt: c.updatedAt,
    owner: c.userId,
    settings: { ...DEFAULT_SETTINGS },
    tracks: [],
  };
}

export interface CardDetail {
  tracks: Track[];
  cover: string;
  title: string;
  slug: string;
  loop: boolean;
  showTrackNumbers: boolean;
  shuffle: boolean;
}

/**
 * GET /content/{cardId} - full card with chapters (documented, needs
 * user:content:view). Falls back to /card/{cardId} if the current token
 * predates that scope, which returns the identical content object.
 */
/**
 * GET /content/{cardId} raw - the canonical card object with `yoto:#<sha>`
 * media/icon refs (NOT signed URLs). Needed to safely round-trip an update:
 * we start from server truth and overlay only our edits. Returns null when the
 * token lacks user:content:view (403) - the read-only /card fallback returns
 * signed URLs that must never be POSTed back.
 */
export async function fetchCanonicalCard(cardId: string): Promise<RawCardFull | null> {
  const id = encodeURIComponent(cardId);
  const r = await yotoFetch(`content/${id}`);
  if (!r.ok) return null;
  const j = (await r.json()) as { card?: RawCardFull };
  return j.card ?? null;
}

/**
 * Delete a card via DELETE /content/{cardId} (verified: the route exists and
 * accepts DELETE; a bogus id returns 404 not-found rather than 405). Throws with
 * the server message on failure so the UI can surface it.
 */
export async function deleteCardRemote(cardId: string): Promise<void> {
  const id = encodeURIComponent(cardId);
  const r = await yotoFetch(`content/${id}`, { method: 'DELETE' });
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const j = await r.json();
      msg = j?.error?.message || j?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
}

/**
 * GET /card/{id} and map each chapter key → its signed https trackUrl. The
 * read-only /card endpoint resolves media refs to signed streaming URLs, whereas
 * /content returns bare `yoto:#<sha>` refs the browser can't play. Returns an
 * empty map on any failure - playback just stays disabled, nothing throws.
 */
async function fetchSignedTrackUrls(id: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const r = await yotoFetch(`card/${id}`);
    if (!r.ok) return map;
    const j = (await r.json()) as { card?: RawCardFull };
    for (const ch of j.card?.content?.chapters ?? []) {
      const u = ch.tracks?.[0]?.trackUrl;
      if (u && /^https?:\/\//.test(u)) map.set(ch.key, u);
    }
  } catch {
    /* ignore - no playable URLs */
  }
  return map;
}

export async function fetchCardDetail(cardId: string): Promise<CardDetail> {
  const id = encodeURIComponent(cardId);
  let r = await yotoFetch(`content/${id}`);
  // /content carries the canonical structure + refs; when it's forbidden we fall
  // back to /card, which already returns signed (playable) URLs directly.
  let viaContent = r.ok;
  if (r.status === 403) {
    r = await yotoFetch(`card/${id}`);
    viaContent = false;
  }
  if (!r.ok) throw new Error(`GET /content/${cardId} → ${r.status}`);
  const j = (await r.json()) as { card?: RawCardFull };
  const card = j.card;
  const content = card?.content;
  const chapters = content?.chapters ?? [];

  // /content returns trackUrl as a non-playable yoto:# ref, so pull the signed
  // streaming URLs from /card and merge them in by chapter key.
  const signedByKey = viaContent ? await fetchSignedTrackUrls(id) : null;

  // MYO cards are one track per chapter; the chapter carries the user-facing
  // title / icon / number, so a chapter maps to one UI row.
  const tracks: Track[] = chapters.map((ch, i) => {
    const tr = ch.tracks?.[0];
    const rawTrack = tr?.trackUrl && /^https?:\/\//.test(tr.trackUrl) ? tr.trackUrl : undefined;
    return {
      key: ch.key,
      uid: `${cardId}:${ch.key}:${i}`,
      title: ch.title || tr?.title || `Track ${i + 1}`,
      duration: ch.duration ?? tr?.duration ?? 0,
      size: ch.fileSize ?? tr?.fileSize ?? 0,
      icon: iconOf(ch.display) ?? iconOf(tr?.display),
      emoji: null,
      overlayLabel: ch.overlayLabel ?? tr?.overlayLabel,
      trackUrl: signedByKey?.get(ch.key) ?? rawTrack,
    };
  });

  return {
    tracks,
    cover: card?.metadata?.cover?.imageL || '',
    title: card?.title || '',
    slug: card?.slug || '',
    loop: content?.config?.autoadvance === 'repeat',
    showTrackNumbers: chapters.some((ch) => !!ch.overlayLabel),
    shuffle: (content?.config?.shuffle?.length ?? 0) > 0,
  };
}
