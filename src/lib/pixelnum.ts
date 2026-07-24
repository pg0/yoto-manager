/**
 * PixelNum - encode a track's number as a lit pixel on Yoto's 16x16 (256px)
 * display. Pixel index = number-1, laid out left→right then top→bottom. The
 * track's own pixel is the "current" color; every other pixel up to the highest
 * number in the batch is the "fill" color; the rest stay transparent. Applied to
 * a run of tracks this paints a progress bar you can read at a glance, and each
 * run (story) can carry its own colour.
 */

export interface Swatch {
  name: string;
  /** css color, or the literal 'transparent' */
  value: string;
}

/** The palette from the Yoto MYO editor (first entry is transparent). */
export const PIXEL_PALETTE: Swatch[] = [
  { name: 'Transparent', value: 'transparent' },
  { name: 'White', value: '#ffffff' },
  { name: 'Light grey', value: '#ced4da' },
  { name: 'Grey', value: '#868e96' },
  { name: 'Slate', value: '#495862' },
  { name: 'Near black', value: '#141a24' },
  { name: 'Red', value: '#ff5a52' },
  { name: 'Orange', value: '#ff8a3d' },
  { name: 'Yellow', value: '#ffd43b' },
  { name: 'Lime', value: '#94d82d' },
  { name: 'Mint', value: '#2ad4a5' },
  { name: 'Sky', value: '#3db9ff' },
  { name: 'Blue', value: '#6d8bff' },
  { name: 'Purple', value: '#b18cf5' },
  { name: 'Pink', value: '#ff8ed6' },
  { name: 'Hot pink', value: '#ff4d8d' },
  { name: 'Brown', value: '#a1683a' },
  { name: 'Dark brown', value: '#4d2e1a' },
  { name: 'Dark green', value: '#0b7a52' },
  { name: 'Dark blue', value: '#114f7e' },
  { name: 'Maroon', value: '#7a1038' },
];

export const PIXELNUM_DEFAULT_CURRENT = '#ff8a3d';
export const PIXELNUM_DEFAULT_FILL = '#000000';

/**
 * Colours cycled across auto-detected name groups. It walks the palette in
 * order starting at red (#ff5a52) - red, orange, yellow, lime, mint, sky … - so
 * adjacent stories stay tellable apart and the sequence matches the swatch grid.
 * The lit pixel still advances per track; only its colour changes at a group
 * boundary.
 */
export const GROUP_COLORS = PIXEL_PALETTE.slice(
  PIXEL_PALETTE.findIndex((s) => s.value === '#ff5a52'),
).map((s) => s.value);

export const groupColor = (g: number) => GROUP_COLORS[g % GROUP_COLORS.length];

/**
 * Assign a 0-based group index to each title by name similarity, scanning in
 * order so groups are runs of adjacent tracks. Two strategies, first that fits:
 *   1. leading-number series - "01-01, 01-02, 02-01" or "1.3": the first number
 *      is the group key, a new run starts when it changes.
 *   2. common word-prefix - "Kokosnuss - … Folge 1", "… Folge 2" share a long
 *      prefix and stay one group; a title that diverges early starts a new one.
 */
