import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { fmtDur } from '../lib/format';
import type { YotoDevice } from '../lib/devices';
import {
  boxPlayPause,
  boxSetVolume,
  boxStartCard,
  boxStop,
  getBox,
  livePosition,
  volumePct,
} from '../lib/box';
import { useBox } from './useBox';
import { useDevices } from './useDevices';

/** Yoto's signed media URLs are used directly: <audio> plays them cross-origin
 *  without CORS, and the waveform decode below degrades to "no waveform" if the
 *  media host doesn't send CORS headers. */
const mediaUrl = (u: string) => u;

/** Radio glyph: shown on the output button while a physical box is the output. */
function BoxIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="8" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8.5" cy="14" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14 12.5h4M14 15.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 8 17 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Loudspeaker glyph for the output-device button. */
function SpeakerIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      <path d="M16 8.8a4.5 4.5 0 010 6.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18.7 6.2a8 8 0 010 11.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * One box in the output menu. Reachability comes from the live MQTT channel,
 * not from the device list: `/device-v2/devices/mine` does not reliably carry
 * an `online` flag, and gating the button on it silently disabled casting.
 */
function CastItem({
  device,
  cardTitle,
  active,
  onPick,
}: {
  device: YotoDevice;
  cardTitle: string;
  active: boolean;
  onPick: () => void;
}) {
  const live = useBox(device.deviceId);
  const ready = live.conn === 'live';
  return (
    <button
      className={`om-item${active ? ' on' : ''}`}
      title={ready ? `Play “${cardTitle}” on ${device.name}` : `${device.name}: ${live.error ?? 'connecting…'}`}
      onClick={onPick}
    >
      📻 {device.name}
      {ready ? '' : live.conn === 'connecting' ? ' · connecting…' : ' · offline'}
    </button>
  );
}

