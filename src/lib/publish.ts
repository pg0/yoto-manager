import type { Card } from '../types';
import { fetchCanonicalCard, type RawCardFull } from './content';
import { uploadDisplayIcon } from './icons';
import { yotoFetch } from './auth';
import { saveSnapshot, type Snapshot } from './snapshots';

export interface PublishResult {
  ok: boolean;
  /** the token can't read the canonical content object (needs user:content:view) */
  needScope?: boolean;
  reason?: string;
  /** local state no longer matches the card on Yoto; the card was left untouched */
  stale?: boolean;
  /** set when a brand-new local card was created on Yoto: its assigned cardId */
  newCardId?: string;
  /** the card's updatedAt after the write, when Yoto returned it */
  updatedAt?: string;
}

/** True when `server` is a later timestamp than `local`. Unparseable or missing
 *  values never count as newer, so a format change on Yoto's side can't lock
 *  every save out. */
const isNewer = (server?: string, local?: string) => {
  if (!server || !local) return false;
  const s = Date.parse(server);
  const l = Date.parse(local);
  return !Number.isNaN(s) && !Number.isNaN(l) && s > l;
};

/** Strip the read-only bookkeeping fields Yoto rejects on POST. */
const writablePayload = (raw: RawCardFull, overrides: Record<string, unknown> = {}) => ({
  cardId: raw.cardId,
  title: raw.title,
  ...(raw.slug ? { slug: raw.slug } : {}),
  metadata: raw.metadata ?? {},
  content: raw.content ?? {},
  ...overrides,
});

async function postContent(payload: Record<string, unknown>): Promise<PublishResult> {
  const res = await yotoFetch('content', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 160);
    } catch {
      /* ignore */
    }
    return { ok: false, reason: `POST /content → ${res.status} ${detail}` };
  }
  // Yoto echoes the stored card back; pick up the id (on create) and the new
  // updatedAt so the next save's staleness check has the right baseline.
  let newCardId: string | undefined;
  let updatedAt: string | undefined;
  try {
    const j = (await res.json()) as { card?: { cardId?: string; updatedAt?: string }; cardId?: string };
    newCardId = j.card?.cardId ?? j.cardId;
    updatedAt = j.card?.updatedAt;
  } catch {
    /* ignore */
  }
  return { ok: true, ...(newCardId ? { newCardId } : {}), ...(updatedAt ? { updatedAt } : {}) };
}

/**
 * Put a card back to a saved version (see snapshots.ts). The current state on
 * Yoto is snapshotted first, so a restore is itself undoable.
 */
export async function restoreCard(snap: Snapshot): Promise<PublishResult> {
  const current = await fetchCanonicalCard(snap.card.cardId);
  if (!current) return { ok: false, needScope: true };
  saveSnapshot(current);
  return postContent(writablePayload(snap.card));
}

/** A locally-created card that has never been saved to Yoto (see store.newCard). */
const isLocalNew = (id: string) => id.startsWith('new_');

/**
 * Update an existing MYO playlist on Yoto (POST /content).
 *
 * Safety model: we never rebuild media/icon refs from the signed URLs that the
 * read-only /card endpoint returns. Instead we GET the canonical /content/{id}
 * object (which carries `yoto:#<sha>` refs), then overlay only the edits the
 * user actually made - order, titles, track-number badges, per-track icons,
 * and any newly uploaded tracks (whose trackUrl is already a `yoto:#<sha>`).
 * If the canonical read is forbidden we abort rather than POST bad refs.
 */
/** True for a value Yoto will accept in a display/trackUrl field (a `yoto:#<sha>`
 *  ref). Resolved https URLs and generated data: URLs are NOT accepted and must
 *  be uploaded first, so we keep the card's original ref instead. */
const isYotoRef = (v?: string | null): v is string => !!v && v.startsWith('yoto:#');

/** Coerce any icon value the store might hold into the `yoto:#<mediaId>` ref the
 *  content API needs: pass through an existing ref, and recover the mediaId from
 *  a resolved yotoplay icon-host URL (how loaded and library-picked icons look).
 *  data: URLs are handled separately (uploaded first); other values → undefined
 *  so we keep the card's original ref. */
const ICON_URL_RE = /^https?:\/\/[^/]*yotoplay\.com\/icons\/([A-Za-z0-9_-]+)/;
const toIconRef = (v?: string | null): string | undefined => {
  if (!v) return undefined;
  if (v.startsWith('yoto:#')) return v;
  const m = v.match(ICON_URL_RE);
  return m ? `yoto:#${m[1]}` : undefined;
};

/** Chapter keys are re-issued from array position on every publish, so Yoto
 *  plays the card in the order shown here. Exported because the store has to
 *  apply the same rule to its local tracks after a publish - otherwise the next
 *  publish looks its chapters up under keys the server no longer has. */
export const chapterKeyFor = (i: number) => String(i).padStart(2, '0');

