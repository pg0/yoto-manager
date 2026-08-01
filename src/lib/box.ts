// Live "what is the Yoto box doing right now" channel, plus remote control.
//
// Yoto exposes the physical players over AWS IoT MQTT (documented at
// yoto.dev/players-mqtt). One connection per box: it pushes `data/events`
// (now-playing, volume, sleep timer) and `data/status` (battery, card, disk),
// and accepts `command/…` publishes for play/pause/stop, volume, sleep timer
// and starting a card.
//
// Two things the wire format forces on this module:
//  - events arrive as PARTIAL objects (only the fields that changed), so state
//    is merged, never replaced;
//  - the JWT is the MQTT password, so every (re)connect pulls a fresh token and
//    an expired session shows up as a dropped connection, not a 401.
//
// Connections are reference-counted per device: the first subscriber opens the
// socket, the last one closes it.

import { API_BASE, getAccessToken } from './auth';
import { MqttClient } from './mqtt';

const MQTT_URL = 'wss://aqrphjqbp3u2z-ats.iot.eu-west-2.amazonaws.com/mqtt';
const AUTHORIZER = 'PublicJWTAuthorizer';
/** Yoto drops idle connections at ~5 min; the ping and the nudge stay inside. */
const KEEPALIVE_S = 300;
const NUDGE_MS = 4 * 60_000 + 55_000;
const RETRY_MS = [3_000, 6_000, 12_000, 24_000, 30_000];
/** The player's hardware volume ladder; events report a step on this scale. */
const VOLUME_STEPS = 16;
/** Settling time between stopping and restarting the same card (see boxStartCard). */
const RESTART_GAP_MS = 1_800;

/** Dev builds trace the whole MQTT conversation; production stays silent. */
const trace: (dir: '→' | '←', topic: string, body?: unknown) => void = import.meta.env.DEV
  ? (dir, topic, body) => console.log(`[box] ${dir} ${topic}`, body ?? '')
  : () => {};

export type PlaybackStatus = 'playing' | 'paused' | 'stopped' | 'loading';

/** What the box is playing. Every field can be unknown until it reports one. */
export interface NowPlaying {
  /** null when the box is idle (the wire says the string 'none') */
  cardId: string | null;
  chapterTitle: string | null;
  chapterKey: string | null;
  trackTitle: string | null;
  trackKey: string | null;
  /** seconds into the track as of `positionAt` - interpolate while playing */
  position: number | null;
  /** epoch ms of the last position report */
  positionAt: number;
  trackLength: number | null;
  playbackStatus: PlaybackStatus | null;
  /** 'card' (a physical card), 'remote' (the Yoto app) or 'MQTT' (this app) */
  source: string | null;
  streaming: boolean;
  repeatAll: boolean;
  /** hardware step on a 0-16 ladder - NOT a percentage */
  volume: number | null;
  /** the highest step this box is allowed to reach, also on the 0-16 ladder */
  volumeMax: number | null;
  sleepTimerActive: boolean;
  sleepTimerSeconds: number | null;
}

/** The subset of `data/status` this app shows. */
export interface BoxStatus {
  batteryLevel: number | null;
  charging: boolean;
  activeCard: string | null;
  /** 0 = none, 1 = physical card, 2 = started remotely */
  cardInserted: number | null;
  /** user volume as a percentage (0-100) - the scale `setVolume` takes */
  userVolume: number | null;
  freeDisk: number | null;
  fwVersion: string | null;
  /** the box is pulling content down right now */
  downloading: boolean;
}

export type BoxConn = 'idle' | 'connecting' | 'live' | 'error';

export interface BoxLive {
  conn: BoxConn;
  /** human-readable, only set when conn === 'error' */
  error: string | null;
  now: NowPlaying;
  status: BoxStatus | null;
  /** the last command the box rejected, e.g. 'card' - cleared on the next
   *  accepted command, so a silent no-op always has a visible reason */
  rejected: string | null;
}

