import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { DEFAULT_TRACK_ICON, fetchMyIcons, fetchPublicIcons, mockIcons, type YotoIcon } from '../lib/icons';
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
type IconTab = 'public' | 'mine' | 'pixelnum';

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
      {mode === 'rename' ? <RenameDrawer /> : <IconDrawer />}
    </>
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
        <button className="btn ghost" onClick={closeDrawer}>✕</button>
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

  useEffect(() => {
    if (tab === 'pixelnum') return; // no library fetch for the generator tab
    let cancelled = false;
    setLoading(true);
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

  function onDelete(ic: YotoIcon) {
    setCtx(null);
    // Yoto's public API exposes no delete-icon route (verified). Remove it from
    // this session's view so the gallery declutters, and be honest that Yoto
    // still keeps the upload server-side.
    if (!confirm(`Hide "${ic.title || ic.mediaId}" from this list?\n\nNote: Yoto's API has no delete-icon endpoint, so it stays in your Yoto account.`))
      return;
    setIcons((prev) => prev.filter((x) => x.mediaId !== ic.mediaId));
    showToast('Hidden from view (Yoto keeps the upload)');
  }

  return (
    <div className="drawer gallery">
      <div className="drawer-head">
        <h2 className="ellip">{heading}</h2>
        <button className="btn ghost" onClick={closeDrawer}>✕</button>
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
          </div>
          {tab !== 'pixelnum' && (
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
            </div>
          )}
          {!live && tab !== 'pixelnum' && (
            <div className="hint">
              ⚠ Placeholder icons. Connect your Yoto account to load the real{' '}
              {tab === 'public' ? 'icon library' : 'uploaded icons'}.
            </div>
          )}
        </div>

        {tab === 'pixelnum' ? (
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
            {filtered.map((ic) => (
              <button
                key={ic.mediaId}
                className={`ip${pick === ic.url ? ' on' : ''}`}
                title={`${ic.title || '(untitled)'}\nid: ${ic.mediaId}${tab === 'mine' && live ? '\nright-click to delete' : ''}`}
                onClick={() => setPick(ic.url)}
                onDoubleClick={() => applyIcon(ic.url)}
                onContextMenu={(e) => {
                  if (tab === 'mine' && live) {
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
            ))}
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
    </div>
  );
}
