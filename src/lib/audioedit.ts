// Browser-side audio trimming, zero dependencies. We decode the track's audio
// with the WebAudio API, slice the buffer to a [start, end] window, and encode
// it back to a WAV File. Yoto's upload pipeline transcodes whatever we send to
// opus, so WAV in is fine - it just keeps us free of any mp3/ffmpeg dependency
// (ffmpeg-wasm alone is a 65 MB blob).

/** Fetch + decode a streamable (https) track URL into an AudioBuffer.
 *  decodeAudioData needs the raw bytes, so the signed media host has to answer
 *  with CORS headers - unlike <audio> playback, which works without them. */
export async function decodeTrackAudio(streamUrl: string): Promise<AudioBuffer> {
  const res = await fetch(streamUrl);
  if (!res.ok) throw new Error(`fetch audio ${res.status}`);
  const buf = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(buf);
  } finally {
    void ctx.close();
  }
}

/** Slice an AudioBuffer to [startSec, endSec] into a fresh buffer (offline ctx). */
function sliceBuffer(buffer: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const rate = buffer.sampleRate;
  const s = Math.max(0, Math.floor(startSec * rate));
  const e = Math.min(buffer.length, Math.floor(endSec * rate));
  const len = Math.max(1, e - s);
  const ch = buffer.numberOfChannels;
  const out = new AudioBuffer({ length: len, numberOfChannels: ch, sampleRate: rate });
  for (let c = 0; c < ch; c++) {
    out.copyToChannel(buffer.getChannelData(c).subarray(s, e), c, 0);
  }
  return out;
}

/** Encode an AudioBuffer to a 16-bit PCM WAV File. */
function bufferToWav(buffer: AudioBuffer, filename: string): File {
  const ch = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = ch * bytesPerSample;
  const dataLen = frames * blockAlign;
  const ab = new ArrayBuffer(44 + dataLen);
  const view = new DataView(ab);
  const wstr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  wstr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, ch, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  wstr(36, 'data');
  view.setUint32(40, dataLen, true);

  // interleave channels, clamp to 16-bit
  const chans: Float32Array[] = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      let v = chans[c][i];
      v = v < -1 ? -1 : v > 1 ? 1 : v;
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  const base = filename.replace(/\.[^.]+$/, '') || 'audio';
  return new File([ab], `${base}-trim.wav`, { type: 'audio/wav' });
}

/** Produce a WAV File containing only the [startSec, endSec] window. */
export function cutToWavFile(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  filename: string,
): File {
  return bufferToWav(sliceBuffer(buffer, startSec, endSec), filename);
}