export async function updatePlaylist(card: Card): Promise<PublishResult> {
  // brand-new local cards are CREATED (POST without cardId); existing ones need
  // the canonical read so we can preserve their yoto:# refs.
  const creating = isLocalNew(card.id);
  const raw = creating ? null : await fetchCanonicalCard(card.id);
  if (!creating && !raw) return { ok: false, needScope: true };

  // The write replaces the whole chapter list with what this browser shows. If
  // the card changed on Yoto after it was opened here (edited in the Yoto app,
  // or in another tab), those changes would be wiped - so refuse instead.
  if (raw && isNewer(raw.updatedAt, card.updatedAt)) {
    return {
      ok: false,
      stale: true,
      reason: 'this card changed on Yoto after you opened it - reload the card and redo the edit',
    };
  }

  const origChapters = raw?.content?.chapters ?? [];
  const byKey = new Map(origChapters.map((ch) => [ch.key, ch]));
  const numbered = card.settings.showTrackNumbers;

  // Generated icons (Numbers/PixelNum) are data: URLs; Yoto only accepts
  // yoto:#<mediaId> in display.icon16x16. Upload each distinct one first (deduped
  // by content hash) and map data-URL -> yoto ref. A failed upload just leaves
  // that track on its original icon rather than failing the whole publish.
  const dataIcons = [...new Set(card.tracks.map((t) => t.icon).filter((ic): ic is string => !!ic && ic.startsWith('data:')))];
  const refByData = new Map<string, string>();
  await Promise.all(
    dataIcons.map(async (d) => {
      try {
        refByData.set(d, await uploadDisplayIcon(d));
      } catch {
        /* keep original icon on failure */
      }
    }),
  );

  // Rebuild chapters in the user's (possibly reordered) track order. We start
  // from each track's ORIGINAL canonical chapter so every `yoto:#` media/icon
  // ref is preserved verbatim - Yoto 400s on resolved https or data: URLs. Only
  // title, number badge, chapter order/key, and icon (when changed) update.
  const chapters = card.tracks.map((t, i) => {
    const orig = byKey.get(t.key);
    const origTrack = orig?.tracks?.[0];
    const key = chapterKeyFor(i);
    const overlayLabel = numbered ? String(i + 1) : undefined;
    // prefer an uploaded generated icon, then recover a ref from the stored value
    // (yoto:# ref, or a resolved icon-host URL from load/library), else keep origin
    const uploadedRef = t.icon && t.icon.startsWith('data:') ? refByData.get(t.icon) : undefined;
    const iconRef = uploadedRef ?? toIconRef(t.icon);
    const display = iconRef ? { icon16x16: iconRef } : orig?.display;
    // a freshly uploaded track carries a yoto:# trackUrl; otherwise keep origin
    const trackUrl = isYotoRef(t.trackUrl) ? t.trackUrl : origTrack?.trackUrl;

    const innerTrack = {
      ...(origTrack ?? {}),
      key: '01',
      title: t.title,
      overlayLabel,
      duration: t.duration || origTrack?.duration || 0,
      fileSize: t.size || origTrack?.fileSize || 0,
      type: origTrack?.type ?? 'audio',
      ...(display ? { display } : {}),
      ...(trackUrl ? { trackUrl } : {}),
    };

    return {
      ...(orig ?? {}),
      key,
      title: t.title,
      overlayLabel,
      duration: t.duration || orig?.duration || 0,
      fileSize: t.size || orig?.fileSize || 0,
      ...(display ? { display } : {}),
      // a UI row is the chapter's FIRST track; any further tracks in that
      // chapter are carried over untouched. Writing just [innerTrack] would
      // delete them from the card - silently, on every publish.
      tracks: [innerTrack, ...(orig?.tracks ?? []).slice(1)],
    };
  });

  // Refuse to write a card that would lose audio. Every existing row has to map
  // to a chapter in the canonical read; a row whose key is gone means our local
  // keys drifted from the server's (a failed refetch after an earlier publish),
  // and saving it would blank that track's media on Yoto. Newly uploaded rows
  // carry their own yoto:# ref, so they are fine.
  const orphans = creating ? [] : card.tracks.filter((t) => !isYotoRef(t.trackUrl) && !byKey.has(t.key));
  if (orphans.length) {
    return {
      ok: false,
      stale: true,
      reason: `${orphans.length} track(s) no longer match this card on Yoto - reload the card and redo the edit`,
    };
  }

  // Clean payload matching the shape Yoto accepts: no createdAt/updatedAt/deleted.
  // Loop maps to content.config.autoadvance ('repeat' = loop, 'next' = continue).
  // Shuffle is a list of chapter ranges; "shuffle the whole card" is one range
  // covering every chapter, keeping all of them. Recomputed on every publish so
  // it still spans the card after tracks are added or removed. Off = empty list.
  const shuffle =
    card.settings.shuffle && chapters.length > 0
      ? [{ start: 0, end: chapters.length - 1, limit: chapters.length }]
      : [];
  const config = {
    ...raw?.content?.config,
    autoadvance: card.settings.loop ? 'repeat' : 'next',
    shuffle,
  };
  const payload: Record<string, unknown> = {
    // omit cardId when creating - Yoto assigns one and returns it
    ...(creating ? {} : { cardId: raw!.cardId }),
    title: card.title,
    ...(raw?.slug ? { slug: raw.slug } : {}),
    metadata: { ...raw?.metadata, description: card.description ?? raw?.metadata?.description ?? '' },
    content: { ...raw?.content, config, chapters },
  };

  // Last thing before the write: keep the card as Yoto had it, so a save that
  // turns out wrong can be put back (restoreCard).
  if (raw) saveSnapshot(raw);

  return postContent(payload);
}
