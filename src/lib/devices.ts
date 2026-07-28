// Yoto player devices (the physical boxes). Read-only listing for the output
// picker; actual casting needs the MQTT device-control channel (separate work).
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
}

/**
 * GET /device-v2/{id}/config → { device: { online, deviceType, status: {…} } }.
 * The status object carries battery/power/card/volume/wifi. Returns null on any
 * failure (offline boxes still return their last snapshot, so this usually works
 * even when online is false).
 */
export async function fetchDeviceStatus(deviceId: string): Promise<DeviceStatus | null> {
  try {
    const r = await fetch(`/api/yoto/device-v2/${encodeURIComponent(deviceId)}/config`, {
      credentials: 'same-origin',
    });
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
    const r = await fetch('/api/yoto/device-v2/devices/mine', { credentials: 'same-origin' });
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