const IDLE_NOW: NowPlaying = {
  cardId: null,
  chapterTitle: null,
  chapterKey: null,
  trackTitle: null,
  trackKey: null,
  position: null,
  positionAt: 0,
  trackLength: null,
  playbackStatus: null,
  source: null,
  streaming: false,
  repeatAll: false,
  volume: null,
  volumeMax: null,
  sleepTimerActive: false,
  sleepTimerSeconds: null,
};

const IDLE: BoxLive = { conn: 'idle', error: null, now: IDLE_NOW, status: null, rejected: null };

interface Entry {
  state: BoxLive;
  subs: Set<() => void>;
  client: MqttClient | null;
  nudge?: number;
  retry?: number;
  attempt: number;
  /** back-off state for the partial-event resync (see resyncIfIncomplete) */
  resyncAt?: number;
  resyncTries: number;
  /** set while tearing down on purpose, so onClose does not reconnect */
  stopping: boolean;
}

const boxes = new Map<string, Entry>();

function entryOf(deviceId: string): Entry {
  let e = boxes.get(deviceId);
  if (!e) {
    e = { state: IDLE, subs: new Set(), client: null, attempt: 0, resyncTries: 0, stopping: false };
    boxes.set(deviceId, e);
  }
  return e;
}

/** Replace the snapshot (never mutate it - useSyncExternalStore compares refs). */
function patch(deviceId: string, next: Partial<BoxLive>) {
  const e = entryOf(deviceId);
  e.state = { ...e.state, ...next };
  for (const cb of e.subs) cb();
}

// --- value helpers -----------------------------------------------------------

const asNum = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const asStr = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const asBool = (v: unknown): boolean => v === true || v === 1;

const PLAYBACK: PlaybackStatus[] = ['playing', 'paused', 'stopped', 'loading'];

/** Merge one partial `data/events` message into the current now-playing state. */
function mergeEvents(now: NowPlaying, e: Record<string, unknown>): NowPlaying {
  const n = { ...now };
  const has = (k: string) => Object.prototype.hasOwnProperty.call(e, k);

  if (has('cardId')) {
    const id = asStr(e.cardId);
    const next = id && id !== 'none' ? id : null;
    // A different card means every per-track field the merge is holding belongs
    // to the old one. Keeping them showed the previous card's chapter title for
    // as long as the new card had not reported its own yet.
    if (next !== n.cardId) {
      n.chapterTitle = null;
      n.chapterKey = null;
      n.trackTitle = null;
      n.trackKey = null;
      n.trackLength = null;
      n.position = null;
    }
    n.cardId = next;
  }
  if (has('chapterTitle')) n.chapterTitle = asStr(e.chapterTitle);
  if (has('chapterKey')) n.chapterKey = asStr(e.chapterKey);
  if (has('trackTitle')) n.trackTitle = asStr(e.trackTitle);
  if (has('trackKey')) n.trackKey = asStr(e.trackKey);
  if (has('trackLength')) n.trackLength = asNum(e.trackLength);
  if (has('source')) n.source = asStr(e.source);
  if (has('streaming')) n.streaming = asBool(e.streaming);
  if (has('repeatAll')) n.repeatAll = asBool(e.repeatAll);
  if (has('volume')) n.volume = asNum(e.volume);
  if (has('volumeMax')) n.volumeMax = asNum(e.volumeMax);
  if (has('sleepTimerActive')) n.sleepTimerActive = asBool(e.sleepTimerActive);
  if (has('sleepTimerSeconds')) n.sleepTimerSeconds = asNum(e.sleepTimerSeconds);
  if (has('position')) {
    n.position = asNum(e.position);
    n.positionAt = Date.now();
  }
  if (has('playbackStatus')) {
    const s = asStr(e.playbackStatus) as PlaybackStatus | null;
    n.playbackStatus = s && PLAYBACK.includes(s) ? s : null;
    // a fresh status is also a fresh position reading, even without one attached
    if (!has('position')) n.positionAt = Date.now();
  }
  // nothing loaded means nothing to show about a track
  if (n.cardId === null) {
    n.chapterTitle = null;
    n.trackTitle = null;
    n.position = null;
    n.trackLength = null;
  }
  return n;
}

