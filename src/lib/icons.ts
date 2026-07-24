import { ICON_EMOJI, pixIcon } from '../data/mock';

/** Yoto's default MYO track icon, shown when a track has no custom icon set. */
export const DEFAULT_TRACK_ICON =
  'https://media-secure-v2.api.yotoplay.com/icons/aUm9i3ex3qqAMYBv-i-O-pYMKuMJGICtR3Vhf289u2Q';

export interface YotoIcon {
  mediaId: string;
  title: string;
  url: string;
  tags: string[];
}

/**
 * Real Yoto icon endpoints require an authenticated call through the backend
 * proxy (`/api/yoto/*`). The public library returns 401 without a token, so in
 * M0 (no backend/OAuth yet) these resolve to [] and the UI falls back to mock.
 */
async function proxyIcons(path: string): Promise<YotoIcon[] | null> {
  try {
    const r = await fetch(`/api/yoto/${path}`);
    if (!r.ok) return null;
    const data = await r.json();
    const mapped: YotoIcon[] = (data.displayIcons ?? []).map(
      (d: { mediaId: string; title?: string; url: string; publicTags?: string[] }) => ({
        mediaId: d.mediaId,
        title: d.title ?? '',
        url: d.url,
        tags: d.publicTags ?? [],
      }),
    );
    // the library returns the same icon under multiple ids - collapse by image URL
    const seen = new Set<string>();
    return mapped.filter((ic) => {
      const k = ic.url || ic.mediaId;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } catch {
    return null;
  }
}

export const fetchPublicIcons = () => proxyIcons('media/displayIcons/user/yoto');
export const fetchMyIcons = () => proxyIcons('media/displayIcons/user/me');

// sha256(bytes) -> yoto:#<mediaId>, so an identical generated icon uploads once.
const iconRefCache = new Map<string, string>();
const ICON_CACHE_KEY = 'yoto-manager:iconrefs:v1';
try {
  const raw = localStorage.getItem(ICON_CACHE_KEY);
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) iconRefCache.set(k, v);
} catch {
  /* ignore */
}
function persistIconCache() {
  try {
    localStorage.setItem(ICON_CACHE_KEY, JSON.stringify(Object.fromEntries(iconRefCache)));
  } catch {
    /* ignore */
  }
}
async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Upload a generated (data: URL) icon to Yoto's user icon library and return its
 * `yoto:#<mediaId>` ref - the only form the content API accepts in
 * display.icon16x16. Verified endpoint: POST /media/displayIcons/user/me/upload
 * (autoConvert) → { displayIcon: { mediaId } }. Dedupes by content hash across
 * the session (and reloads) so painting numbers on 40 tracks uploads each
 * distinct icon only once.
 */
export async function uploadDisplayIcon(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const buf = await blob.arrayBuffer();
  const sha = await sha256Hex(buf);
  const cached = iconRefCache.get(sha);
  if (cached) return cached;
  const params = new URLSearchParams({ autoConvert: 'true', filename: `icon-${sha.slice(0, 8)}.png` });
  const r = await fetch(`/api/yoto/media/displayIcons/user/me/upload?${params.toString()}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'image/png' },
    body: buf,
  });
  if (!r.ok) throw new Error(`icon upload ${r.status}`);
  const j = (await r.json()) as { displayIcon?: { mediaId?: string } };
  const mediaId = j.displayIcon?.mediaId;
  if (!mediaId) throw new Error('icon upload: no mediaId in response');
  const ref = `yoto:#${mediaId}`;
  iconRefCache.set(sha, ref);
  persistIconCache();
  return ref;
}

/**
 * The Yoto public library's canonical "Number - N" icon set, resolved to a
 * Map<1..30, iconUrl>. Titles are "Number - 1" then "Numbers - 2".."Numbers - 30";
 * a digit publicTag on the same icons is the fallback signal. Returns null if the
 * library can't be read (no token / offline).
 */
export async function fetchNumberIcons(): Promise<Map<number, string> | null> {
  const list = await fetchPublicIcons();
  if (!list) return null;
  const map = new Map<number, string>();
  for (const ic of list) {
    let n: number | undefined;
    const m = ic.title.trim().match(/^numbers?\s*-\s*(\d{1,2})$/i);
    if (m) n = +m[1];
    else {
      const digits = ic.tags.filter((t) => /^\d{1,2}$/.test(t));
      if (digits.length === 1 && ic.tags.some((t) => /^numbers?$/i.test(t))) n = +digits[0];
    }
    if (n && n >= 1 && n <= 30 && !map.has(n)) map.set(n, ic.url);
  }
  return map;
}

/**
 * Yoto's public API documents NO delete endpoint for display icons (only
 * GET list + POST upload, verified against the full yoto.dev API reference).
 * So there is no supported way to remove an uploaded icon; we never fire a
 * guessed DELETE. `false` = not supported.
 */
export const ICON_DELETE_SUPPORTED = false;
export async function deleteMyIcon(_mediaId: string): Promise<boolean> {
  return false;
}

/** Placeholder library so the picker is usable before OAuth is wired. */
export function mockIcons(): YotoIcon[] {
  const names = [
    'music', 'pirate', 'parrot', 'anchor', 'map', 'guitar', 'pig', 'wave',
    'star', 'microphone', 'elephant', 'bee', 'car', 'search', 'hero', 'trumpet',
    'rainbow', 'bell',
  ];
  return ICON_EMOJI.map((e, i) => ({
    mediaId: `mock:${i}`,
    title: names[i] ?? e,
    url: pixIcon(e, i),
    tags: [names[i] ?? ''],
  }));
}
