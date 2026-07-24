/**
 * Yoto MYO card capacity limits, preflight validation, and API-error remapping.
 *
 * Adapted from stuartromanek/louis (MIT) — shared/myo-editor/yotoMyoLimits.ts.
 * Original: https://github.com/stuartromanek/louis  © Stuart Romanek, MIT.
 * Trimmed of louis's YouTube/reuse coupling; typed against yoto-manager's own
 * track shape (duration in seconds, fileSize in bytes). Constants unchanged.
 */

/** Minimal track shape this module needs. Your fuller Track type is a superset. */
export interface CapacityTrack {
  title: string;
  /** seconds */
  duration?: number | null;
  /** bytes */
  fileSize?: number | null;
}

/** Official Yoto MYO card capacity (support.yotoplay.com). */
export const YOTO_MYO_MAX_TRACKS = 100;
export const YOTO_MYO_MAX_TRACK_SECONDS = 60 * 60;
export const YOTO_MYO_MAX_TRACK_BYTES = 100 * 1024 * 1024;
export const YOTO_MYO_MAX_CARD_SECONDS = 5 * 60 * 60;
export const YOTO_MYO_MAX_CARD_BYTES = 500 * 1024 * 1024;

export const YOTO_MYO_TRACK_COUNT_MESSAGE =
  'Yoto MYO cards allow up to 100 tracks. Remove some tracks before publishing.';

export const YOTO_MYO_CARD_TOTALS_MESSAGE =
  "This playlist exceeds Yoto's 5-hour / 500 MB card limit.";

export function formatTrackMediaLimitError(title: string): string {
  const label = title.trim() || 'This track';
  return `"${label}" is over Yoto's 60-minute / 100 MB per-track limit.`;
}

export function getTrackCountLimitError(count: number): string | null {
  return count > YOTO_MYO_MAX_TRACKS ? YOTO_MYO_TRACK_COUNT_MESSAGE : null;
}

export function getTrackMediaLimitError(input: CapacityTrack): string | null {
  const overDuration =
    typeof input.duration === 'number' &&
    Number.isFinite(input.duration) &&
    input.duration > YOTO_MYO_MAX_TRACK_SECONDS;
  const overSize =
    typeof input.fileSize === 'number' &&
    Number.isFinite(input.fileSize) &&
    input.fileSize > YOTO_MYO_MAX_TRACK_BYTES;
  return overDuration || overSize ? formatTrackMediaLimitError(input.title) : null;
}

export function getCardTotalsLimitError(input: {
  totalDuration: number;
  totalFileSize: number;
}): string | null {
  const overDuration =
    Number.isFinite(input.totalDuration) && input.totalDuration > YOTO_MYO_MAX_CARD_SECONDS;
  const overSize =
    Number.isFinite(input.totalFileSize) && input.totalFileSize > YOTO_MYO_MAX_CARD_BYTES;
  return overDuration || overSize ? YOTO_MYO_CARD_TOTALS_MESSAGE : null;
}