function mapStatus(s: Record<string, unknown>): BoxStatus {
  const card = asStr(s.activeCard);
  return {
    batteryLevel: asNum(s.batteryLevel),
    charging: asBool(s.charging),
    activeCard: card && card !== 'none' ? card : null,
    cardInserted: asNum(s.cardInserted),
    userVolume: asNum(s.userVolume),
    freeDisk: asNum(s.freeDisk),
    fwVersion: asStr(s.fwVersion),
    downloading: asBool(s.bgDownload),
  };
}

// --- connection --------------------------------------------------------------

const topic = (deviceId: string, suffix: string) => `device/${deviceId}/${suffix}`;

async function connect(deviceId: string) {
  const e = entryOf(deviceId);
  if (e.client || e.stopping) return;
  patch(deviceId, { conn: 'connecting', error: null });

  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    patch(deviceId, { conn: 'error', error: 'Sign in to control your player' });
    return;
  }
  // a second subscriber may have torn the entry down while the token resolved
  if (e.stopping || e.subs.size === 0) return;

  // a per-session client id: sharing one with the Yoto app or dashboard would
  // make AWS IoT kick whichever connection registered first
  const session = Math.random().toString(36).slice(2, 10);
  const clientId = `DASH${deviceId}${session}`.replace(/[^a-zA-Z0-9]/g, '');

  const client = new MqttClient({
    url: MQTT_URL,
    clientId,
    username: `${deviceId}?x-amz-customauthorizer-name=${AUTHORIZER}`,
    password: token,
    keepalive: KEEPALIVE_S,
    onConnect: () => {
      e.attempt = 0;
      patch(deviceId, { conn: 'live', error: null });
      client.subscribe([
        topic(deviceId, 'data/events'),
        topic(deviceId, 'data/status'),
        topic(deviceId, 'response'),
      ]);
      // the box only reports on change, so ask for the current picture once
      client.publish(topic(deviceId, 'command/events/request'), {});
      client.publish(topic(deviceId, 'command/status/request'), {});
      // …and keep asking, which doubles as the documented idle-keepalive.
      // Status is request-only per the docs, so it rides along or battery and
      // volume would go stale.
      e.nudge = window.setInterval(() => {
        client.publish(topic(deviceId, 'command/events/request'), {});
        client.publish(topic(deviceId, 'command/status/request'), {});
      }, NUDGE_MS);
    },
    onMessage: (t, payload) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        trace('←', t, payload);
        return; // not JSON: nothing this app understands
      }
      trace('←', t, msg);
      if (t.endsWith('/data/events')) {
        patch(deviceId, { now: mergeEvents(entryOf(deviceId).state.now, msg) });
        resyncIfIncomplete(deviceId);
      } else if (t.endsWith('/data/status')) {
        const s = msg.status;
        if (s && typeof s === 'object') {
          patch(deviceId, { status: mapStatus(s as Record<string, unknown>) });
        }
      }
      else if (t.endsWith('/response')) {
        // { status: { card: 'OK' | 'FAIL', req_body: '…' } } - the key names the
        // command. A FAIL here is the only signal for a command the box parsed
        // but refused, which otherwise looks like nothing happening at all.
        const s = msg.status;
        if (s && typeof s === 'object') {
          const failed = Object.entries(s as Record<string, unknown>).find(
            ([k, v]) => k !== 'req_body' && v === 'FAIL',
          );
          patch(deviceId, { rejected: failed ? failed[0] : null });
        }
      }
    },
    onClose: (reason) => {
      if (e.nudge) window.clearInterval(e.nudge);
      e.nudge = undefined;
      e.client = null;
      if (e.stopping || e.subs.size === 0) {
        patch(deviceId, { conn: 'idle', error: null });
        return;
      }
      patch(deviceId, { conn: 'error', error: humanError(reason) });
      const wait = RETRY_MS[Math.min(e.attempt, RETRY_MS.length - 1)];
      e.attempt++;
      e.retry = window.setTimeout(() => {
        e.retry = undefined;
        if (e.subs.size > 0) void connect(deviceId);
      }, wait);
    },
  });
  e.client = client;
}

