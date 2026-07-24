import { useStore } from '../store';
import {
  formatCapacityDuration,
  getPlaylistCapacitySnapshot,
  getPlaylistPreflightLimitError,
  YOTO_MYO_MAX_CARD_BYTES,
} from '../lib/yotoLimits';

function state(ratio: number): string {
  return ratio > 1 ? 'over' : ratio > 0.9 ? 'warn' : '';
}

function Bar({
  label,
  cur,
  max,
  curText,
  maxText,
}: {
  label: string;
  cur: number;
  max: number;
  curText: string;
  maxText: string;
}) {
  const ratio = max > 0 ? cur / max : 0;
  return (
    <div className="cap">
      <span className="lbl">{label}</span>
      <div className="bar">
        <div className={`fill ${state(ratio)}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <span className={`val ${ratio > 1 ? 'over' : ''}`}>
        {curText} <span className="q">/ {maxText}</span>
      </span>
    </div>
  );
}

export function CapacityMeter() {
  const tracks = useStore((s) => s.activeCard()?.tracks ?? []);
  // yotoLimits speaks Yoto's field name `fileSize`; our track model uses `size`.
  const capTracks = tracks.map((t) => ({ title: t.title, duration: t.duration, fileSize: t.size }));
  const snap = getPlaylistCapacitySnapshot(capTracks);
  const error = getPlaylistPreflightLimitError(capTracks);

  return (
    <div className="capacity">
      <Bar
        label="Tracks"
        cur={snap.trackCount}
        max={snap.trackMax}
        curText={String(snap.trackCount)}
        maxText="100"
      />
      <Bar
        label="Time"
        cur={snap.knownDurationSeconds}
        max={snap.durationMax}
        curText={formatCapacityDuration(snap.knownDurationSeconds)}
        maxText="5h"
      />
      <Bar
        label="Size"
        cur={snap.knownFileSizeBytes}
        max={YOTO_MYO_MAX_CARD_BYTES}
        curText={`${(snap.knownFileSizeBytes / 1048576).toFixed(0)} MB`}
        maxText="500"
      />
      {error && <div className="warnmsg">⚠ {error}</div>}
    </div>
  );
}