export interface PlaylistCapacitySnapshot {
  trackCount: number;
  trackMax: number;
  knownDurationSeconds: number;
  durationMax: number;
  knownFileSizeBytes: number;
  fileSizeMax: number;
  /** False when any track is missing a usable duration. */
  durationComplete: boolean;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

export function getPlaylistCapacitySnapshot(playlist: CapacityTrack[]): PlaylistCapacitySnapshot {
  const durations = playlist.map((t) => num(t.duration));
  const sizes = playlist.map((t) => num(t.fileSize));
  const knownDur = durations.filter((d): d is number => d !== undefined);
  const knownSize = sizes.filter((s): s is number => s !== undefined);
  return {
    trackCount: playlist.length,
    trackMax: YOTO_MYO_MAX_TRACKS,
    knownDurationSeconds: knownDur.reduce((a, n) => a + n, 0),
    durationMax: YOTO_MYO_MAX_CARD_SECONDS,
    knownFileSizeBytes: knownSize.reduce((a, n) => a + n, 0),
    fileSizeMax: YOTO_MYO_MAX_CARD_BYTES,
    durationComplete: playlist.length === 0 || knownDur.length === playlist.length,
  };
}

/** Compact MYO duration readout: `12m`, `1h 05m`, `5h`. */
export function formatCapacityDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  if (h <= 0) return `${m}m`;
  if (m <= 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * Client preflight using only known playlist fields. Returns the first error
 * found, or null. Incomplete metadata is ignored per field (the server still
 * enforces after transcode).
 */
export function getPlaylistPreflightLimitError(playlist: CapacityTrack[]): string | null {
  const countError = getTrackCountLimitError(playlist.length);
  if (countError) return countError;

  const durations = playlist.map((t) => num(t.duration));
  if (durations.every((d): d is number => d !== undefined)) {
    for (const t of playlist) {
      const e = getTrackMediaLimitError({ title: t.title, duration: t.duration });
      if (e) return e;
    }
    const e = getCardTotalsLimitError({
      totalDuration: durations.reduce((a, n) => a + n, 0),
      totalFileSize: 0,
    });
    if (e) return e;
  }

  const sizes = playlist.map((t) => num(t.fileSize));
  if (sizes.every((s): s is number => s !== undefined)) {
    for (const t of playlist) {
      const e = getTrackMediaLimitError({ title: t.title, fileSize: t.fileSize });
      if (e) return e;
    }
    const e = getCardTotalsLimitError({
      totalDuration: 0,
      totalFileSize: sizes.reduce((a, n) => a + n, 0),
    });
    if (e) return e;
  }

  return null;
}

const TRACK_MEDIA_LIMIT_MESSAGE_RE =
  /^"(.+)" is over Yoto's 60-minute \/ 100 MB per-track limit\.$/;

/**
 * Rewrite opaque Yoto API error text that looks like a capacity/limit failure
 * into a human message. Pass `trackTitle` when the failing track is known.
 * Returns null when the text does not look like a capacity error.
 */
export function mapYotoApiLimitError(
  message: string,
  trackTitle?: string | null,
): string | null {
  const text = message.trim();
  if (!text) return null;

  const titled = trackTitle?.trim() || '';
  const existing = text.match(TRACK_MEDIA_LIMIT_MESSAGE_RE);
  if (existing) {
    const label = existing[1] ?? 'This track';
    if (label !== 'This track') return null;
    return titled ? formatTrackMediaLimitError(titled) : null;
  }

  const lower = text.toLowerCase();

  if (/\b100\s*tracks?\b|\btrack\s*count\b|\btoo\s*many\s*tracks?\b/i.test(lower)) {
    return YOTO_MYO_TRACK_COUNT_MESSAGE;
  }

  const hintsCapacity =
    /(?:\b(?:limit|capacity|quota|exceed|maximum|filesize|file\s*size|duration)\b)|(?:too\s+(?:large|long))|(?:\b(?:100|500)\s*m(?:b|ib)\b)|(?:\b(?:60|5)\s*(?:min(?:ute)?s?|hours?)\b)/i.test(
      lower,
    );
  if (!hintsCapacity) return null;

  if (
    /\b(?:500\s*m(?:b|ib)|5\s*hours?|card\s*(?:limit|capacity|total)|playlist\s*(?:limit|capacity))\b/i.test(
      lower,
    )
  ) {
    return YOTO_MYO_CARD_TOTALS_MESSAGE;
  }

  if (
    /\b(?:100\s*m(?:b|ib)|60\s*min(?:ute)?s?|per[- ]?track|single\s*track|track\s*(?:limit|too\s*(?:large|long)))\b/i.test(
      lower,
    )
  ) {
    return formatTrackMediaLimitError(titled || 'This track');
  }

  return YOTO_MYO_CARD_TOTALS_MESSAGE;
}

export function withMappedYotoLimitError(message: string, trackTitle?: string | null): string {
  return mapYotoApiLimitError(message, trackTitle) ?? message;
}
