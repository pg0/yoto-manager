import { useEffect, useRef, useState } from 'react';
import { useStore } from './store';
import { TopBar } from './components/TopBar';
import { CardRail } from './components/CardRail';
import { Toolbar } from './components/Toolbar';
import { TrackTable } from './components/TrackTable';
import { CapacityMeter } from './components/CapacityMeter';
import { Drawer } from './components/Drawer';
import { Player } from './components/Player';

/** Full-screen confetti + "Yay!" dialog shown after a big update. Self-contained
 *  canvas confetti (no external lib); auto-dismisses after 2s. */
const CEL_AUTOCLOSE_KEY = 'yoto-manager:celebrate-autoclose';

function Celebration() {
  const on = useStore((s) => s.celebrate);
  const dismiss = useStore((s) => s.dismissCelebrate);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [autoClose, setAutoClose] = useState(() => localStorage.getItem(CEL_AUTOCLOSE_KEY) === '1');

  // remember the choice; when on, auto-dismiss after 3s if the box is ticked
  useEffect(() => {
    localStorage.setItem(CEL_AUTOCLOSE_KEY, autoClose ? '1' : '0');
  }, [autoClose]);
  useEffect(() => {
    if (!on || !autoClose) return;
    const id = window.setTimeout(dismiss, 3000);
    return () => window.clearTimeout(id);
  }, [on, autoClose, dismiss]);

  useEffect(() => {
    if (!on) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = (canvas.width = window.innerWidth);
    const H = (canvas.height = window.innerHeight);
    const colors = ['#ff5a52', '#ff8a3d', '#ffd43b', '#94d82d', '#2ad4a5', '#3db9ff', '#6d8bff', '#b18cf5', '#ff8ed6'];
    // burst from the centre-top, fall with gravity + spin
    const pieces = Array.from({ length: 160 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 240,
      y: H * 0.3 + (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 11,
      vy: Math.random() * -9 - 3,
      size: 5 + Math.random() * 7,
      color: colors[(Math.random() * colors.length) | 0],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
    }));
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      for (const p of pieces) {
        p.vy += 0.32; // gravity
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - t / 2000);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }
      if (t < 2000) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, dismiss]);

  if (!on) return null;
  return (
    <div className="celebrate-back" onClick={dismiss}>
      <canvas ref={canvasRef} className="confetti" />
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        <div className="cel-big">🥳 Yay! you did it.</div>
        <div className="cel-small">
          If you <span className="cel-love">love</span> using it, consider supporting.
        </div>
        <button className="btn primary cel-ok" onClick={dismiss} autoFocus>
          OK
        </button>
        <label className="cel-auto">
          <input type="checkbox" checked={autoClose} onChange={(e) => setAutoClose(e.target.checked)} />
          Auto close (3s)
        </label>
      </div>
    </div>
  );
}

function LoopIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

function ShuffleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 3 21 3 21 8" />
      <path d="M4 20 21 3" />
      <polyline points="21 16 21 21 16 21" />
      <path d="M15 15l6 6M4 4l5 5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7m4 4v6m4-6v6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PaneHead() {
  const card = useStore((s) => s.activeCard());
  const undoLen = useStore((s) => s.undoStack.length);
  const publishing = useStore((s) => s.publishing);
  const publish = useStore((s) => s.publish);
  const undo = useStore((s) => s.undo);
  const discardDraft = useStore((s) => s.discardDraft);
  const setCover = useStore((s) => s.setCover);
  const setSetting = useStore((s) => s.setSetting);
  const setCardTitle = useStore((s) => s.setCardTitle);
  const setCardDescription = useStore((s) => s.setCardDescription);
  const deleteCard = useStore((s) => s.deleteCard);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // inline title / description editing (double-click to enter)
  const [editing, setEditing] = useState<null | 'title' | 'desc'>(null);
  const [draft, setDraft] = useState('');
  const cardId = card?.id;
  useEffect(() => setEditing(null), [cardId]); // leave edit mode when switching cards

  if (!card) return null;

  function beginTitle() {
    setDraft(card!.title);
    setEditing('title');
  }
  function beginDesc() {
    setDraft(card!.description ?? '');
    setEditing('desc');
  }
  function commit() {
    if (editing === 'title') setCardTitle(draft);
    else if (editing === 'desc') setCardDescription(draft.trim());
    setEditing(null);
  }

  function onCoverFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCover(reader.result as string);
    reader.readAsDataURL(f);
    e.target.value = '';
  }

  async function doDelete() {
    setDeleting(true);
    const ok = await deleteCard(card!.id);
    setDeleting(false);
    if (ok) setConfirmDel(false);
  }

  return (
    <>
    <div className="pane-head">
      <button className="pane-cover" onClick={() => fileRef.current?.click()} title="Change cover image">
        <img src={card.cover} alt="cover" />
        <span className="cover-edit">Edit</span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onCoverFile} />
      <div className="pane-title">
        {editing === 'title' ? (
          <input
            className="title-edit"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') setEditing(null);
            }}
          />
        ) : (
          <h1 onDoubleClick={beginTitle} title="Double-click to rename">
            {card.title}
          </h1>
        )}
        <div className="pane-sub">
          <span className="slug">{card.slug}</span>
          {card.dirty && <span className="dirtytag">● unpublished</span>}
        </div>
        {editing === 'desc' ? (
          <textarea
            className="desc-edit"
            autoFocus
            rows={2}
            placeholder="Card description…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') setEditing(null);
            }}
          />
        ) : (
          <div
            className={`pane-desc${card.description ? '' : ' empty'}`}
            onDoubleClick={beginDesc}
            title="Double-click to edit description"
          >
            {card.description || 'Add a description…'}
          </div>
        )}
      </div>
      <div className="spacer" />
      {/* two groups so a narrow screen can break between them instead of
          orphaning single buttons at the end of the checkbox row */}
      <div className="ph-opts">
        <label className="opt" title="Show the track-number badge on the Yoto player screen (overlayLabel)">
          <input
            type="checkbox"
            checked={card.settings.showTrackNumbers}
            onChange={(e) => setSetting('showTrackNumbers', e.target.checked)}
          />
          Show numbers
        </label>
        <button
          className={`opt-btn${card.settings.loop ? ' on' : ''}`}
          aria-pressed={card.settings.loop}
          title="Repeat the card from the first track when the last one ends"
          aria-label="Loop the playlist"
          onClick={() => setSetting('loop', !card.settings.loop)}
        >
          <LoopIcon />
        </button>
        <button
          className={`opt-btn${card.settings.shuffle ? ' on' : ''}`}
          aria-pressed={card.settings.shuffle}
          title="Play the tracks in a random order on the Yoto player (the Yoto app ignores this)"
          aria-label="Shuffle the playlist"
          onClick={() => setSetting('shuffle', !card.settings.shuffle)}
        >
          <ShuffleIcon />
        </button>
      </div>
      <span className="opt-sep" />
      <div className="ph-actions">
        <button
          className="x-btn danger"
          onClick={() => setConfirmDel(true)}
          title="Delete this playlist"
          aria-label="Delete this playlist"
        >
          <TrashIcon />
        </button>
        <button
          className="btn ghost"
          disabled={!card.dirty}
          onClick={discardDraft}
          title="Reload from Yoto, discard local draft"
        >
          Discard draft
        </button>
        <button className="btn" disabled={undoLen === 0} onClick={undo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button className="btn primary" disabled={!card.dirty || publishing} onClick={() => void publish()}>
          {publishing ? 'Updating…' : 'Update playlist'}
        </button>
      </div>
    </div>
    {confirmDel && (
      <div className="modal-back" onClick={() => !deleting && setConfirmDel(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Delete playlist?</h3>
          <p>
            <b>{card.title}</b> will be permanently deleted from your Yoto account. This can’t be
            undone.
          </p>
          <div className="modal-foot">
            <button className="btn ghost" disabled={deleting} onClick={() => setConfirmDel(false)}>
              Cancel
            </button>
            <button className="btn danger-solid" disabled={deleting} onClick={() => void doDelete()}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

export default function App() {
  const move = useStore((s) => s.move);
  const undo = useStore((s) => s.undo);
  const closeDrawer = useStore((s) => s.closeDrawer);
  const toast = useStore((s) => s.toast);
  const init = useStore((s) => s.init);
  const railOpen = useStore((s) => s.railOpen);
  const setRailOpen = useStore((s) => s.setRailOpen);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        move('up');
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        move('down');
      } else if (e.key === 'Escape') {
        closeDrawer();
        useStore.getState().setRailOpen(false);
      } else if (e.code === 'Space') {
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
        e.preventDefault();
        const st = useStore.getState();
        const card = st.activeCard();
        const streamable = (t: { trackUrl?: string }) => !!t.trackUrl && /^https?:\/\//.test(t.trackUrl);
        // a checked song that isn't the one already playing wins: play it
        const selStreamable = card?.tracks.find((t) => st.selected.has(t.uid) && streamable(t));
        if (selStreamable && selStreamable.uid !== st.playingUid) {
          st.playTrack(selStreamable.uid);
          return;
        }
        // otherwise just toggle the open player
        if (st.playingUid) {
          st.requestToggle();
          return;
        }
        // nothing playing and nothing playable selected: hint if a dud is checked
        if (card?.tracks.some((t) => st.selected.has(t.uid))) {
          st.showToast('That track has no playable audio yet (publish first)');
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, undo, closeDrawer]);

  return (
    <>
      <div className="shell">
        <div className="app">
          <TopBar />
          <CardRail />
          {/* mobile only: tapping beside the rail drawer closes it */}
          {railOpen && <div className="rail-back" onClick={() => setRailOpen(false)} />}
          <main className="main">
            <PaneHead />
            <Toolbar />
            <TrackTable />
            <CapacityMeter />
          </main>
        </div>
        <Player />
      </div>
      <Drawer />
      <Celebration />
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