export function suggestGroups(titles: string[]): number[] {
  const n = titles.length;
  if (n === 0) return [];

  // 1. leading-number series, e.g. "191-01: …", "101-02: …". The first number is
  //    the story key. We only need MOST titles to carry one (an intro/titlesong
  //    with no number just becomes its own group), not all of them.
  const keyOf = (t: string) => {
    const m = t.match(/^\s*(\d{1,4})\s*[-_.:]\s*\d/);
    return m ? String(parseInt(m[1], 10)) : null;
  };
  const keys = titles.map(keyOf);
  if (keys.filter((k) => k !== null).length >= n / 2) {
    const out: number[] = [];
    let g = -1;
    let prev: string | null | undefined;
    for (let i = 0; i < n; i++) {
      const k = keys[i];
      // a keyless track (or a changed key) opens a new group; equal keys share it
      if (k === null || k !== prev) g++;
      out.push(g);
      prev = k;
    }
    return out;
  }

  // 2. common word-prefix between consecutive titles, ignoring leading pure-number
  //    tokens (they're the episode discriminator, not the story name).
  const norm = (t: string) => {
    const w = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
    while (w.length > 1 && /^\d+$/.test(w[0])) w.shift();
    return w;
  };
  const words = titles.map(norm);
  const commonPrefix = (a: string[], b: string[]) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };
  const out: number[] = [0];
  let g = 0;
  for (let i = 1; i < n; i++) {
    const cp = commonPrefix(words[i - 1], words[i]);
    const minLen = Math.min(words[i - 1].length, words[i].length);
    const similar = cp >= 2 || (minLen > 0 && cp / minLen >= 0.5);
    if (!similar) g++;
    out.push(g);
  }
  return out;
}

/**
 * Per-pixel colours for the grouped variant. The current track's pixel, and
 * (with fillPrevious) the already-finished pixels OF THE SAME group, take the
 * group colour; finished pixels from EARLIER groups - and every future pixel -
 * stay the fill colour. So the moving pixel changes colour at a group boundary
 * while previous groups read as the neutral fill, keeping boundaries visible.
 */
export function groupIconColors(
  index0: number,
  groups: number[],
  fill: string,
  fillPrevious: boolean,
): string[] {
  const gi = groups[index0];
  const cur = groupColor(gi);
  return groups.map((g, j) => {
    if (j === index0) return cur;
    if (fillPrevious && j < index0 && g === gi) return cur;
    return fill;
  });
}

/**
 * Like pixelNumDataUrl but each block's colour is given explicitly by index
 * ('transparent'/'' paints nothing). Used by the grouped progress variant.
 */
export function pixelNumColorsDataUrl(colors: string[], blockSide = 1): string {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 16, 16);
  const perRow = Math.floor(16 / blockSide);
  const total = Math.min(colors.length, perRow * perRow);
  for (let i = 0; i < total; i++) {
    const color = colors[i];
    if (!color || color === 'transparent') continue;
    ctx.fillStyle = color;
    ctx.fillRect((i % perRow) * blockSide, Math.floor(i / perRow) * blockSide, blockSide, blockSide);
  }
  return canvas.toDataURL('image/png');
}

/** Block side (px) → how many tracks fit on the 16x16 grid. */
export const PIXELNUM_SIZES = [
  { side: 1, area: 1, max: 100 }, // 256 pixels, but a card holds ≤100 songs
  { side: 2, area: 4, max: 64 },
  { side: 4, area: 16, max: 16 },
];
export const PIXELNUM_DEFAULT_SIZE = 2;

/**
 * Build a 16x16 PNG data URL for the track at `index0` (0-based) within a batch
 * of `count` tracks. Each track is a `blockSide`×`blockSide` block, laid out
 * left→right then top→bottom. `current`/`fill` are css colors ('transparent'
 * paints nothing). Renders crisply with image-rendering: pixelated.
 */
export function pixelNumDataUrl(
  index0: number,
  count: number,
  current: string,
  fill: string,
  blockSide = 1,
  fillPrevious = false,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 16, 16);
  const perRow = Math.floor(16 / blockSide);
  const maxBlocks = perRow * perRow;
  const total = Math.min(count, maxBlocks);
  for (let i = 0; i < total; i++) {
    // in progress mode the finished tracks (0..index0) share the current colour,
    // so each icon reads as a bar that fills up to the playing track
    const isCurrent = fillPrevious ? i <= index0 : i === index0;
    const color = isCurrent ? current : fill;
    if (!color || color === 'transparent') continue;
    ctx.fillStyle = color;
    ctx.fillRect((i % perRow) * blockSide, Math.floor(i / perRow) * blockSide, blockSide, blockSide);
  }
  return canvas.toDataURL('image/png');
}