/** Bottom preview player: streams the track via the media proxy, real waveform. */
export function Player() {
  const playingUid = useStore((s) => s.playingUid);
  const playTrack = useStore((s) => s.playTrack);
  const playNext = useStore((s) => s.playNext);
  const playToggle = useStore((s) => s.playToggle);
  const showToast = useStore((s) => s.showToast);
  const openCard = useStore((s) => s.openCard);
  const setSelectedUids = useStore((s) => s.setSelectedUids);
  const outputBox = useStore((s) => s.outputBox);
  const setOutputBox = useStore((s) => s.setOutputBox);
  // look the track up across ALL cards so playback survives switching cards
  const cards = useStore((s) => s.cards);
  const track = playingUid ? cards.flatMap((c) => c.tracks).find((t) => t.uid === playingUid) ?? null : null;

  const owner = playingUid ? cards.find((c) => c.tracks.some((t) => t.uid === playingUid)) ?? null : null;

  // double-click the title: jump to the card this track lives on and select it
  function revealTrack() {
    if (!playingUid || !owner) return;
    openCard(owner.id);
    setSelectedUids([playingUid]);
  }

  /**
   * Switch the bar's output to a physical box. Nothing else about the bar
   * changes: the selected track is simply started over there instead of here.
   * A card that only exists as a local draft has no id to hand over yet.
   */
  function pickBox(d: YotoDevice) {
    setOutMenu(false);
    if (!owner) return;
    if (owner.id.startsWith('new_')) {
      showToast('Publish this playlist to Yoto first, then it can play on the box');
      return;
    }
    setOutputBox({ deviceId: d.deviceId, name: d.name });
  }

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** last (box, card, chapter) actually sent, so the same start never repeats */
  const lastCastRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [sinkId, setSinkId] = useState('');
  const devices = useDevices();
  const [outMenu, setOutMenu] = useState(false);
  const [, boxTick] = useState(0);

  // live state of the box, when one is the output. An empty id subscribes to
  // nothing, so this hook is safe to call unconditionally.
  const boxLive = useBox(outputBox?.deviceId ?? '');
  const onBox = !!outputBox;
  const boxPlaying = boxLive.now.playbackStatus === 'playing';

  const streamable = track?.trackUrl && /^https?:\/\//.test(track.trackUrl) ? track.trackUrl : null;

  // enumerate browser audio-output devices (Chrome; labels need prior permission)
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((ds) => setOutputs(ds.filter((d) => d.kind === 'audiooutput')))
      .catch(() => {});
  }, []);

  // Hand the selected track to the box whenever either changes, and keep the
  // browser silent so the same audio never comes out of two places.
  //
  // The guard is load-bearing, not defensive: StrictMode runs effects twice in
  // dev, and the second run sees the box as already busy, so it fires the
  // stop-then-restart path - the stop lands after the first start and kills
  // playback. One start per (box, track) is the only correct behaviour anyway.
  useEffect(() => {
    if (!outputBox || !owner || !track) return;
    const req = `${outputBox.deviceId}|${owner.id}|${track.key}`;
    if (lastCastRef.current === req) return;
    lastCastRef.current = req;
    audioRef.current?.pause();
    if (!boxStartCard(outputBox.deviceId, owner.id, { chapterKey: track.key })) {
      showToast(`${outputBox.name} isn’t reachable right now`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputBox?.deviceId, playingUid]);

  // the box reports position only when it changes, so advance it locally
  useEffect(() => {
    if (!onBox || !boxPlaying) return;
    const id = window.setInterval(() => boxTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [onBox, boxPlaying]);

  // close the output menu on any outside interaction
  useEffect(() => {
    if (!outMenu) return;
    const close = () => setOutMenu(false);
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
    };
  }, [outMenu]);

  // route audio to the chosen output device (HTMLMediaElement.setSinkId)
  useEffect(() => {
    const a = audioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (a?.setSinkId && sinkId) a.setSinkId(sinkId).catch(() => {});
  }, [sinkId, playingUid]);

  // spacebar (routed via the store nonce) toggles play/pause on whatever the
  // current output is
  useEffect(() => {
    if (playToggle === 0) return;
    if (outputBox) {
      boxPlayPause(outputBox.deviceId);
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playToggle]);

  // mirror the playing track's icon into the browser-tab favicon; restore on stop
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    const original = link.dataset.original ?? link.getAttribute('href') ?? '';
    link.dataset.original = original;
    if (track?.icon) link.href = track.icon;
    return () => {
      const orig = link!.dataset.original ?? '';
      if (orig) link!.href = orig;
      else link!.removeAttribute('href');
    };
  }, [playingUid, track?.icon]);

  // load + autoplay whenever the target track changes. With a box as the output
  // the element is loaded but stays silent - otherwise the same track comes out
  // of the laptop and the Yoto at once.
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !streamable) return;
    a.src = mediaUrl(streamable);
    a.volume = vol;
    setCur(0);
    setDur(track?.duration || 0);
    if (outputBox) {
      a.pause();
      return;
    }
    a.play().catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingUid, outputBox?.deviceId]);

  // decode the audio into normalized peaks for the waveform
  useEffect(() => {
    let cancelled = false;
    setPeaks(null);
    if (!streamable) return;
    (async () => {
      try {
        const res = await fetch(mediaUrl(streamable));
        const buf = await res.arrayBuffer();
        const ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        ctx.close();
        if (cancelled) return;
        const raw = decoded.getChannelData(0);
        const N = 180;
        const block = Math.floor(raw.length / N) || 1;
        const p: number[] = new Array(N);
        let max = 0;
        for (let i = 0; i < N; i++) {
          let s = 0;
          const st = i * block;
          for (let j = 0; j < block; j++) s += Math.abs(raw[st + j] || 0);
          p[i] = s / block;
          if (p[i] > max) max = p[i];
        }
        const norm = max || 1;
        setPeaks(p.map((v) => v / norm));
      } catch {
        /* decode failed → flat placeholder bars */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingUid]);

  // draw the waveform on the canvas
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const data = peaks ?? new Array(120).fill(0.28);
    const n = data.length;
    const barW = w / n;
    const playedN = dur ? Math.floor((cur / dur) * n) : 0;
    for (let i = 0; i < n; i++) {
      const bh = Math.max(2, data[i] * (h - 2));
      const x = i * barW;
      const y = (h - bh) / 2;
      ctx.fillStyle = i < playedN ? '#ee5a1c' : '#4a4d53';
      const bw = Math.max(1, barW - 1);
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, 1);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, bw, bh);
      }
    }
  }, [peaks, cur, dur]);

  if (!track) return null;

  // what the bar shows: the box's own clock when it is the output, else the
  // <audio> element's
  const boxPos = onBox ? livePosition(boxLive) : null;
  const shownCur = onBox ? boxPos ?? 0 : cur;
  const shownDur = onBox ? boxLive.now.trackLength ?? track.duration ?? 0 : dur;
  const shownPlaying = onBox ? boxPlaying : playing;
  // null until the box has reported its own volume. Showing 0 in the meantime
  // is not harmless: one click on the slider would write that 0 to the box and
  // silence it, so the control stays disabled until the real value arrives.
  const boxVol = onBox ? volumePct(boxLive) : null;
  const shownVol = onBox ? (boxVol ?? 0) / 100 : vol;
  const volReady = !onBox || boxVol != null;

  function toggle() {
    if (onBox && outputBox) {
      const st = getBox(outputBox.deviceId).now.playbackStatus;
      const ok =
        st === 'playing' || st === 'paused'
          ? boxPlayPause(outputBox.deviceId)
          : owner
            ? boxStartCard(outputBox.deviceId, owner.id, { chapterKey: track!.key })
            : false;
      if (!ok) showToast(`${outputBox.name} did not accept that just now`);
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }

  function seek(e: React.MouseEvent<HTMLCanvasElement>) {
    const a = audioRef.current;
    if (!a || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * dur;
  }

  return (
    <div className="player">
      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || track?.duration || 0)}
        onEnded={() => {
          setPlaying(false);
          playNext();
        }}
      />
      <div className="pl-meta">
        <span
          className="pl-title"
          title={`${track.title}\nDouble-click to show in playlist`}
          onDoubleClick={revealTrack}
        >
          {track.title}
        </span>
      </div>
      <button className="pl-play" onClick={toggle} title={shownPlaying ? 'Pause' : 'Play'}>
        {shownPlaying ? '❚❚' : '▶'}
      </button>
      <span className="pl-time">{fmtDur(Math.floor(shownCur))}</span>
      <canvas
        className="pl-wave"
        ref={canvasRef}
        onClick={seek}
        title={onBox ? 'The player has no seek command' : 'Click to seek'}
      />
      <span className="pl-time">{fmtDur(Math.floor(shownDur))}</span>
      <div className="pl-outwrap">
        <button
          className={`pl-outbtn${onBox ? ' on' : ''}`}
          title={onBox ? `Playing on ${outputBox!.name}` : 'Output device'}
          onClick={(e) => {
            e.stopPropagation();
            setOutMenu((o) => !o);
          }}
        >
          {onBox ? <BoxIcon /> : <SpeakerIcon />}
        </button>
        {outMenu && (
          <div className="pl-outmenu" onClick={(e) => e.stopPropagation()}>
            <div className="om-sec">This browser</div>
            <button
              className={`om-item${!sinkId && !onBox ? ' on' : ''}`}
              title="Play through this browser's default audio output"
              onClick={() => {
                setOutputBox(null);
                setSinkId('');
                setOutMenu(false);
              }}
            >
              🔊 Default output
            </button>
            {outputs
              .filter((d) => d.deviceId && d.deviceId !== 'default')
              .map((d, i) => (
                <button
                  key={d.deviceId}
                  className={`om-item${sinkId === d.deviceId && !onBox ? ' on' : ''}`}
                  title={d.label || 'Audio output'}
                  onClick={() => {
                    setOutputBox(null);
                    setSinkId(d.deviceId);
                    setOutMenu(false);
                  }}
                >
                  🔊 {d.label || `Audio output ${i + 2}`}
                </button>
              ))}
            <div className="om-sec">Yoto devices</div>
            {devices.length === 0 ? (
              <div className="om-hint">No boxes available (needs device access)</div>
            ) : (
              devices.map((d) => (
                <CastItem
                  key={d.deviceId}
                  device={d}
                  cardTitle={owner?.title ?? 'this playlist'}
                  active={outputBox?.deviceId === d.deviceId}
                  onPick={() => pickBox(d)}
                />
              ))
            )}
          </div>
        )}
      </div>
      <span className="pl-vol" title={onBox ? `${outputBox!.name} volume` : 'Volume'}>🔊</span>
      <input
        className="pl-volrange"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={shownVol}
        disabled={!volReady}
        title={volReady ? undefined : 'Waiting for the player to report its volume'}
        onChange={(e) => {
          const v = +e.target.value;
          if (onBox && outputBox) {
            boxSetVolume(outputBox.deviceId, Math.round(v * 100));
            return;
          }
          setVol(v);
          if (audioRef.current) audioRef.current.volume = v;
        }}
      />
      <button
        className="pl-close"
        onClick={() => {
          if (onBox && outputBox) boxStop(outputBox.deviceId);
          playTrack(null);
        }}
        title="Close player"
      >
        ✕
      </button>
    </div>
  );
}
