import { useCallback, useSyncExternalStore } from 'react';
import { getBox, subscribeBox, type BoxLive } from '../lib/box';

/** Live MQTT state for one Yoto box. The subscription is reference-counted, so
 *  several components can watch the same box over one connection. */
export function useBox(deviceId: string): BoxLive {
  return useSyncExternalStore(
    useCallback((cb: () => void) => subscribeBox(deviceId, cb), [deviceId]),
    useCallback(() => getBox(deviceId), [deviceId]),
  );
}