/**
 * Pull a full events snapshot when the merged state is playing but incomplete.
 *
 * Starting a card makes the box tear the old one down first: it emits
 * `{cardId:'none', playbackStatus:'stopped'}` and then a bare
 * `{playbackStatus:'playing'}` with nothing attached. Since events are partial
 * and merged, that leaves the app believing nothing is loaded while the box is
 * happily playing. A requested events report always comes back complete, so one
 * request repairs it. Backed off and capped so a box that genuinely has no
 * track title can't turn this into a request loop.
 */
function resyncIfIncomplete(deviceId: string) {
  const e = boxes.get(deviceId);
  if (!e?.client?.live) return;
  const n = e.state.now;
  const busy = n.playbackStatus === 'playing' || n.playbackStatus === 'loading';
  if (!busy) {
    e.resyncTries = 0;
    return;
  }
  if (n.cardId && n.trackTitle && n.trackLength != null) {
    e.resyncTries = 0;
    return;
  }
  if (e.resyncTries >= 3) return;
  if (e.resyncAt && Date.now() - e.resyncAt < 2_000) return;
  e.resyncAt = Date.now();
  e.resyncTries++;
  const client = e.client;
  window.setTimeout(() => {
    if (client.live) client.publish(topic(deviceId, 'command/events/request'), {});
  }, 700);
}

function humanError(reason: string): string {
  if (reason.includes('not authorised')) {
    return 'Player control not granted - sign out and back in';
  }
  return reason;
}

function disconnect(deviceId: string) {
  const e = boxes.get(deviceId);
  if (!e) return;
  e.stopping = true;
  if (e.retry) window.clearTimeout(e.retry);
  if (e.nudge) window.clearInterval(e.nudge);
  e.retry = undefined;
  e.nudge = undefined;
  e.client?.end();
  e.client = null;
  e.attempt = 0;
  e.resyncTries = 0;
  e.stopping = false;
  e.state = IDLE;
}

/**
 * Watch one box. The first subscriber opens the MQTT connection, the last one
 * closes it. Returns the unsubscribe function.
 */
export function subscribeBox(deviceId: string, onChange: () => void): () => void {
  // callers may hold "no box selected" as an empty id; never open a socket for it
  if (!deviceId) return () => {};
  const e = entryOf(deviceId);
  e.subs.add(onChange);
  if (e.subs.size === 1) void connect(deviceId);
  return () => {
    e.subs.delete(onChange);
    if (e.subs.size === 0) disconnect(deviceId);
  };
}

/** Current snapshot; stable by reference until something actually changes. */
export function getBox(deviceId: string): BoxLive {
  return boxes.get(deviceId)?.state ?? IDLE;
}

// --- commands ----------------------------------------------------------------

/** Publish a command, then re-ask for events so the UI settles on device truth. */
/**
 * The same command over HTTP: POST /device-v2/{id}/command/{suffix} takes the
 * body the MQTT topic takes (yoto.dev/api → sendDeviceCommand). Used only when
 * the MQTT socket is down, so a command still lands while the channel is
 * reconnecting. Needs the `family:devices:control` scope - a token minted before
 * that scope was added answers 403, which is logged and otherwise ignored.
 */
function sendViaRest(deviceId: string, suffix: string, payload: unknown): void {
  void (async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/device-v2/${encodeURIComponent(deviceId)}/command/${suffix}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
      trace('→', `REST command/${suffix} → ${res.status}`, payload);
    } catch {
      /* offline; the MQTT reconnect will take over */
    }
  })();
}

function send(deviceId: string, suffix: string, payload: unknown): boolean {
  const e = boxes.get(deviceId);
  if (!e?.client?.live) {
    trace('→', `command/${suffix} no live socket - falling back to REST`, payload);
    sendViaRest(deviceId, suffix, payload);
    return false;
  }
  if (e.state.rejected) patch(deviceId, { rejected: null });
  trace('→', topic(deviceId, `command/${suffix}`), payload);
  e.client.publish(topic(deviceId, `command/${suffix}`), payload);
  const client = e.client;
  window.setTimeout(() => {
    if (client.live) client.publish(topic(deviceId, 'command/events/request'), {});
  }, 400);
  return true;
}

/** True while commands can actually reach the box. */
export const boxReady = (deviceId: string) => getBox(deviceId).conn === 'live';

