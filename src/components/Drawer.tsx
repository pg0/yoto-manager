import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { DEFAULT_TRACK_ICON, fetchMyIcons, fetchPublicIcons, hideMyIcons, mockIcons, type YotoIcon } from '../lib/icons';
import { decodeTrackAudio, cutToWavFile } from '../lib/audioedit';
import { uploadAudioFile } from '../lib/upload';
import { fmtDur } from '../lib/format';
import {
  PIXELNUM_DEFAULT_CURRENT,
  PIXELNUM_DEFAULT_FILL,
  PIXELNUM_DEFAULT_SIZE,
  PIXELNUM_SIZES,
  PIXEL_PALETTE,
  pixelNumDataUrl,
  pixelNumColorsDataUrl,
  suggestGroups,
  groupIconColors,
} from '../lib/pixelnum';
import type { RenameResult, Track } from '../types';

type IconSort = 'default' | 'az' | 'za';
type IconTab = 'public' | 'mine' | 'pixelnum' | 'upload';

/**
 * Upload your own image as a track icon: pick/drop a file, cover-fit + zoom it
 * onto a 16x16 canvas (optionally posterised so it reads as pixel art), and hand
 * the resulting data: URL up. Publish uploads data: icons to Yoto automatically
 * (uploadDisplayIcon), so no extra plumbing is needed here.
 */
function CustomIconPanel({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [name, setName] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pixel, setPixel] = useState(16); // output grid: 16 = full res, 8/4 = chunkier
  const [dragover, setDragover] = useState(false);

  function loadFile(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      setImg(im);
      setName(file.name);
      URL.revokeObjectURL(url);
    };
    im.src = url;
  }

  const dataUrl = useMemo(() => {
    if (!img) return null;
    // render at the chosen grid size (cover-fit + zoom), then upscale to 16x16
    // with nearest-neighbour so a chunky grid stays crisp.
    const g = pixel;
    const tmp = document.createElement('canvas');
    tmp.width = g;
    tmp.height = g;
    const tc = tmp.getContext('2d')!;
    const scale = Math.max(g / img.width, g / img.height) * zoom;
    const dw = img.width * scale;
    const dh = img.height * scale;
    tc.imageSmoothingEnabled = true;
    tc.drawImage(img, (g - dw) / 2, (g - dh) / 2, dw, dh);
    if (g === 16) return tmp.toDataURL('image/png');
    const out = document.createElement('canvas');
    out.width = 16;
    out.height = 16;
    const oc = out.getContext('2d')!;
    oc.imageSmoothingEnabled = false;
    oc.drawImage(tmp, 0, 0, 16, 16);
    return out.toDataURL('image/png');
  }, [img, zoom, pixel]);

  // publish the current render up to the drawer for the Apply button
  useEffect(() => {
    onChange(dataUrl);
  }, [dataUrl, onChange]);

  return (
    <div className={`iconup${dragover ? ' dragover' : ''}`}>
      <label
        className="iu-drop"
        onDragOver={(e) => {
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragover(false);
          loadFile(e.dataTransfer.files[0]);
        }}
      >
        <input type="file" accept="image/*" onChange={(e) => loadFile(e.target.files?.[0])} />
        {name ? `📷 ${name}` : '📷 Choose or drop an image'}
      </label>
      {img && dataUrl && (
        <div className="iu-row">
          <img className="iu-prev" src={dataUrl} alt="icon preview" />
          <div className="iu-ctrls">
            <div className="iu-slider">
              <span>Zoom</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(+e.target.value)}
              />
            </div>
            <div className="iu-slider">
              <span>Pixel</span>
              <input
                type="range"
                min={4}
                max={16}
                step={4}
                value={pixel}
                onChange={(e) => setPixel(+e.target.value)}
              />
              <span>{pixel === 16 ? 'full' : `${pixel}×${pixel}`}</span>
            </div>
          </div>
        </div>
      )}
      <p className="hint">The image is fitted to Yoto's 16x16 icon grid and uploaded on publish.</p>
    </div>
  );
}

