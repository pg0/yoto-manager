import { useStore } from '../store';
import type { Card } from '../types';

const APP_VERSION = '0.2.0';

export function CardRail() {
  const cards = useStore((s) => s.cards);
  const activeId = useStore((s) => s.activeId);
  const cardFilter = useStore((s) => s.cardFilter);
  const setCardFilter = useStore((s) => s.setCardFilter);
  const openCard = useStore((s) => s.openCard);
  const newCard = useStore((s) => s.newCard);
  const loading = useStore((s) => s.loading);
  const authed = useStore((s) => s.authed);
  const myUserId = useStore((s) => s.myUserId);
  const displayName = useStore((s) => s.displayName);
  const railOpen = useStore((s) => s.railOpen);
  const setRailOpen = useStore((s) => s.setRailOpen);

  /** On mobile the rail is an overlay, so picking a card has to close it. */
  function pickCard(id: string) {
    openCard(id);
    setRailOpen(false);
  }

  const q = cardFilter.toLowerCase();
  const list = cards.filter((c) => c.title.toLowerCase().includes(q));

  // group by owner; a header only shows when the library actually spans >1 owner
  // (shared / family cards). Own cards render flat, exactly as before.
  const owners: string[] = [];
  for (const c of list) {
    const o = c.owner ?? '(me)';
    if (!owners.includes(o)) owners.push(o);
  }
  const grouped = owners.length > 1;
  const ownerLabel = (o: string) =>
    o === myUserId || o === '(me)' ? displayName || 'My cards' : `Family · ${o.slice(-4)}`;

  function renderCard(c: Card) {
    const secs = c.loaded ? c.tracks.reduce((a, t) => a + t.duration, 0) : c.durationSec ?? 0;
    const min = Math.round(secs / 60);
    const count = c.loaded ? c.tracks.length : c.trackCount;
    const sub = count !== undefined ? `${count} tracks · ${min} min` : `${min} min`;
    return (
      <div
        key={c.id}
        className={`card-item${c.id === activeId ? ' active' : ''}${c.dirty ? ' dirty' : ''}`}
        onClick={() => pickCard(c.id)}
      >
        {c.cover ? (
          <img className="card-cover" src={c.cover} alt="" />
        ) : (
          <span className="card-cover placeholder" />
        )}
        <div style={{ minWidth: 0 }}>
          <div className="ci-title">{c.title}</div>
          <div className="ci-sub">{sub}</div>
        </div>
        <span className="ci-badge">{c.dirty ? '●' : count ?? '›'}</span>
      </div>
    );
  }

  return (
    <aside className={`rail${railOpen ? ' open' : ''}`}>
      <div className="rail-head">
        <span>My cards</span>
        <div className="rh-right">
          <span className="count">{cards.length}</span>
          {authed && (
            <button
              className="rh-new"
              onClick={() => {
                newCard();
                setRailOpen(false);
              }}
              title="New playlist"
            >
              + New
            </button>
          )}
        </div>
      </div>
      <div className="rail-search">
        <input
          placeholder="Filter cards..."
          value={cardFilter}
          onChange={(e) => setCardFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setCardFilter('')}
        />
        {cardFilter && (
          <button className="clear-x" title="Clear filter" aria-label="Clear filter" onClick={() => setCardFilter('')}>
            ×
          </button>
        )}
      </div>
      <div className="cards">
        {loading && cards.length === 0 ? (
          <div className="rail-empty">Loading your cards…</div>
        ) : list.length === 0 ? (
          <div className="rail-empty">{cardFilter ? 'No cards match.' : 'No cards yet.'}</div>
        ) : grouped ? (
          owners.map((o) => (
            <div key={o} className="card-group">
              <div className="cg-head">{ownerLabel(o)}</div>
              {list.filter((c) => (c.owner ?? '(me)') === o).map(renderCard)}
            </div>
          ))
        ) : (
          list.map(renderCard)
        )}
        <div className="rail-foot">
          <div>by Patrick Gawron</div>
          <div>
            <a href="https://github.com/pg0/yoto-manager" target="_blank" rel="noopener noreferrer">
              github.com/pg0/yoto-manager
            </a>
          </div>
          <div className="rf-sub">Version {APP_VERSION}</div>
        </div>
      </div>
    </aside>
  );
}