/** Toggle play/pause from whatever the box reports right now. A stopped box has
 *  nothing to resume, so this reports false instead of pretending. */
export function boxPlayPause(deviceId: string): boolean {
  const { now } = getBox(deviceId);
  if (now.playbackStatus === 'playing') {
    const ok = send(deviceId, 'card/pause', {});
    if (ok) optimistic(deviceId, 'paused');
    return ok;
  }
  if (now.playbackStatus === 'paused') {
    const ok = send(deviceId, 'card/resume', {});
    if (ok) optimistic(deviceId, 'playing');
    return ok;
  }
  return false;
}

export function boxStop(deviceId: string): boolean {
  const ok = send(deviceId, 'card/stop', {});
  if (ok) optimistic(deviceId, 'stopped');
  return ok;
}

/** Volume as a percentage (0-100), which is the scale the command takes. */
export function boxSetVolume(deviceId: string, pct: number): boolean {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const ok = send(deviceId, 'volume/set', { volume: v });
  if (ok) {
    const s = getBox(deviceId);
    // paint the new level immediately on both scales the box reports on
    patch(deviceId, {
      now: { ...s.now, volume: Math.round((v / 100) * VOLUME_STEPS) },
      status: s.status ? { ...s.status, userVolume: v } : s.status,
    });
  }
  return ok;
}

/** Seconds until the box stops itself; 0 clears the timer. */
export function boxSleepTimer(deviceId: string, seconds: number): boolean {
  const ok = send(deviceId, 'sleep-timer/set', { seconds: Math.max(0, Math.round(seconds)) });
  if (ok) {
    const s = getBox(deviceId);
    patch(deviceId, {
      now: { ...s.now, sleepTimerActive: seconds > 0, sleepTimerSeconds: seconds > 0 ? seconds : null },
    });
  }
  return ok;
}

/**
 * Start a card on the box, optionally at a given chapter/track.
 *
 * Two behaviours of the player, both established against a real box:
 *
 *  - `card/start` is refused while the box is playing. It either answers
 *    `card-play: FAIL`, or acknowledges OK and then tears the card down - the
 *    screen flashes the unknown-card symbol and playback stops a few seconds
 *    later, which reads as "casting does nothing". So: stop first, always, and
 *    start a beat later.
 *  - `secondsIn` is never sent. Any start carrying it comes back
 *    `card-play: FAIL`, while the same start with only `chapterKey` and/or
 *    `trackKey` is accepted. Resuming at an offset is therefore not offered.
 *  - a jump needs BOTH keys. `chapterKey` on its own is acknowledged with
 *    `card-play: OK` and then silently ignored - with the matching card in the
 *    slot the box just carries on where the NFC card left off. Sending
 *    `chapterKey` + `trackKey` together lands on the requested track. MYO
 *    chapters wrap exactly one track keyed '01' (see publish.ts), so that is
 *    the default partner key.
 */
const DEFAULT_TRACK_KEY = '01';

export function boxStartCard(
  deviceId: string,
  cardId: string,
  opts: { chapterKey?: string; trackKey?: string } = {},
): boolean {
  const s = getBox(deviceId);
  const payload: Record<string, unknown> = { uri: `https://yoto.io/${cardId}` };
  if (opts.chapterKey) {
    payload.chapterKey = opts.chapterKey;
    payload.trackKey = opts.trackKey ?? DEFAULT_TRACK_KEY;
  } else if (opts.trackKey) {
    payload.trackKey = opts.trackKey;
  }

  const busy =
    s.now.playbackStatus === 'playing' ||
    s.now.playbackStatus === 'paused' ||
    s.now.playbackStatus === 'loading';

  // switching cards: don't leave the outgoing card's title on screen while the
  // box works out what it is loading
  if (cardId !== s.now.cardId) {
    patch(deviceId, {
      now: { ...s.now, chapterTitle: null, chapterKey: null, trackTitle: null, trackKey: null, trackLength: null, position: null },
    });
  }

  if (busy) {
    if (!send(deviceId, 'card/stop', {})) return false;
    window.setTimeout(() => send(deviceId, 'card/start', payload), RESTART_GAP_MS);
    optimistic(deviceId, 'loading');
    return true;
  }

  const ok = send(deviceId, 'card/start', payload);
  if (ok) optimistic(deviceId, 'loading');
  return ok;
}

