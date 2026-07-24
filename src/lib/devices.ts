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