/** Normalise a #rgb/#rrggbb/#rrggbbaa (or bare) hex to #rrggbb, or null. */
function normHex(v: string): string | null {
  let s = v.trim().toLowerCase();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7);
  return null;
}
/** Split a stored colour into an opaque hex + an alpha 0..1. */
function parseColor(value: string): { hex: string; alpha: number } {
  if (!value || value === 'transparent') return { hex: '#000000', alpha: 0 };
  const s = value.trim().toLowerCase();
  if (/^#[0-9a-f]{8}$/.test(s)) return { hex: s.slice(0, 7), alpha: parseInt(s.slice(7), 16) / 255 };
  return { hex: normHex(s) ?? '#000000', alpha: 1 };
}
/** Recombine hex + alpha into 'transparent' | #rrggbb | #rrggbbaa. */
function composeColor(hex: string, alpha: number): string {
  if (alpha <= 0) return 'transparent';
  if (alpha >= 1) return hex;
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

/** Swatch-grid quick picks plus a hex field and an alpha (transparency) slider.
 *  Stores 'transparent', #rrggbb, or #rrggbbaa. */
function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { hex, alpha } = parseColor(value);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commitText = (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (t === 'transparent' || t === '') return onChange('transparent');
    if (/^#?[0-9a-f]{8}$/.test(t)) return onChange((t.startsWith('#') ? t : '#' + t));
    const h = normHex(t);
    if (h) onChange(composeColor(h, alpha < 1 ? alpha : 1));
  };
  return (
    <div className="cpick">
      <div className="cpick-lab">{label}</div>
      <div className="cpick-grid">
        {PIXEL_PALETTE.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`csw${value === s.value ? ' on' : ''}${s.value === 'transparent' ? ' transp' : ''}`}
            style={s.value === 'transparent' ? undefined : { background: s.value }}
            title={s.name}
            onClick={() => onChange(s.value)}
          />
        ))}
      </div>
      <div className="cpick-hex">
        <label className="csw custom" title="Pick colour" style={{ background: hex }}>
          <input type="color" value={hex} onChange={(e) => onChange(composeColor(e.target.value, alpha))} />
        </label>
        <input
          className="hex-in"
          type="text"
          value={text}
          spellCheck={false}
          placeholder="#rrggbb"
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commitText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commitText((e.target as HTMLInputElement).value)}
        />
        <div className="alpha-wrap">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(alpha * 100)}
            onChange={(e) => onChange(composeColor(hex, +e.target.value / 100))}
            title="Transparency"
          />
          <span className="alpha-val">{Math.round(alpha * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

/** Colour pickers + size selector + a big preview for the PixelNum tab. */
function PixelNumPanel({
  current,
  fill,
  size,
  groupByName,
  fillPrevious,
  setCurrent,
  setFill,
  setSize,
  setGroupByName,
  setFillPrevious,
  count,
  titles,
}: {
  current: string;
  fill: string;
  size: number;
  groupByName: boolean;
  fillPrevious: boolean;
  setCurrent: (v: string) => void;
  setFill: (v: string) => void;
  setSize: (v: number) => void;
  setGroupByName: (v: boolean) => void;
  setFillPrevious: (v: boolean) => void;
  count: number;
  titles: string[];
}) {
  const groups = useMemo(
    () => (groupByName ? suggestGroups(titles) : null),
    [groupByName, titles],
  );
  const groupCount = groups ? (groups.length ? Math.max(...groups) + 1 : 0) : 0;
  // show at most the first 5 tracks, big, so the pattern is clearly readable
  const previews = useMemo(() => {
    const n = Math.min(count || 1, 5);
    return Array.from({ length: n }, (_, i) =>
      groups
        ? pixelNumColorsDataUrl(groupIconColors(i, groups, fill, fillPrevious), size)
        : pixelNumDataUrl(i, count || 1, current, fill, size, fillPrevious),
    );
  }, [count, current, fill, size, groups, fillPrevious]);
  return (
    <div className="pixelnum">
      <p className="hint">
        Each selected track gets a 16x16 pixel icon: its own number is lit in the <b>current</b>{' '}
        colour, the other selected tracks in the <b>fill</b> colour, the rest stay transparent.
        Paint each story with its own colour to tell them apart on the player.
      </p>
      <label className="pn-check">
        <input type="checkbox" checked={groupByName} onChange={(e) => setGroupByName(e.target.checked)} />
        Suggest colours by name{' '}
        {groupByName && count > 0 && <span className="pn-max">— {groupCount} group(s)</span>}
      </label>
      <label className="pn-check">
        <input type="checkbox" checked={fillPrevious} onChange={(e) => setFillPrevious(e.target.checked)} />
        Colour finished tracks too <span className="pn-max">(progress bar)</span>
      </label>
      <ColorPicker
        label={groupByName ? 'Current — (auto per group)' : 'Current — this track'}
        value={current}
        onChange={setCurrent}
      />
      <ColorPicker label="Fill — the other tracks" value={fill} onChange={setFill} />
      <div className="cpick-lab">Pixels per track</div>
      <div className="pn-sizes">
        {PIXELNUM_SIZES.map((s) => (
          <button
            key={s.side}
            type="button"
            className={`pn-size${size === s.side ? ' on' : ''}`}
            onClick={() => setSize(s.side)}
            title={`${s.side}×${s.side} block — up to ${s.max} tracks`}
          >
            {s.area}px <span className="pn-max">≤{s.max}</span>
          </button>
        ))}
      </div>
      <div className="cpick-lab">
        Preview {count > 0 ? `— first ${Math.min(count, 5)} of ${count}` : '— select tracks first'}
      </div>
      <div className="pn-preview big">
        {previews.map((u, i) => (
          <img key={i} src={u} alt={`#${i + 1}`} title={`#${i + 1}`} />
        ))}
      </div>
    </div>
  );
}

export function Drawer() {
  const mode = useStore((s) => s.drawer);
  const closeDrawer = useStore((s) => s.closeDrawer);
  if (!mode) return null;
  return (
    <>
      <div className="drawer-back" onClick={closeDrawer} />
      {mode === 'rename' ? (
        <RenameDrawer />
      ) : mode === 'audioedit' ? (
        <AudioEditDrawer />
      ) : (
        <IconDrawer />
      )}
    </>
  );
}

/** Trim a track's audio: decode → pick a [start, end] window → re-upload the cut.
 *  Zero-dependency (WebAudio decode + WAV encode); Yoto transcodes on upload. */
function AudioEditDrawer() {
  const uid = useStore((s) => s.audioEditUid);
  const card = useStore((s) => s.activeCard());
  const applyTrackAudio = useStore((s) => s.applyTrackAudio);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const showToast = useStore((s) => s.showToast);
  const track = card?.tracks.find((t) => t.uid === uid) ?? null;
  const streamable = track?.trackUrl && /^https?:\/\//.test(track.trackUrl) ? track.trackUrl : null;

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const previewRef = useRef<{ ctx: AudioContext; src: AudioBufferSourceNode; from: number; at: number } | null>(null);
  const rafRef = useRef(0);

  // decode the audio once when the drawer opens (peaks are computed per-view in
  // AeWave so zoom stays crisp)
  useEffect(() => {
    if (!streamable) {
      setErr('This track has no saved audio yet - publish it first, then edit.');
      return;
    }
    let cancelled = false;
    setErr(null);
    decodeTrackAudio(streamable)
      .then((buf) => {
        if (cancelled) return;
        setBuffer(buf);
        setEnd(buf.duration);
      })
      .catch((e) => !cancelled && setErr(`Couldn't load audio: ${(e as Error).message}`));
    return () => {
      cancelled = true;
    };
  }, [streamable]);

  function stopPreview() {
    cancelAnimationFrame(rafRef.current);
    const p = previewRef.current;
    if (p) {
      try {
        p.src.stop();
      } catch {
        /* already stopped */
      }
      void p.ctx.close();
      previewRef.current = null;
    }
    setPlaying(false);
  }
  useEffect(() => stopPreview, []);

  // seek: a plain click on the waveform moves the playhead (and stops playback)
  function seekTo(t: number) {
    stopPreview();
    setPlayhead(Math.max(0, Math.min(t, buffer?.duration ?? t)));
  }

  // play from the playhead (clamped into the selection) to the selection end
  function playSelection() {
    if (!buffer) return;
    stopPreview();
    const from = playhead >= start && playhead < end ? playhead : start;
    const ctx = new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0, from, Math.max(0.05, end - from));
    previewRef.current = { ctx, src, from, at: ctx.currentTime };
    setPlaying(true);
    const tick = () => {
      const p = previewRef.current;
      if (!p) return;
      const pos = p.from + (p.ctx.currentTime - p.at);
      if (pos >= end) {
        setPlayhead(end);
        stopPreview();
        return;
      }
      setPlayhead(pos);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  async function applyCut() {
    if (!buffer || !uid) return;
    if (end - start < 0.2) {
      showToast('Selection is too short');
      return;
    }
    stopPreview();
    try {
      setBusy('Cutting…');
      const file = cutToWavFile(buffer, start, end, track?.title ?? 'audio');
      setBusy('Uploading…');
      const res = await uploadAudioFile(file, setPct);
      applyTrackAudio(uid, { trackUrl: res.trackUrl, duration: res.duration, size: res.fileSize });
    } catch (e) {
      setBusy(null);
      showToast(`Cut failed: ${(e as Error).message}`);
    }
  }

  const dur = buffer?.duration ?? 0;
  const kept = Math.max(0, end - start);

  return (
    <div className="drawer audioedit">
      <div className="drawer-head">
        <h2 className="ellip">Trim audio — {track?.title ?? 'track'}</h2>
        <button className="x-btn" onClick={closeDrawer} aria-label="Close">✕</button>
      </div>
      <div className="drawer-body">
        {err ? (
          <div className="hint">{err}</div>
        ) : !buffer ? (
          <div className="hint">Loading audio…</div>
        ) : (
          <div className="ae">
            <AeWave
              buffer={buffer}
              dur={dur}
              start={start}
              end={end}
              playhead={playhead}
              setStart={setStart}
              setEnd={setEnd}
              onSeek={seekTo}
            />
            <div className="ae-times">
              <span>{fmtDur(Math.floor(start))}</span>
              <span className="ae-keep">keep {fmtDur(Math.round(kept))}</span>
              <span>{fmtDur(Math.ceil(end))}</span>
            </div>
            <p className="hint ae-help">
              Drag on the wave to set the cut · click to place the playhead · scroll to zoom ·
              double-click to reset zoom
            </p>
            <label className="ae-slider">
              <span>Start</span>
              <input
                type="range"
                min={0}
                max={dur}
                step={0.1}
                value={start}
                onChange={(e) => setStart(Math.min(+e.target.value, end - 0.2))}
              />
            </label>
            <label className="ae-slider">
              <span>End</span>
              <input
                type="range"
                min={0}
                max={dur}
                step={0.1}
                value={end}
                onChange={(e) => setEnd(Math.max(+e.target.value, start + 0.2))}
              />
            </label>
            <div className="ae-actions">
              <button className="btn" onClick={playing ? stopPreview : playSelection}>
                {playing ? '❚❚ Pause' : '▶ Play from playhead'}
              </button>
              <button className="btn ghost" onClick={() => seekTo(start)}>⏮ To start</button>
            </div>
            <p className="hint">
              Keeps only the selected window and re-uploads it. The original stays on Yoto until you
              publish. Encoded as WAV (no extra dependencies); Yoto converts it on upload.
            </p>
          </div>
        )}
      </div>
      <div className="drawer-foot">
        <button className="btn ghost" onClick={closeDrawer} disabled={!!busy}>Cancel</button>
        <button className="btn primary" onClick={applyCut} disabled={!buffer || !!busy}>
          {busy ? `${busy} ${busy === 'Uploading…' ? pct + '%' : ''}` : 'Apply cut'}
        </button>
      </div>
    </div>
  );
}

/**
 * Interactive trim waveform. Drag = set the [start, end] cut window; a plain
 * click = move the playhead; wheel = zoom (toward the cursor); double-click =
 * reset zoom. Peaks are recomputed for the visible window each render, so the
 * wave stays crisp at any zoom. Amplitude is normalised to a global max so bars
 * don't rescale while zooming.
 */
function AeWave({
  buffer,
  dur,
  start,
  end,
  playhead,
  setStart,
  setEnd,
  onSeek,
}: {
  buffer: AudioBuffer;
  dur: number;
  start: number;
  end: number;
  playhead: number;
  setStart: (v: number) => void;
  setEnd: (v: number) => void;
  onSeek: (t: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState({ s: 0, e: dur });
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => setView({ s: 0, e: dur }), [dur, buffer]);

  const raw = useMemo(() => buffer.getChannelData(0), [buffer]);
  const gMax = useMemo(() => {
    let m = 0;
    // sample sparsely for speed on long tracks; enough for a stable normaliser
    const step = Math.max(1, Math.floor(raw.length / 200000));
    for (let i = 0; i < raw.length; i += step) {
      const a = Math.abs(raw[i]);
      if (a > m) m = a;
    }
    return m || 1;
  }, [raw]);

  // draw
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const rate = buffer.sampleRate;
    const s0 = Math.max(0, Math.floor(view.s * rate));
    const e0 = Math.min(raw.length, Math.floor(view.e * rate));
    const span = Math.max(1, e0 - s0);
    const N = Math.max(60, Math.floor(w));
    const block = Math.max(1, Math.floor(span / N));
    const timeToX = (t: number) => ((t - view.s) / (view.e - view.s)) * w;
    const selL = timeToX(start);
    const selR = timeToX(end);
    for (let i = 0; i < N; i++) {
      let sum = 0;
      const st = s0 + i * block;
      for (let j = 0; j < block; j += Math.max(1, (block / 32) | 0)) sum += Math.abs(raw[st + j] || 0);
      const cnt = Math.max(1, Math.ceil(block / Math.max(1, (block / 32) | 0)));
      const v = sum / cnt / gMax;
      const x = (i / N) * w;
      const bh = Math.max(2, v * (h - 6));
      ctx.fillStyle = x >= selL && x <= selR ? '#ee5a1c' : '#c9cbcf';
      ctx.fillRect(x, (h - bh) / 2, Math.max(1, w / N - 0.5), bh);
    }
    // selection edge markers
    ctx.fillStyle = '#d94e14';
    for (const x of [selL, selR]) if (x >= 0 && x <= w) ctx.fillRect(x - 1, 0, 2, h);
    // playhead
    const px = timeToX(playhead);
    if (px >= 0 && px <= w) {
      ctx.fillStyle = '#111';
      ctx.fillRect(px - 0.5, 0, 1.5, h);
    }
  }, [raw, gMax, buffer, view, start, end, playhead]);

  // wheel zoom (native, non-passive so we can preventDefault)
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = cv.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const v = viewRef.current;
      const span = v.e - v.s;
      const cur = v.s + (x / rect.width) * span;
      const factor = ev.deltaY < 0 ? 0.8 : 1.25;
      const newSpan = Math.min(dur, Math.max(0.3, span * factor));
      let ns = cur - (x / rect.width) * newSpan;
      ns = Math.max(0, Math.min(ns, dur - newSpan));
      setView({ s: ns, e: ns + newSpan });
    };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  }, [dur]);

  function timeAt(clientX: number): number {
    const rect = ref.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const v = viewRef.current;
    return v.s + (x / rect.width) * (v.e - v.s);
  }

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return; // ignore right/middle
    e.preventDefault();
    const anchor = timeAt(e.clientX);
    let moved = false;
    const threshold = (viewRef.current.e - viewRef.current.s) * 0.01;
    const onMove = (ev: MouseEvent) => {
      const cur = timeAt(ev.clientX);
      if (Math.abs(cur - anchor) > threshold) moved = true;
      if (moved) {
        setStart(Math.min(anchor, cur));
        setEnd(Math.max(anchor, cur));
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) onSeek(anchor); // plain click → move playhead
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <canvas
      className="ae-wave"
      ref={ref}
      onMouseDown={onMouseDown}
      onDoubleClick={() => setView({ s: 0, e: dur })}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

function useSelectedTracks(): Track[] {
  const card = useStore((s) => s.activeCard());
  const selected = useStore((s) => s.selected);
  return useMemo(
    () => (card ? card.tracks.filter((t) => selected.has(t.uid)) : []),
    [card, selected],
  );
}

function RenameDrawer() {
  const tracks = useSelectedTracks();
  const applyRename = useStore((s) => s.applyRename);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const showToast = useStore((s) => s.showToast);

  const [tab, setTab] = useState<'number' | 'regex'>('number');
  const [pattern, setPattern] = useState('{n}. {title}');
  const [start, setStart] = useState(1);
  const [step, setStep] = useState(1);
  const [pad, setPad] = useState(2);
  const [find, setFind] = useState('Kapitel (\\d+): (.*)');
  const [repl, setRepl] = useState('Ch. $1 — $2');

  const results = useMemo<RenameResult[]>(() => {
    if (tab === 'number') {
      let n = start;
      return tracks.map((t) => {
        const num = String(n).padStart(pad, '0');
        n += step;
        return { uid: t.uid, next: pattern.replace(/{n}/g, num).replace(/{title}/g, t.title), err: null };
      });
    }
    let re: RegExp | null = null;
    let err: string | null = null;
    try {
      re = new RegExp(find, 'g');
    } catch (e) {
      err = (e as Error).message;
    }
    return tracks.map((t) => ({
      uid: t.uid,
      next: err || !re ? t.title : t.title.replace(re, repl),
      err,
    }));
  }, [tab, pattern, start, step, pad, find, repl, tracks]);

  const hasErr = results.some((r) => r.err);

  return (
    <div className="drawer">
      <div className="drawer-head">
        <h2>Rename {tracks.length} track(s)</h2>
        <button className="x-btn" onClick={closeDrawer} aria-label="Close">✕</button>
      </div>
      <div className="drawer-body">
        <div className="tabset">
          <button className={tab === 'number' ? 'on' : ''} onClick={() => setTab('number')}>
            Auto-number
          </button>
          <button className={tab === 'regex' ? 'on' : ''} onClick={() => setTab('regex')}>
            Regex replace
          </button>
        </div>

        {tab === 'number' ? (
          <>
            <div className="field">
              <label>Pattern</label>
              <input type="text" value={pattern} onChange={(e) => setPattern(e.target.value)} />
              <div className="hint">
                <span className="mono">{'{n}'}</span> = number, <span className="mono">{'{title}'}</span> = current title.
                Also sets the app number badge (overlayLabel).
              </div>
            </div>
            <div className="field">
              <div className="row">
                <div>
                  <label>Start at</label>
                  <input type="number" value={start} onChange={(e) => setStart(+e.target.value)} />
                </div>
                <div>
                  <label>Step</label>
                  <input type="number" value={step} onChange={(e) => setStep(+e.target.value)} />
                </div>
                <div>
                  <label>Pad width</label>
                  <input type="number" value={pad} onChange={(e) => setPad(+e.target.value)} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label>Find (regex)</label>
              <input type="text" value={find} onChange={(e) => setFind(e.target.value)} />
            </div>
            <div className="field">
              <label>Replace</label>
              <input type="text" value={repl} onChange={(e) => setRepl(e.target.value)} />
              <div className="hint">
                JS regex. Use <span className="mono">$1 $2</span> for capture groups. Global, case-sensitive.
              </div>
            </div>
          </>
        )}

        <div className="field">
          <label>Preview</label>
          <div className="preview">
            {results.slice(0, 30).map((r) => {
              const orig = tracks.find((t) => t.uid === r.uid)!;
              return (
                <div className="pv-row" key={r.uid}>
                  <span className="old">{orig.title}</span>
                  <span className="arw">→</span>
                  <span className={`new${r.err ? ' err' : ''}`}>{r.err ? '⚠ ' + r.err : r.next}</span>
                </div>
              );
            })}
            {results.length > 30 && (
              <div className="pv-row">
                <span className="hint">+{results.length - 30} more…</span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="drawer-foot">
        <button className="btn ghost" onClick={closeDrawer}>Cancel</button>
        <button
          className="btn primary"
          onClick={() => (hasErr ? showToast('Fix the regex first') : applyRename(results))}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function IconDrawer() {
  const targetUid = useStore((s) => s.iconTargetUid);
  const selected = useStore((s) => s.selected);
  const selCount = selected.size;
  const card = useStore((s) => s.activeCard());
  const applyIcon = useStore((s) => s.applyIcon);
  const applyNumberIcons = useStore((s) => s.applyNumberIcons);
  const applyPixelNum = useStore((s) => s.applyPixelNum);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const showToast = useStore((s) => s.showToast);

  const targetTitle = targetUid ? card?.tracks.find((t) => t.uid === targetUid)?.title : null;
  const heading = targetUid
    ? `Set icon — ${targetTitle ?? '1 track'}`
    : `Set icon on ${selCount} track(s)`;

  const [tab, setTab] = useState<IconTab>('public');
  const [pnCurrent, setPnCurrent] = useState(PIXELNUM_DEFAULT_CURRENT);
  const [pnFill, setPnFill] = useState(PIXELNUM_DEFAULT_FILL);
  const [pnSize, setPnSize] = useState(PIXELNUM_DEFAULT_SIZE);
  const [pnGroup, setPnGroup] = useState(false);
  const [pnFillPrev, setPnFillPrev] = useState(false);
  const pnCount = targetUid ? 1 : selCount;
  const pnTitles = useMemo(
    () =>
      targetUid
        ? (card?.tracks.filter((t) => t.uid === targetUid).map((t) => t.title) ?? [])
        : (card?.tracks.filter((t) => selected.has(t.uid)).map((t) => t.title) ?? []),
    [targetUid, card, selected],
  );
  const [icons, setIcons] = useState<YotoIcon[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<IconSort>('default');
  const [pick, setPick] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ ic: YotoIcon; x: number; y: number } | null>(null);
  const [cuData, setCuData] = useState<string | null>(null); // custom-upload render
  const [delSel, setDelSel] = useState<Set<string>>(new Set()); // My Icons marked for delete
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (tab === 'pixelnum') return; // no library fetch for the generator tab
    let cancelled = false;
    setLoading(true);
    setDelSel(new Set());
    const load = tab === 'public' ? fetchPublicIcons : fetchMyIcons;
    load().then((res) => {
      if (cancelled) return;
      if (res) {
        setIcons(res);
        setLive(true);
      } else {
        setLive(false);
        setIcons(tab === 'public' ? mockIcons() : []);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  function toggleDel(mediaId: string) {
    setDelSel((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
  }

  function confirmDelete() {
    const ids = [...delSel];
    hideMyIcons(ids); // persistent per-browser hide (Yoto has no delete route)
    setIcons((prev) => prev.filter((x) => !delSel.has(x.mediaId)));
    setDelSel(new Set());
    setConfirmDel(false);
    showToast(`Deleted ${ids.length} icon${ids.length === 1 ? '' : 's'}`);
  }

  // close the right-click menu on any outside interaction
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [ctx]);

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    const list = icons.filter(
      (ic) => !s || ic.title.toLowerCase().includes(s) || ic.tags.some((t) => t.toLowerCase().includes(s)),
    );
    if (sort === 'az') return [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'za') return [...list].sort((a, b) => b.title.localeCompare(a.title));
    return list;
  }, [icons, q, sort]);

  // right-click delete: mark just this icon and open the confirm dialog (no alert)
  function onDelete(ic: YotoIcon) {
    setCtx(null);
    setDelSel(new Set([ic.mediaId]));
    setConfirmDel(true);
  }

  return (
    <div className="drawer gallery">
      <div className="drawer-head">
        <h2 className="ellip">{heading}</h2>
        <button className="x-btn" onClick={closeDrawer} aria-label="Close">✕</button>
      </div>
      <div className="drawer-body">
        {/* sticky controls: stay visible while the grid scrolls */}
        <div className="gallery-head">
          <div className="tabset">
            <button className={tab === 'public' ? 'on' : ''} onClick={() => setTab('public')}>
              Yoto Lib
            </button>
            <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
              My Icons
            </button>
            {/* looks like a tab but doesn't switch the grid - it fires the action */}
            <button
              className="numtab"
              onClick={() => void applyNumberIcons()}
              title="Number the selected tracks 1..N (real 1-30 icons, generated 31-100), each selection starting fresh at 1"
            >
              1,2,3..
            </button>
            <button className={tab === 'pixelnum' ? 'on' : ''} onClick={() => setTab('pixelnum')}>
              PixNum
            </button>
            <button className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>
              Upload
            </button>
          </div>
          {tab !== 'pixelnum' && tab !== 'upload' && (
            <div className="gallery-tools">
              <input
                className="gh-search"
                type="text"
                placeholder="Search icons…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQ('')}
              />
              <select
                className="gh-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as IconSort)}
                title="Sort icons"
              >
                <option value="default">Sort: default</option>
                <option value="az">Title A–Z</option>
                <option value="za">Title Z–A</option>
              </select>
              {tab === 'mine' && live && (
                <button
                  className="btn ghost danger sm gh-del"
                  disabled={delSel.size === 0}
                  onClick={() => setConfirmDel(true)}
                  title="Delete the checked icons"
                >
                  🗑 Delete{delSel.size > 0 ? ` (${delSel.size})` : ''}
                </button>
              )}
            </div>
          )}
          {!live && tab !== 'pixelnum' && (
            <div className="hint">
              ⚠ Placeholder icons. Connect your Yoto account to load the real{' '}
              {tab === 'public' ? 'icon library' : 'uploaded icons'}.
            </div>
          )}
        </div>

        {tab === 'upload' ? (
          <CustomIconPanel onChange={setCuData} />
        ) : tab === 'pixelnum' ? (
          <PixelNumPanel
            current={pnCurrent}
            fill={pnFill}
            size={pnSize}
            groupByName={pnGroup}
            fillPrevious={pnFillPrev}
            setCurrent={setPnCurrent}
            setFill={setPnFill}
            setSize={setPnSize}
            setGroupByName={setPnGroup}
            setFillPrevious={setPnFillPrev}
            count={pnCount}
            titles={pnTitles}
          />
        ) : loading ? (
          <div className="hint">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="hint">
            {tab === 'mine' && !live ? 'Your uploaded icons appear here once connected.' : 'No icons match.'}
          </div>
        ) : (
          <div className="iconpick">
            {tab === 'public' && (
              <button
                className={`ip default${pick === DEFAULT_TRACK_ICON ? ' on' : ''}`}
                title="Default Yoto icon (reset)"
                onClick={() => setPick(DEFAULT_TRACK_ICON)}
                onDoubleClick={() => applyIcon(DEFAULT_TRACK_ICON)}
              >
                <img src={DEFAULT_TRACK_ICON} alt="default" />
              </button>
            )}
            {filtered.map((ic) => {
              const canDelete = tab === 'mine' && live;
              const btn = (
                <button
                  key={ic.mediaId}
                  className={`ip${pick === ic.url ? ' on' : ''}${delSel.has(ic.mediaId) ? ' delsel' : ''}`}
                  title={`${ic.title || '(untitled)'}\nid: ${ic.mediaId}${canDelete ? '\nright-click or tick to delete' : ''}`}
                  onClick={() => setPick(ic.url)}
                  onDoubleClick={() => applyIcon(ic.url)}
                  onContextMenu={(e) => {
                    if (canDelete) {
                      e.preventDefault();
                      // the drawer is transform-centered, which makes position:fixed
                      // resolve against the drawer, not the viewport. Store coords
                      // relative to the drawer and position the menu absolutely.
                      const box = (e.currentTarget.closest('.drawer') as HTMLElement)?.getBoundingClientRect();
                      setCtx({ ic, x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) });
                    }
                  }}
                >
                  <img src={ic.url} alt={ic.title} />
                </button>
              );
              if (!canDelete) return btn;
              return (
                <div className="ip-wrap" key={ic.mediaId}>
                  {btn}
                  <input
                    className="ip-check"
                    type="checkbox"
                    checked={delSel.has(ic.mediaId)}
                    onChange={() => toggleDel(ic.mediaId)}
                    title="Select to delete"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="drawer-foot">
        <button className="btn ghost" onClick={closeDrawer}>Cancel</button>
        {tab === 'pixelnum' ? (
          <button
            className="btn primary"
            onClick={() =>
              applyPixelNum(pnCurrent, pnFill, pnSize, { groupByName: pnGroup, fillPrevious: pnFillPrev })
            }
          >
            Apply PixelNum
          </button>
        ) : tab === 'upload' ? (
          <button
            className="btn primary"
            onClick={() => (cuData ? applyIcon(cuData) : showToast('Choose an image first'))}
          >
            Use as icon
          </button>
        ) : (
          <button className="btn primary" onClick={() => (pick ? applyIcon(pick) : showToast('Pick an icon'))}>
            Apply
          </button>
        )}
      </div>

      {ctx && (
        <div className="ctxmenu" style={{ top: ctx.y, left: ctx.x }} onClick={(e) => e.stopPropagation()}>
          <button className="ctx-item danger" onClick={() => onDelete(ctx.ic)}>
            🗑 Delete icon
          </button>
        </div>
      )}

      {confirmDel && (
        <div className="modal-back" onClick={() => setConfirmDel(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete {delSel.size} icon{delSel.size === 1 ? '' : 's'}?</h3>
            <p>
              Removed from your icon library here. Yoto's API has no delete route, so the upload
              itself stays in your Yoto account.
            </p>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setConfirmDel(false)}>Cancel</button>
              <button className="btn danger-solid" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
