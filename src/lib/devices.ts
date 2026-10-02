// Yoto player devices (the physical boxes). Read-only listing for the output
// picker; actual casting needs the MQTT device-control channel (separate work).
import { yotoFetch } from './auth';

export interface YotoDevice {
  deviceId: string;
  name: string;
  online: boolean;
}

type RawDevice = {
  deviceId?: string;
  id?: string;
  name?: string;
  deviceFamily?: string;
  online?: boolean;
  isOnline?: boolean;
};

/** A read-only status snapshot for one box, from GET /device-v2/{id}/config.
 *  Only /config is readable; /status and /command are scope-gated (403). */
export interface DeviceStatus {
  deviceId: string;
  name: string;
  deviceType: string;
  online: boolean;
  batteryLevel: number | null; // 0-100
  charging: boolean;
  onExternalPower: boolean; // powerSrc != 0 → plugged / dock
  cardInserted: boolean;
  activeCard: string | null; // card id (resolve to a title in the UI)
  volume: number | null; // 0-100
  wifiStrength: number | null; // dBm (negative)
  ssid: string | null;
  playingStatus: number | null; // raw enum; not mapped to text (unverified)
  updatedAt: string | null; // ISO, last time the box reported
  /** Green Button playlists (4th gen players); null = box has no Green Button */
  shortcuts: Shortcuts | null;
}

/** One Green Button entry. MYO cards are `track-play` with card/chapter/track. */
export interface ShortcutItem {
  cmd: string;
  params: { card: string; chapter?: string; track?: string; [k: string]: unknown };
}
export type ShortcutMode = 'day' | 'night';
export type Shortcuts = Record<ShortcutMode, ShortcutItem[]>;
/** Yoto's per-mode cap on Green Button entries. */
export const SHORTCUTS_MAX = 20;

/**
 * GET /device-v2/{id}/config → { device: { online, deviceType, status: {…} } }.
 * The status object carries battery/power/card/volume/wifi. Returns null on any
 * failure (offline boxes still return their last snapshot, so this usually works
 * even when online is false).
 */
export async function fetchDeviceStatus(deviceId: string): Promise<DeviceStatus | null> {
  try {
    const r = await yotoFetch(`device-v2/${encodeURIComponent(deviceId)}/config`);
    if (!r.ok) return null;
    const j = (await r.json()) as { device?: Record<string, unknown> };
    const d = j.device;
    if (!d) return null;
    const s = (d.status ?? {}) as Record<string, unknown>;
    const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
    const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
    return {
      deviceId: (d.deviceId as string) ?? deviceId,
      name: (d.name as string) ?? 'Yoto Player',
      deviceType: (d.deviceType as string) ?? '',
      online: !!d.online,
      batteryLevel: num(s.batteryLevel),
      charging: !!s.charging && s.charging !== 0,
      onExternalPower: typeof s.powerSrc === 'number' ? s.powerSrc !== 0 : false,
      cardInserted: s.cardInserted === 1 || s.cardInserted === true,
      activeCard: str(s.activeCard),
      volume: num(s.volume),
      wifiStrength: num(s.wifiStrength),
      ssid: str(s.ssid),
      playingStatus: num(s.playingStatus),
      updatedAt: str(s.updatedAt),
      shortcuts: parseShortcuts(d.shortcuts),
    };
  } catch {
    return null;
  }
}

/** List the boxes, then fetch each one's status snapshot. */
export async function fetchDeviceStatuses(): Promise<DeviceStatus[]> {
  const devices = await fetchDevices();
  const statuses = await Promise.all(devices.map((d) => fetchDeviceStatus(d.deviceId)));
  return statuses.filter((s): s is DeviceStatus => s !== null);
}

/**
 * GET /device-v2/devices/mine - the user's Yoto players. Needs a device scope
 * (family:devices:view); returns [] if the token lacks it or none are linked.
 */
export async function fetchDevices(): Promise<YotoDevice[]> {
  try {
    const r = await yotoFetch('device-v2/devices/mine');
    if (!r.ok) return [];
    const j = (await r.json()) as { devices?: RawDevice[] } | RawDevice[];
    const arr: RawDevice[] = Array.isArray(j) ? j : j.devices ?? [];
    return arr
      .map((d) => ({
        deviceId: d.deviceId ?? d.id ?? '',
        name: d.name ?? d.deviceId ?? 'Yoto Player',
        online: !!(d.online ?? d.isOnline),
      }))
      .filter((d) => d.deviceId);
  } catch {
    return [];
  }
}

function parseShortcuts(raw: unknown): Shortcuts | null {
  const modes = (raw as { modes?: Record<string, { content?: unknown }> } | undefined)?.modes;
  if (!modes) return null;
  const list = (m?: { content?: unknown }) =>
    Array.isArray(m?.content) ? (m.content as ShortcutItem[]).filter((x) => x?.params?.card) : [];
  return { day: list(modes.day), night: list(modes.night) };
}

/** PUT /device-v2/{id}/shortcuts - replaces both Green Button playlists.
 *  Needs the family:devices:manage scope; a 403 means the login predates it. */
export async function saveShortcuts(deviceId: string, sc: Shortcuts): Promise<void> {
  const r = await yotoFetch(`device-v2/${encodeURIComponent(deviceId)}/shortcuts`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      shortcuts: { modes: { day: { content: sc.day }, night: { content: sc.night } } },
    }),
  });
  if (r.status === 403) throw new Error('missing permission - sign out and sign in again');
  if (!r.ok) throw new Error(`Yoto answered ${r.status}`);
}
