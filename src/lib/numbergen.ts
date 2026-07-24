/**
 * Generate number icons beyond Yoto's shipped 1-30 set. The real library icons
 * cycle a 9-colour palette (1=yellow, 2=sky … 10=yellow again). We reuse that
 * colour cycle and render the digits with a fitted bold font that always leaves
 * a 1px margin, so generated 31-100 icons match the library's colour and never
 * clip at the tile edge. Icons are 16x16 PNG data URLs (UI-only until uploaded).
 */

/** The 9-colour cycle sampled from the real "Numbers - N" icons. */
export const NUMBER_COLORS = [
  '#ffde40', // 1
  '#41c0f0', // 2
  '#eb5e44', // 3
  '#a1c519', // 4
  '#d69fc8', // 5
  '#e53215', // 6
  '#f8ae11', // 7
  '#44b481', // 8
  '#3778bc', // 9
];

/** Colour for a given number, cycling every 9 like the real icon set. */
export const numberColor = (n: number) => NUMBER_COLORS[(n - 1) % NUMBER_COLORS.length];

// A 16px display is tiny, so we render the digits with a bold font and auto-fit
// them into a 14x14 inner box (1px margin all round) - big as possible, but
// never touching an edge, for any digit count (2 digits, or "100"). We render at
// 4x on an offscreen canvas then downscale, so the strokes stay clean.
const PAD = 1; // margin round the glyphs, in 16px units
const SUP = 4; // supersample factor for the offscreen render

/** Build a 16x16 PNG data URL for `n` using a fitted bold font + Yoto's colour. */
export function generateNumberIcon(n: number): string {
  const s = String(n);
  const inner = (16 - PAD * 2) * SUP; // usable box at supersampled scale
  const off = document.createElement('canvas');
  off.width = 16 * SUP;
  off.height = 16 * SUP;
  const octx = off.getContext('2d')!;
  octx.fillStyle = numberColor(n);
  octx.textAlign = 'center';
  octx.textBaseline = 'alphabetic';

  // Size the font by HEIGHT so digits fill the tile vertically (tall, like the
  // real icons), then squash horizontally if two/three digits overrun the width.
  let px = 4;
  for (let p = inner + 12; p >= 4; p--) {
    octx.font = `800 ${p}px Arial, sans-serif`;
    const m = octx.measureText(s);
    const h = (m.actualBoundingBoxAscent || p * 0.72) + (m.actualBoundingBoxDescent || p * 0.04);
    if (h <= inner) { px = p; break; }
  }
  octx.font = `800 ${px}px Arial, sans-serif`;
  const m = octx.measureText(s);
  const asc = m.actualBoundingBoxAscent || px * 0.72;
  const desc = m.actualBoundingBoxDescent || px * 0.04;
  const scaleX = m.width > inner ? inner / m.width : 1; // condense wide numbers

  const cx = (16 * SUP) / 2;
  const baseline = (16 * SUP) / 2 + (asc - desc) / 2;
  octx.save();
  octx.translate(cx, 0);
  octx.scale(scaleX, 1);
  octx.fillText(s, 0, baseline);
  octx.restore();

  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, 16, 16);

  // snap the anti-aliased edges to hard pixels so the digits read crisp on the
  // 16x16 display: any pixel over the threshold becomes fully-opaque solid
  // colour, everything else fully transparent (a clean 1-bit mask).
  const [rC, gC, bC] = hexRgb(numberColor(n));
  const img = ctx.getImageData(0, 0, 16, 16);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= 128) {
      data[i] = rC;
      data[i + 1] = gC;
      data[i + 2] = bC;
      data[i + 3] = 255;
    } else {
      data[i + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
