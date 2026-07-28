import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { fetchDeviceStatuses, type DeviceStatus } from '../lib/devices';

/** Compact "battery bar" glyph, filled to the charge level. */
function Battery({ level, charging }: { level: number; charging: boolean }) {
  const w = Math.max(1, Math.round((level / 100) * 16));
  const low = level <= 15 && !charging;
  return (
    <span className={`dev-bat${low ? ' low' : ''}`} title={`${level}%${charging ? ' · charging' : ''}`}>
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

/** Read-only status for the user's Yoto box(es): power, battery, online, which
 *  card is loaded, volume, Wi-Fi. Only /config is readable - live playback and
 *  remote control need the MQTT channel (separate work), so this never sends. */
export function DeviceWidget() {
  const authed = useStore((s) => s.authed);
  const cards = useStore((s) => s.cards);
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

  const cardTitle = (id: string | null) =>
    id ? cards.find((c) => c.id === id)?.title ?? `Card ${id}` : null;

  return (
    <div className="dev-widget" ref={wrapRef}>
      {devices.map((d) => (
        <div className="dev-one" key={d.deviceId}>
          <button
            className="dev-pill"
            title={`${d.name} - ${d.online ? 'online' : 'offline'}`}
            onClick={() => setOpen((o) => (o === d.deviceId ? null : d.deviceId))}
          >
            <span className={`dev-dot${d.online ? ' on' : ''}`} />
            <span className="dev-name">{d.name}</span>
            {d.batteryLevel != null && <Battery level={d.batteryLevel} charging={d.charging} />}
          </button>
          {open === d.deviceId && (
            <div className="dev-pop" onMouseDown={(e) => e.stopPropagation()}>
              <div className="dev-pop-head">
                {d.name}
                <span className="dev-type">{d.deviceType}</span>
              </div>
              <dl className="dev-rows">
                <dt>Status</dt>
                <dd className={d.online ? 'ok' : 'muted'}>{d.online ? 'Online' : 'Offline'}</dd>
                <dt>Power</dt>
                <dd>{powerLabel(d)}</dd>
                {d.batteryLevel != null && (
                  <>
                    <dt>Battery</dt>
                    <dd>
                      {d.batteryLevel}%{d.charging ? ' · charging' : ''}
                    </dd>
                  </>
                )}
                <dt>Card</dt>
                <dd>{d.cardInserted ? cardTitle(d.activeCard) ?? 'Inserted' : 'None'}</dd>
                {d.volume != null && (
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
                <dt>Last seen</dt>
                <dd className="muted">{ago(d.updatedAt)}</dd>
              </dl>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
