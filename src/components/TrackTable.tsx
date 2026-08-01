import { useEffect, useRef, useState } from 'react';
import { useStore, visibleTracks } from '../store';
import { fmtDur, fmtSize } from '../lib/format';
import { DEFAULT_TRACK_ICON } from '../lib/icons';
import type { SortKey, TrackEnd } from '../types';

const END_OPTS: { val: TrackEnd; label: string; glyph: string }[] = [
  { val: 'continue', label: 'Continue to next track', glyph: '→' },
  { val: 'repeat', label: 'Repeat track', glyph: '⟳' },
  { val: 'pause', label: 'Pause, wait for button press', glyph: '⏸' },
];
const endOpt = (v?: TrackEnd) => END_OPTS.find((o) => o.val === (v ?? 'continue'))!;

function SortHead({ label, k, className }: { label: string; k: SortKey; className: string }) {
  const sortKey = useStore((s) => s.sortKey);
  const sortDir = useStore((s) => s.sortDir);
  const sortBy = useStore((s) => s.sortBy);
  const arrow = sortKey === k ? (sortDir === 1 ? '▲' : '▼') : '';
  return (
    <th className={`${className} sortable`} onClick={() => sortBy(k)}>
      {label} <span className="arrow">{arrow}</span>
    </th>
  );
}

