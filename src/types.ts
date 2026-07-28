/** What the player does when a track finishes. Maps to Yoto track end config. */
export type TrackEnd = 'continue' | 'repeat' | 'pause';

export interface Track {
  /** Yoto chapter/track key, e.g. "01". Recomputed on publish. */
  key: string;
  /** stable local id for selection & React keys */
  uid: string;
  title: string;
  /** seconds */
  duration: number;
  /** bytes */
  size: number;
  /** data: URL in mock; `yoto:#<sha>` resolved to a URL in the real app */
  icon: string | null;
  /** mock helper: which emoji produced the icon (real app stores mediaId) */
  emoji: string | null;
  /** display number badge in the Yoto app */
  overlayLabel?: string;
  /** on-end behavior; undefined = 'continue' (default) */
  onEnd?: TrackEnd;
  /** streamable media URL (secure-media.yotoplay.com) for in-app playback */
  trackUrl?: string;
}

/** Card-level playback config pushed to Yoto on publish. */
export interface CardSettings {
  /** show the track-number badge on the Yoto player screen (overlayLabel) */
  showTrackNumbers: boolean;
  /** repeat the card from the top when the last track ends */
  loop: boolean;
}

export const DEFAULT_SETTINGS: CardSettings = { showTrackNumbers: true, loop: false };

export interface Card {
  id: string;
  title: string;
  slug: string;
  /** Yoto metadata.description; editable inline, round-tripped on publish */
  description?: string;
  cover: string;
  /** has unpublished local-draft edits */
  dirty: boolean;
  /** real cards start as metadata-only shells; tracks are lazy-loaded on open */
  loaded?: boolean;
  /** total seconds from card metadata, so the rail shows minutes before load */
  durationSec?: number;
  /** track count, filled from the stats cache or a background detail fetch */
  trackCount?: number;
  /** Yoto's card updatedAt, used to invalidate the cached stats */
  updatedAt?: string;
  /** owning Yoto userId; used to group the rail when family/shared cards appear */
  owner?: string;
  settings: CardSettings;
  tracks: Track[];
}

export type SortKey = 'index' | 'title' | 'duration' | 'size';
export type DrawerMode = 'rename' | 'icon' | 'audioedit' | null;

export interface RenameResult {
  uid: string;
  next: string;
  err: string | null;
}