/**
 * Jump one chapter relative to the one playing. A MYO card is one track per
 * chapter, so a chapter is a song.
 *
 * There is no next/previous command in the API - a skip is a fresh card start
 * aimed at the neighbouring chapter, with the stop-first dance boxStartCard
 * already handles.
 *
 * `chapterKeys` is the card's own key list, passed in when the app has the card
 * loaded. Without it the keys are assumed to be sequential zero-padded numbers,
 * which is the convention Yoto uses ('00', '01', '02', …).
 */
export function boxSkip(deviceId: string, delta: 1 | -1, chapterKeys?: string[]): boolean {
  const s = getBox(deviceId);
  const cardId = s.now.cardId ?? s.status?.activeCard ?? null;
  const current = s.now.chapterKey;
  if (!cardId || !current) return false;

  let next: string | undefined;
  if (chapterKeys?.length) {
    const i = chapterKeys.indexOf(current);
    if (i === -1) return false;
    next = chapterKeys[i + delta];
  } else {
    const n = parseInt(current, 10);
    if (!isFinite(n) || n + delta < 0) return false;
    next = String(n + delta).padStart(current.length, '0');
  }
  if (!next) return false; // past either end of the card
  return boxStartCard(deviceId, cardId, { chapterKey: next });
}

/** Whether a skip in this direction has somewhere to go. */
export function canSkip(live: BoxLive, delta: 1 | -1, chapterKeys?: string[]): boolean {
  const current = live.now.chapterKey;
  if (!current) return false;
  if (chapterKeys?.length) {
    const i = chapterKeys.indexOf(current);
    return i !== -1 && !!chapterKeys[i + delta];
  }
  const n = parseInt(current, 10);
  return isFinite(n) && n + delta >= 0;
}

// Dev builds get a console handle, so a command can be tried straight from the
// devtools prompt without clicking through the UI.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).box = {
    get: getBox,
    list: () => [...boxes.keys()],
    playPause: boxPlayPause,
    skip: boxSkip,
    stop: boxStop,
    volume: boxSetVolume,
    start: boxStartCard,
    raw: (deviceId: string, suffix: string, payload: unknown) => send(deviceId, suffix, payload),
  };
}

/** Ask the box to re-report; used when the popover opens. */
export function boxRefresh(deviceId: string) {
  const e = boxes.get(deviceId);
  if (!e?.client?.live) return;
  e.client.publish(topic(deviceId, 'command/events/request'), {});
  e.client.publish(topic(deviceId, 'command/status/request'), {});
}

/** Paint the expected state at once; the box's own events overwrite it. */
function optimistic(deviceId: string, playbackStatus: PlaybackStatus) {
  const s = getBox(deviceId);
  patch(deviceId, { now: { ...s.now, playbackStatus, positionAt: Date.now() } });
}

// --- derived -----------------------------------------------------------------

/**
 * Volume as a percentage.
 *
 * `status.userVolume` is already a percentage and is what the box itself shows,
 * so it wins. Events instead report the raw hardware step, and `volumeMax` there
 * is the configured *cap*, not the denominator: a box sitting at step 12 with a
 * cap of 12 is at 75%, not 100%. Dividing by the cap was showing every capped
 * box as maxed out.
 */
export function volumePct(live: BoxLive): number | null {
  if (live.status?.userVolume != null) return live.status.userVolume;
  const { volume } = live.now;
  return volume != null ? Math.round((volume / VOLUME_STEPS) * 100) : null;
}

/** Interpolated playback position: the box reports on change, not per second. */
export function livePosition(live: BoxLive): number | null {
  const { position, positionAt, playbackStatus, trackLength } = live.now;
  if (position == null) return null;
  if (playbackStatus !== 'playing' || !positionAt) return position;
  const p = position + (Date.now() - positionAt) / 1000;
  return trackLength ? Math.min(p, trackLength) : p;
}