export function TrackTable() {
  const rows = useStore(visibleTracks);
  const selected = useStore((s) => s.selected);
  const toggleSel = useStore((s) => s.toggleSel);
  const selectAll = useStore((s) => s.selectAll);
  const clearSel = useStore((s) => s.clearSel);
  const renameOne = useStore((s) => s.renameOne);
  const reorder = useStore((s) => s.reorder);
  const openIconPicker = useStore((s) => s.openIconPicker);
  const openAudioEditor = useStore((s) => s.openAudioEditor);
  const setTrackEnd = useStore((s) => s.setTrackEnd);
  const setSelectedUids = useStore((s) => s.setSelectedUids);
  const playTrack = useStore((s) => s.playTrack);
  const playingUid = useStore((s) => s.playingUid);
  const outputBox = useStore((s) => s.outputBox);
  const uploadFiles = useStore((s) => s.uploadFiles);
  const uploads = useStore((s) => s.uploads);
  const activeCard = useStore((s) => s.activeCard());

  const [fileOver, setFileOver] = useState(false);

  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types?.includes('Files');
  function onWrapDragOver(e: React.DragEvent) {
    if (!hasFiles(e)) return; // internal row-reorder drag, not an OS file drop
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setFileOver(true);
  }
  function onWrapDrop(e: React.DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setFileOver(false);
    const files = [...e.dataTransfer.files].filter(
      (f) => f.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|flac|aac|opus|aiff?)$/i.test(f.name),
    );
    if (files.length) void uploadFiles(files);
    else if (e.dataTransfer.files.length) useStore.getState().showToast('Only audio files can be uploaded');
  }

  const [editUid, setEditUid] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragUids, setDragUids] = useState<string[] | null>(null);
  const [dropTarget, setDropTarget] = useState<{ uid: string; after: boolean } | null>(null);
  const [menu, setMenu] = useState<{ uid: string; x: number; y: number } | null>(null);

  // --- marquee (rubber-band) selection over blank space ---
  const wrapRef = useRef<HTMLDivElement>(null);
  const marqueeRef = useRef(false); // true = a marquee gesture owns this drag (blocks native row DnD)
  const movedRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const baseSelRef = useRef<Set<string>>(new Set());
  const suppressClickRef = useRef(false);
  const [marquee, setMarquee] = useState<{ l: number; t: number; w: number; h: number } | null>(null);

  function onWrapMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, button, a, .t-edit')) return; // interactive control
    const row = el.closest('tbody tr');
    const onRow = !!row;
    // Only an already-SELECTED row keeps its native reorder drag; a drag anywhere
    // else - blank space OR an unselected row - owns the gesture as a marquee. That
    // way rubber-band select always works and an unselected title can't be dragged.
    if (row && row.classList.contains('sel')) return;
    marqueeRef.current = true;
    movedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    baseSelRef.current = e.ctrlKey || e.metaKey ? new Set(selected) : new Set();

    const onMove = (ev: MouseEvent) => {
      const s = startRef.current;
      if (!s) return;
      const dx = ev.clientX - s.x;
      const dy = ev.clientY - s.y;
      if (!movedRef.current && Math.hypot(dx, dy) < 4) return;
      movedRef.current = true;
      ev.preventDefault();
      const l = Math.min(s.x, ev.clientX);
      const t = Math.min(s.y, ev.clientY);
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      setMarquee({ l, t, w, h });
      const box = { left: l, top: t, right: l + w, bottom: t + h };
      const uids = new Set(baseSelRef.current);
      wrapRef.current?.querySelectorAll<HTMLElement>('tbody tr').forEach((tr) => {
        const r = tr.getBoundingClientRect();
        const hit =
          r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right;
        const uid = tr.dataset.uid;
        if (hit && uid) uids.add(uid);
      });
      setSelectedUids([...uids]);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (movedRef.current) {
        // a real marquee happened - swallow the click that follows so the row
        // handler doesn't overwrite the marquee result
        suppressClickRef.current = true;
        setTimeout(() => (suppressClickRef.current = false), 0);
      } else if (!onRow) {
        // a plain click on blank space (not a row) clears the selection; a click
        // on a row is left to the row's own toggle handler
        clearSel();
      }
      marqueeRef.current = false;
      startRef.current = null;
      setMarquee(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Ctrl/Cmd+A selects every (visible) track in the playlist, unless the user is
  // typing in a field - then let the browser select the field's text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.closest('input, textarea, [contenteditable="true"], .t-edit');
      // Escape clears the track selection (but not while typing / a drawer is open)
      if (e.key === 'Escape' && !typing && !useStore.getState().drawer) {
        clearSel();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'a') return;
      if (typing) return;
      e.preventDefault();
      selectAll(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectAll, clearSel]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    // close on scroll of the table body
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  function openMenu(e: React.MouseEvent, uid: string) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // anchor the menu's top-right corner under the kebab button
    setMenu({ uid, x: r.right, y: r.bottom + 4 });
  }

  function onDragStart(e: React.DragEvent, uid: string) {
    // a marquee gesture owns this drag - suppress the native reorder drag
    if (marqueeRef.current) {
      e.preventDefault();
      return;
    }
    // dragging a row that's part of a multi-selection moves the whole selection
    const uids =
      selected.has(uid) && selected.size > 1 && activeCard
        ? activeCard.tracks.filter((t) => selected.has(t.uid)).map((t) => t.uid)
        : [uid];
    setDragUids(uids);
    e.dataTransfer.effectAllowed = 'move';
    // Always supply a compact drag image. Without one, a single-row drag makes
    // the browser fall back to ghosting the ENTIRE table.
    const title = activeCard?.tracks.find((t) => t.uid === uid)?.title ?? '';
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent =
      uids.length > 1 ? `↕ ${uids.length} tracks` : `↕ ${title || '1 track'}`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 12, 12);
    setTimeout(() => ghost.remove(), 0);
  }
  function onRowDragOver(e: React.DragEvent, uid: string) {
    if (!dragUids) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    setDropTarget({ uid, after });
  }
  function onDrop() {
    if (dragUids && dropTarget && !dragUids.includes(dropTarget.uid)) {
      reorder(dragUids, dropTarget.uid, dropTarget.after);
    }
    setDragUids(null);
    setDropTarget(null);
  }

  function startEdit(uid: string, title: string) {
    setEditUid(uid);
    setDraft(title);
  }
  function commitEdit() {
    if (editUid) renameOne(editUid, draft.trim());
    setEditUid(null);
  }

  // header checkbox reflects the VISIBLE rows (respects an active filter)
  const selVisible = rows.reduce((n, r) => (selected.has(r.t.uid) ? n + 1 : n), 0);
  const allOn = rows.length > 0 && selVisible === rows.length;
  const someOn = selVisible > 0 && selVisible < rows.length;

  return (
    <div
      className={`table-wrap${marquee ? ' marqueeing' : ''}${fileOver ? ' fileover' : ''}`}
      ref={wrapRef}
      onMouseDown={onWrapMouseDown}
      onDragOver={onWrapDragOver}
      onDrop={onWrapDrop}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setFileOver(false);
      }}
    >
      <table>
        <thead>
          <tr>
            <th className="c-check">
              <input
                type="checkbox"
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = someOn;
                }}
                onChange={(e) => selectAll(e.target.checked)}
              />
            </th>
            <SortHead label="#" k="index" className="c-num" />
            <th className="c-play" title="Play preview" />
            <th className="c-icon">Icon</th>
            <SortHead label="Title" k="title" className="c-title" />
            <th className="c-end" title="When the track finishes" />
            <SortHead label="Duration" k="duration" className="c-dur" />
            <SortHead label="Size" k="size" className="c-size" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, visIdx) => {
            const t = r.t;
            const sel = selected.has(t.uid);
            const dragging = dragUids?.includes(t.uid);
            const dropCls =
              dropTarget?.uid === t.uid ? (dropTarget.after ? ' drop-after' : ' drop-before') : '';
            return (
              <tr
                key={t.uid}
                data-uid={t.uid}
                className={`${sel ? 'sel' : ''}${dragging ? ' dragging' : ''}${dropCls}`}
                // only checked tracks can be dragged to reorder - prevents
                // accidental drag-moves when nothing is selected
                draggable={editUid !== t.uid && sel}
                onDragStart={(e) => onDragStart(e, t.uid)}
                onDragOver={(e) => onRowDragOver(e, t.uid)}
                onDrop={onDrop}
                onDragEnd={() => {
                  setDragUids(null);
                  setDropTarget(null);
                }}
                onClick={(e) => {
                  if (suppressClickRef.current) return; // click that trails a marquee
                  if ((e.target as HTMLElement).tagName !== 'INPUT') {
                    toggleSel(t.uid, visIdx, e.shiftKey, !e.ctrlKey && !e.metaKey);
                  }
                }}
              >
                <td className="c-check">
                  <input
                    type="checkbox"
                    checked={sel}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSel(t.uid, visIdx, (e as React.MouseEvent).shiftKey, false);
                    }}
                    onChange={() => {}}
                  />
                </td>
                <td className="c-num">
                  <span className="t-num">{r.index + 1}</span>
                </td>
                <td className="c-play">
                  {/* a box plays from Yoto's own copy, so a track with no local
                      stream URL is still playable when a box is the output */}
                  {(outputBox || (t.trackUrl && /^https?:\/\//.test(t.trackUrl))) && (
                    <button
                      className={`t-play${playingUid === t.uid ? ' on' : ''}`}
                      title={playingUid === t.uid ? 'Playing' : outputBox ? `Play on ${outputBox.name}` : 'Play preview'}
                      draggable={false}
                      onClick={(e) => {
                        e.stopPropagation();
                        playTrack(playingUid === t.uid ? null : t.uid);
                      }}
                    >
                      {playingUid === t.uid ? '❚❚' : '▶'}
                    </button>
                  )}
                </td>
                <td className="c-icon">
                  <button
                    className="t-icon-btn"
                    title="Choose icon"
                    draggable={false}
                    onClick={(e) => {
                      e.stopPropagation();
                      openIconPicker(t.uid);
                    }}
                  >
                    <img
                      className={`t-icon${t.icon ? '' : ' is-default'}`}
                      src={t.icon ?? DEFAULT_TRACK_ICON}
                      alt=""
                    />
                  </button>
                </td>
                <td
                  className="c-title"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startEdit(t.uid, t.title);
                  }}
                  title="Double-click to rename"
                >
                  {editUid === t.uid ? (
                    <input
                      className="t-edit"
                      autoFocus
                      value={draft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit();
                        else if (e.key === 'Escape') setEditUid(null);
                      }}
                    />
                  ) : (
                    <span className="t-title">{t.title}</span>
                  )}
                </td>
                <td className="c-end">
                  <button
                    className={`end-btn${(t.onEnd ?? 'continue') !== 'continue' ? ' set' : ''}`}
                    title={`When finished: ${endOpt(t.onEnd).label}`}
                    aria-label={`When finished: ${endOpt(t.onEnd).label}`}
                    draggable={false}
                    onClick={(e) => openMenu(e, t.uid)}
                  >
                    {endOpt(t.onEnd).glyph}
                  </button>
                </td>
                <td className="c-dur">
                  <span className="t-dur">{fmtDur(t.duration)}</span>
                </td>
                <td className="c-size">
                  <span className="t-size">{fmtSize(t.size)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {menu && (() => {
        const t = activeCard?.tracks.find((x) => x.uid === menu.uid);
        if (!t) return null;
        const cur = t.onEnd ?? 'continue';
        const act = (fn: () => void) => (e: React.MouseEvent) => {
          e.stopPropagation();
          fn();
          setMenu(null);
        };
        // flip the menu upward when it's opened near the bottom of the viewport,
        // otherwise the (now taller) menu is clipped below the fold
        const flipUp = menu.y > window.innerHeight - 280;
        return (
          <div
            className="rowmenu"
            style={{
              top: menu.y,
              left: menu.x,
              transform: `translateX(-100%)${flipUp ? ' translateY(-100%)' : ''}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rm-cap">Audio</div>
            <button className="rm-item" onClick={act(() => openAudioEditor(menu.uid))}>
              <span className="rm-lead">
                <span className="rm-og">✂</span>
                Edit / cut audio…
              </span>
            </button>
            <div className="rm-sep" />
            <div className="rm-cap">When the track finishes</div>
            {END_OPTS.map((o) => (
              <button
                key={o.val}
                className={`rm-item${cur === o.val ? ' on' : ''}`}
                onClick={act(() => setTrackEnd(menu.uid, o.val))}
              >
                <span className="rm-lead">
                  <span className="rm-og">{o.glyph}</span>
                  {o.label}
                </span>
                <span className="rm-g">{cur === o.val ? '✓' : ''}</span>
              </button>
            ))}
          </div>
        );
      })()}

      {marquee && (
        <div
          className="marquee-box"
          style={{ left: marquee.l, top: marquee.t, width: marquee.w, height: marquee.h }}
        />
      )}

      {fileOver && (
        <div className="dropzone">
          <div className="dz-inner">⬇ Drop audio files to upload to this card</div>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="uploads">
          {uploads.map((u) => (
            <div key={u.id} className={`up-row up-${u.status}`}>
              <span className="up-name" title={u.name}>{u.name}</span>
              <span className="up-status">
                {u.status === 'uploading' && `Uploading ${u.pct}%`}
                {u.status === 'processing' && `Transcoding ${u.pct}%`}
                {u.status === 'done' && '✓ Added'}
                {u.status === 'error' && '⚠ Failed'}
              </span>
              <div className="up-bar"><div className="up-fill" style={{ width: `${u.pct}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
