import type { Card } from '../types';
import { fetchCanonicalCard } from './content';
import { uploadDisplayIcon } from './icons';

const YOTO = '/api/yoto';

export interface PublishResult {
  ok: boolean;
  /** the token can't read the canonical content object (needs user:content:view) */
  needScope?: boolean;
  reason?: string;
  /** set when a brand-new local card was created on Yoto: its assigned cardId */
  newCardId?: string;
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

export async function updatePlaylist(card: Card): Promise<PublishResult> {
  // brand-new local cards are CREATED (POST without cardId); existing ones need
  // the canonical read so we can preserve their yoto:# refs.
  const creating = isLocalNew(card.id);
  const raw = creating ? null : await fetchCanonicalCard(card.id);
  if (!creating && !raw) return { ok: false, needScope: true };

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
    const key = String(i).padStart(2, '0');
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
      tracks: [innerTrack],
    };
  });

  // Clean payload matching the shape Yoto accepts: no createdAt/updatedAt/deleted.
  // Loop maps to content.config.autoadvance ('repeat' = loop, 'next' = continue).
  const config = { ...raw?.content?.config, autoadvance: card.settings.loop ? 'repeat' : 'next' };
  const payload: Record<string, unknown> = {
    // omit cardId when creating - Yoto assigns one and returns it
    ...(creating ? {} : { cardId: raw!.cardId }),
    title: card.title,
    ...(raw?.slug ? { slug: raw.slug } : {}),
    metadata: { ...raw?.metadata, description: card.description ?? raw?.metadata?.description ?? '' },
    content: { ...raw?.content, config, chapters },
  };

  const res = await fetch(`${YOTO}/content`, {
    method: 'POST',
    credentials: 'same-origin',
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
  // on create, hand the store the real cardId so it can adopt it
  let newCardId: string | undefined;
  if (creating) {
    try {
      const j = (await res.json()) as { card?: { cardId?: string }; cardId?: string };
      newCardId = j.card?.cardId ?? j.cardId;
    } catch {
      /* ignore */
    }
  }
  return { ok: true, ...(newCardId ? { newCardId } : {}) };
}
