import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { fetchDeviceStatuses, type DeviceStatus } from '../lib/devices';
import {
  boxPlayPause,
  boxRefresh,
  boxSetVolume,
  boxSkip,
  boxSleepTimer,
  boxStartCard,
  boxStop,
  canSkip,
  getBox,
  livePosition,
  volumePct,
} from '../lib/box';
import { fmtDur } from '../lib/format';
import { useBox } from './useBox';

/** Compact "battery bar" glyph, filled to the charge level. */
function Battery({ level, charging, stale }: { level: number; charging: boolean; stale?: boolean }) {
  const w = Math.max(1, Math.round((level / 100) * 16));
  const low = level <= 15 && !charging;
  return (
    <span
      className={`dev-bat${low ? ' low' : ''}${stale ? ' stale' : ''}`}
      title={`${level}%${charging ? ' · charging' : ''}${stale ? ' (last reported to Yoto, not live)' : ''}`}
    >
      <span className="dev-batbox">
        <span className="dev-batfill" style={{ width: `${w}px` }} />
      </span>
      {charging ? '⚡' : ''}
      {level}%
    </span>
  );
}

/** "3 min ago" style relative time from an ISO timestamp. */
function ago(iso: string | null): string {
  if (!iso) return 'unknown';
  const t = new Date(iso).getTime();
  if (!t) return 'unknown';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function powerLabel(d: DeviceStatus): string {
  if (d.charging) return 'Charging';
  if (d.onExternalPower) return 'On dock / USB';
  return 'On battery';
}

const SLEEP_OPTIONS = [
  { label: 'Sleep timer: off', seconds: 0 },
  { label: '15 min', seconds: 15 * 60 },
  { label: '30 min', seconds: 30 * 60 },
  { label: '45 min', seconds: 45 * 60 },
  { label: '60 min', seconds: 60 * 60 },
];

/** Where the box got what it is playing from. */
const SOURCE_LABEL: Record<string, string> = {
  card: 'from a card',
  remote: 'from the Yoto app',
  MQTT: 'started from here',
};

/**
 * Now playing + transport for one box, over MQTT. Play/pause reflects what the
 * box reports, so it stays right when someone presses the buttons on the box
 * itself. There is no next/previous command in the API - only starting a card
 * at a chapter - so the transport is deliberately play/pause and stop.
 */
function NowPlaying({
  deviceId,
  deviceName,
  onOpened,
}: {
  deviceId: string;
  deviceName: string;
  onOpened: () => void;
}) {
  const live = useBox(deviceId);
  const cards = useStore((s) => s.cards);
  const showToast = useStore((s) => s.showToast);
  const openCard = useStore((s) => s.openCard);
  const setSelectedUids = useStore((s) => s.setSelectedUids);
  const setOutputBox = useStore((s) => s.setOutputBox);
  const playTrack = useStore((s) => s.playTrack);
  const [, tick] = useState(0);

  const { now } = live;
  const playing = now.playbackStatus === 'playing';

  // the box reports position on change, so re-render once a second to advance it
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [playing]);

  // ask for a fresh picture whenever this panel opens
  useEffect(() => boxRefresh(deviceId), [deviceId]);

  if (live.conn !== 'live') {
    return (
      <div className="box-now">
        <div className="bn-state">
          {live.conn === 'connecting' && 'Connecting to the player…'}
          {live.conn === 'idle' && 'Not connected'}
          {live.conn === 'error' && (live.error ?? 'Player unavailable')}
        </div>
      </div>
    );
  }

  const pos = livePosition(live);
  const len = now.trackLength;
  const pct = pos != null && len ? Math.min(100, (pos / len) * 100) : 0;
  const vol = volumePct(live);
  /** the card sitting on the box: events drop it briefly during a restart, and
   *  it also survives a stop, so the status snapshot backs it up */
  const loadedCard = now.cardId ?? live.status?.activeCard ?? null;
  const onBox = loadedCard ? cards.find((c) => c.id === loadedCard) : undefined;
  const cardTitle = onBox?.title ?? null;
  // the card's real chapter keys, when this card is loaded in the app; skipping
  // falls back to sequential keys for cards we don't hold (shop cards)
  const chapterKeys = onBox?.tracks.length ? onBox.tracks.map((t) => t.key) : undefined;
  const busy =
    playing || now.playbackStatus === 'paused' || now.playbackStatus === 'loading';
  const idle = !busy && !loadedCard;
  const sub = [cardTitle ?? (loadedCard ? `Card ${loadedCard}` : null), now.chapterTitle]
    .filter((x) => x && x !== now.trackTitle)
    .join(' · ');

  const guard = (ok: boolean) => {
    if (!ok) showToast('The player did not accept that just now');
  };

  /**
   * Follow what the box is playing: open that playlist in the pane, put the
   * cursor on the track the box is on, and hand the bottom bar over to the box
   * so its position keeps running there.
   */
  function follow() {
    if (!loadedCard) return;
    setOutputBox({ deviceId, name: deviceName });
    const card = cards.find((c) => c.id === loadedCard);
    if (card) {
      openCard(card.id);
      const t = now.chapterKey ? card.tracks.find((x) => x.key === now.chapterKey) : undefined;
      setSelectedUids(t ? [t.uid] : []);
      if (t) playTrack(t.uid);
    } else {
      // a shop card or someone else's: nothing to open, but the bar still follows
      showToast('That card is not in your editable library');
    }
    onOpened();
  }

  // pause/resume while something is loaded, otherwise restart the card on the box
  function onPlay() {
    const st = getBox(deviceId);
    if (st.now.playbackStatus === 'playing' || st.now.playbackStatus === 'paused') {
      guard(boxPlayPause(deviceId));
      return;
    }
    if (loadedCard) guard(boxStartCard(deviceId, loadedCard));
    else showToast('Nothing on the player - start a playlist from the player bar');
  }

  return (
    <div className="box-now">
      <div
        className={`bn-track${idle ? '' : ' link'}`}
        title={idle ? undefined : 'Open this playlist and follow the player at the bottom'}
        onClick={idle ? undefined : follow}
      >
        {idle ? 'Nothing playing' : now.trackTitle ?? cardTitle ?? 'Playing…'}
      </div>
      <div className={`bn-sub${idle ? '' : ' link'}`} onClick={idle ? undefined : follow}>
        {sub || (now.source ? SOURCE_LABEL[now.source] ?? now.source : ' ')}
      </div>
      <div className="bn-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="bn-time">
        <span>{pos != null ? fmtDur(Math.floor(pos)) : '–:––'}</span>
        <span>{len ? fmtDur(Math.floor(len)) : '–:––'}</span>
      </div>
      {live.rejected && <div className="bn-reject">Player refused the {live.rejected} command</div>}
      <div className="bn-transport">
        <button
          className="bn-btn"
          disabled={!canSkip(live, -1, chapterKeys)}
          title="Previous song on the player"
          onClick={() => guard(boxSkip(deviceId, -1, chapterKeys))}
        >
          ⏮
        </button>
        <button
          className="bn-btn play"
          disabled={!loadedCard}
          title={playing ? 'Pause on the player' : 'Play on the player'}
          onClick={onPlay}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          className="bn-btn"
          disabled={!canSkip(live, 1, chapterKeys)}
          title="Next song on the player"
          onClick={() => guard(boxSkip(deviceId, 1, chapterKeys))}
        >
          ⏭
        </button>
        <button
          className="bn-btn"
          disabled={idle}
          title="Stop on the player"
          onClick={() => guard(boxStop(deviceId))}
        >
          ■
        </button>
      </div>
      <div className="bn-volrow">
        <span className="bn-vol" title="Player volume">🔊</span>
        <input
          className="bn-volrange"
          type="range"
          min={0}
          max={100}
          step={5}
          value={vol ?? 0}
          title={vol != null ? `Player volume ${vol}%` : 'Player volume'}
          onChange={(e) => guard(boxSetVolume(deviceId, +e.target.value))}
        />
        <span className="bn-volpct">{vol != null ? `${vol}%` : '–'}</span>
      </div>
      <select
        className="bn-sleep"
        value={now.sleepTimerActive ? 'on' : '0'}
        title="Stop the player automatically after…"
        onChange={(e) => {
          const seconds = Number(e.target.value);
          if (isFinite(seconds)) guard(boxSleepTimer(deviceId, seconds));
        }}
      >
        {now.sleepTimerActive && (
          <option value="on">
            Sleep in {now.sleepTimerSeconds ? Math.ceil(now.sleepTimerSeconds / 60) : '?'} min
          </option>
        )}
        {SLEEP_OPTIONS.map((o) => (
          <option key={o.seconds} value={o.seconds}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** One box: the topbar pill, plus the status + control popover it opens. */
function DeviceRow({ d, open, onToggle }: { d: DeviceStatus; open: boolean; onToggle: () => void }) {
  const live = useBox(d.deviceId);
  const cards = useStore((s) => s.cards);

  // The box's own MQTT report always wins. REST /device-v2/{id}/config returns
  // Yoto's last stored snapshot, which can be hours stale - it once showed 87%
  // on a box that was actually at 17% - so it is only a placeholder until the
  // live report lands, and it is labelled as such.
  const liveStatus = live.status;
  const battery = liveStatus?.batteryLevel ?? d.batteryLevel;
  const charging = liveStatus?.charging ?? d.charging;
  const batteryStale = !liveStatus && d.batteryLevel != null;
  const playing = live.now.playbackStatus === 'playing';
  const activeCardId = live.status?.activeCard ?? live.now.cardId ?? d.activeCard;
  const cardTitle = (id: string | null) =>
    id ? cards.find((c) => c.id === id)?.title ?? `Card ${id}` : null;
  const nowLabel = playing ? live.now.trackTitle ?? cardTitle(activeCardId) : null;

  return (
    <div className="dev-one">
      <button
        className="dev-pill"
        title={`${d.name} - ${d.online ? 'online' : 'offline'}${nowLabel ? ` · playing ${nowLabel}` : ''}`}
        onClick={onToggle}
      >
        <span className={`dev-dot${d.online ? ' on' : ''}`} />
        <span className="dev-name">{d.name}</span>
        {nowLabel && <span className="dev-playing">▶ {nowLabel}</span>}
        {battery != null && <Battery level={battery} charging={charging} stale={batteryStale} />}
      </button>
      {open && (
        <div className="dev-pop" onMouseDown={(e) => e.stopPropagation()}>
          <div className="dev-pop-head">
            {d.name}
            <span className="dev-type">{d.deviceType}</span>
          </div>
          <NowPlaying deviceId={d.deviceId} deviceName={d.name} onOpened={onToggle} />
          <dl className="dev-rows">
            <dt>Status</dt>
            <dd className={d.online ? 'ok' : 'muted'}>{d.online ? 'Online' : 'Offline'}</dd>
            <dt>Power</dt>
            <dd>{powerLabel(d)}</dd>
            {battery != null && (
              <>
                <dt>Battery</dt>
                <dd title={batteryStale ? 'Yoto’s last stored reading - the live value follows' : undefined}>
                  {battery}%{charging ? ' · charging' : ''}
                  {batteryStale && <span className="dev-stale"> last reported</span>}
                </dd>
              </>
            )}
            <dt>Card</dt>
            <dd>{activeCardId ? cardTitle(activeCardId) : d.cardInserted ? 'Inserted' : 'None'}</dd>
            {live.conn !== 'live' && d.volume != null && (
              <>
                <dt>Volume</dt>
                <dd>{d.volume}%</dd>
              </>
            )}
            {d.ssid && (
              <>
                <dt>Wi-Fi</dt>
                <dd>
                  {d.ssid}
                  {d.wifiStrength != null ? ` · ${d.wifiStrength} dBm` : ''}
                </dd>
              </>
            )}
            {live.status?.downloading && (
              <>
                <dt>Sync</dt>
                <dd>Downloading…</dd>
              </>
            )}
            <dt>Last seen</dt>
            <dd className="muted">{live.conn === 'live' ? 'live' : ago(d.updatedAt)}</dd>
          </dl>
        </div>
      )}
    </div>
  );
}

/** The user's Yoto box(es) in the topbar: power, battery, what's playing, and
 *  transport controls. Status comes from the REST snapshot, everything live
 *  (now-playing, volume, commands) rides the MQTT player channel. */
export function DeviceWidget() {
  const authed = useStore((s) => s.authed);
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [open, setOpen] = useState<string | null>(null); // deviceId of the open popover
  const wrapRef = useRef<HTMLDivElement>(null);

  // poll every 30s while signed in
  useEffect(() => {
    if (!authed) {
      setDevices([]);
      return;
    }
    let live = true;
    const load = () => fetchDeviceStatuses().then((d) => live && setDevices(d));
    load();
    const id = window.setInterval(load, 30_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [authed]);

  // close the popover on any outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (devices.length === 0) return null;

  return (
    <div className="dev-widget" ref={wrapRef}>
      {devices.map((d) => (
        <DeviceRow
          key={d.deviceId}
          d={d}
          open={open === d.deviceId}
          onToggle={() => setOpen((o) => (o === d.deviceId ? null : d.deviceId))}
        />
      ))}
    </div>
  );
}
