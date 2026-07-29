import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { fmtDur } from '../lib/format';
import { fetchDevices, type YotoDevice } from '../lib/devices';

/** Yoto's signed media URLs are used directly: <audio> plays them cross-origin
 *  without CORS, and the waveform decode below degrades to "no waveform" if the
 *  media host doesn't send CORS headers. */
const mediaUrl = (u: string) => u;

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

/** Bottom preview player: streams the track via the media proxy, real waveform. */
export function Player() {
  const playingUid = useStore((s) => s.playingUid);
  const playTrack = useStore((s) => s.playTrack);
  const playNext = useStore((s) => s.playNext);
  const playToggle = useStore((s) => s.playToggle);
  const showToast = useStore((s) => s.showToast);
  const openCard = useStore((s) => s.openCard);
  const setSelectedUids = useStore((s) => s.setSelectedUids);
  // look the track up across ALL cards so playback survives switching cards
  const cards = useStore((s) => s.cards);
  const track = playingUid ? cards.flatMap((c) => c.tracks).find((t) => t.uid === playingUid) ?? null : null;

  // double-click the title: jump to the card this track lives on and select it
  function revealTrack() {
    if (!playingUid) return;
    const owner = cards.find((c) => c.tracks.some((t) => t.uid === playingUid));
    if (!owner) return;
    openCard(owner.id);
    setSelectedUids([playingUid]);
  }

  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [sinkId, setSinkId] = useState('');
  const [devices, setDevices] = useState<YotoDevice[]>([]);
  const [outMenu, setOutMenu] = useState(false);

  const streamable = track?.trackUrl && /^https?:\/\//.test(track.trackUrl) ? track.trackUrl : null;

  // enumerate browser audio-output devices (Chrome; labels need prior permission)
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((ds) => setOutputs(ds.filter((d) => d.kind === 'audiooutput')))
      .catch(() => {});
  }, []);

  // list the user's Yoto players (empty if the token lacks the device scope)
  useEffect(() => {
    fetchDevices().then(setDevices);
  }, []);

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

  // spacebar (routed via the store nonce) toggles play/pause
  useEffect(() => {
    if (playToggle === 0) return;
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
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

  // load + autoplay whenever the target track changes
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !streamable) return;
    a.src = mediaUrl(streamable);
    a.volume = vol;
    setCur(0);
    setDur(track?.duration || 0);
    a.play().catch(() => setPlaying(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingUid]);

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

  function toggle() {
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
      <button className="pl-play" onClick={toggle} title={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="pl-time">{fmtDur(Math.floor(cur))}</span>
      <canvas className="pl-wave" ref={canvasRef} onClick={seek} title="Click to seek" />
      <span className="pl-time">{fmtDur(Math.floor(dur))}</span>
      <div className="pl-outwrap">
        <button
          className="pl-outbtn"
          title="Output device"
          onClick={(e) => {
            e.stopPropagation();
            setOutMenu((o) => !o);
          }}
        >
          <SpeakerIcon />
        </button>
        {outMenu && (
          <div className="pl-outmenu" onClick={(e) => e.stopPropagation()}>
            <div className="om-sec">This browser</div>
            <button
              className={`om-item${!sinkId ? ' on' : ''}`}
              title="Play through this browser's default audio output"
              onClick={() => {
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
                  className={`om-item${sinkId === d.deviceId ? ' on' : ''}`}
                  title={d.label || 'Audio output'}
                  onClick={() => {
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
                <button
                  key={d.deviceId}
                  className="om-item"
                  title={`Cast to ${d.name}`}
                  onClick={() => {
                    showToast('Casting to the Yoto box is coming soon');
                    setOutMenu(false);
                  }}
                >
                  📻 {d.name}
                  {d.online ? '' : ' · offline'}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <span className="pl-vol" title="Volume">🔊</span>
      <input
        className="pl-volrange"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={vol}
        onChange={(e) => {
          const v = +e.target.value;
          setVol(v);
          if (audioRef.current) audioRef.current.volume = v;
        }}
      />
      <button className="pl-close" onClick={() => playTrack(null)} title="Close player">
        ✕
      </button>
    </div>
  );
}
