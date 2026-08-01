import { useEffect, useState } from 'react';
import { fetchDevices, type YotoDevice } from '../lib/devices';

/** The device list is identical for every consumer and changes only when boxes
 *  are added to the account, so it is fetched once per session and shared. */
let cache: YotoDevice[] | null = null;
let inflight: Promise<YotoDevice[]> | null = null;
const listeners = new Set<(d: YotoDevice[]) => void>();

function load(): Promise<YotoDevice[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= fetchDevices().then((d) => {
    cache = d;
    inflight = null;
    listeners.forEach((fn) => fn(d));
    return d;
  });
  return inflight;
}

export function useDevices(): YotoDevice[] {
  const [devices, setDevices] = useState<YotoDevice[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setDevices);
    void load().then(setDevices);
    return () => {
      listeners.delete(setDevices);
    };
  }, []);
  return devices;
}
