// Audio upload → transcode pipeline (yoto.dev/myo/uploading-to-cards).
// All API calls go through the backend proxy; the PUT goes straight to the
// signed storage URL returned in step 1. Field names are read defensively and
// will be pinned once verified against the docs.

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface UploadedTrack {
  trackUrl: string; // yoto:#<sha>
  duration: number;
  fileSize: number;
  channels?: string;
  format?: string;
}

type Pct = (p: number) => void;

/** Upload one audio file and resolve when Yoto has transcoded it. */
export async function uploadAudioFile(file: File, onPct: Pct): Promise<UploadedTrack> {
  const buf = await file.arrayBuffer();
  const sha = await sha256Hex(buf);
  onPct(10);

  // 1. ask for a signed upload URL keyed by the file's sha256
  const q = `sha256=${sha}&filename=${encodeURIComponent(file.name)}`;
  const u = await fetch(`/api/yoto/media/transcode/audio/uploadUrl?${q}`, {
    credentials: 'same-origin',
  });
  if (!u.ok) throw new Error(`uploadUrl ${u.status}`);
  const uj = await u.json();
  const info = uj.upload ?? {};
  const uploadUrl: string | null | undefined = info.uploadUrl; // null = file already stored (dedup)
  const uploadId: string | undefined = info.uploadId;
  if (!uploadId) throw new Error('uploadId missing in response');

  // 2. PUT the raw bytes to the signed storage URL (skipped if Yoto already has it)
  if (uploadUrl) {
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      body: buf,
      headers: { 'content-type': file.type || 'audio/mpeg' },
    });
    if (!put.ok) throw new Error(`upload PUT ${put.status}`);
  }
  onPct(55);

  // 3. poll until the transcode is ready (completion signal: transcode.transcodedSha256)
  for (let i = 0; i < 60; i++) {
    const t = await fetch(
      `/api/yoto/media/upload/${encodeURIComponent(uploadId)}/transcoded?loudnorm=false`,
      { credentials: 'same-origin' },
    );
    if (t.ok) {
      const tj = await t.json();
      const outer = tj.transcode ?? {};
      const finalSha: string | undefined = outer.transcodedSha256;
      if (finalSha) {
        const m = outer.transcodedInfo ?? {};
        onPct(100);
        return {
          trackUrl: `yoto:#${finalSha}`,
          duration: m.duration ?? 0,
          fileSize: m.fileSize ?? file.size,
          channels: m.channels,
          format: m.format,
        };
      }
    }
    onPct(55 + Math.min(40, i));
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('transcode timed out');
}
