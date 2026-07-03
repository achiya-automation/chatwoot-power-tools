/*
 * videoCompress — PURE planning math for in-browser video compression.
 *
 * No DOM, no codec imports here — kept side-effect-free so it is unit-tested with
 * node:test. The impure runner (videoCompressRunner.js) reads the file's metadata, calls
 * these to decide the encode parameters, then transcodes via mediabunny/WebCodecs.
 *
 * Goal: bring an oversized WhatsApp video under Meta's 16MB Cloud-API header limit
 * entirely on the agent's machine, so nothing transcodes on the server.
 */

const MB = 1024 * 1024;

// Aim a little under WhatsApp's hard 16MB so the result always clears the gate
// (container overhead + estimate error). 15.3MB target.
export const VIDEO_TARGET_BYTES = Math.floor(15.3 * MB);

// WhatsApp-accepted video containers (mirror of WA_MEDIA.VIDEO in waMedia.js).
const ACCEPTED_VIDEO_MIMES = ['video/mp4', 'video/3gpp'];

export const MAX_HEIGHT = 720; // downscale ceiling — 720p is plenty for a phone
export const DEFAULT_AUDIO_KBPS = 96; // AAC budget reserved from the total
export const MIN_VIDEO_KBPS = 200; // below this, video is unwatchable → declare infeasible
export const MAX_VIDEO_KBPS = 6000; // no point re-encoding above this for a <16MB file
const SAFETY = 0.95; // target a touch under, to absorb mux overhead/estimate drift

/**
 * Even, clamped, never-upscaled output height. H.264 requires even dimensions.
 */
export function targetHeight(srcHeight, maxHeight = MAX_HEIGHT) {
  const h = Math.min(Number(srcHeight) || maxHeight, maxHeight);
  return Math.max(2, Math.floor(h / 2) * 2);
}

/**
 * Should this upload be compressed at all? Only oversized real videos — images,
 * documents and already-small videos pass straight through untouched.
 */
export function needsCompression({ format, mime, byteSize, targetBytes = VIDEO_TARGET_BYTES } = {}) {
  if (String(format || '').toUpperCase() !== 'VIDEO') return false;
  if (!/^video\//i.test(String(mime || ''))) return false;
  return (Number(byteSize) || 0) > targetBytes;
}

/**
 * The single decision the UI needs: should this upload be routed through ffmpeg
 * before sending? True for a VIDEO-header file that is a real video AND is either
 * oversized OR in a non-WhatsApp container (e.g. .mov/.webm → re-muxed to mp4).
 * Non-videos fall through to validation, which rejects them with a clear message.
 */
export function needsTranscode({ format, mime, byteSize, targetBytes = VIDEO_TARGET_BYTES } = {}) {
  if (String(format || '').toUpperCase() !== 'VIDEO') return false;
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (!/^video\//.test(m)) return false;
  const oversized = (Number(byteSize) || 0) > targetBytes;
  return oversized || !ACCEPTED_VIDEO_MIMES.includes(m);
}

/**
 * Pick encode parameters that should land under targetBytes.
 *   videoBitrate = (targetBytes·8·safety / duration) − audio, clamped to [MIN, MAX]
 *   scaleHeight  = min(source, 720), even
 * feasible=false when even the minimum bitrate at the lowest sensible quality can't
 * fit the duration — the UI then tells the agent to trim or send a link instead.
 *
 * @returns {{feasible:boolean, scaleHeight:number, videoKbps:number, audioKbps:number}}
 */
export function planCompression({
  durationSec,
  height,
  targetBytes = VIDEO_TARGET_BYTES,
  audioKbps = DEFAULT_AUDIO_KBPS,
  maxHeight = MAX_HEIGHT,
} = {}) {
  const scaleHeight = targetHeight(height, maxHeight);
  const dur = Number(durationSec) || 0;

  // Unknown duration (metadata unreadable) → optimistic default; size-check + retry corrects.
  if (dur <= 0) {
    return { feasible: true, scaleHeight, videoKbps: MIN_VIDEO_KBPS * 4, audioKbps };
  }

  const totalKbps = (targetBytes * 8 * SAFETY) / dur / 1000;
  const rawVideoKbps = Math.floor(totalKbps - audioKbps);
  const feasible = rawVideoKbps >= MIN_VIDEO_KBPS;
  const videoKbps = Math.max(MIN_VIDEO_KBPS, Math.min(MAX_VIDEO_KBPS, rawVideoKbps));
  return { feasible, scaleHeight, videoKbps, audioKbps };
}

/**
 * Retry bitrate after a pass overshot: scale down by how far we missed, with the
 * same safety margin, floored at the minimum.
 */
export function nextBitrate({ prevVideoKbps, achievedBytes, targetBytes = VIDEO_TARGET_BYTES }) {
  const achieved = Number(achievedBytes) || targetBytes;
  const ratio = targetBytes / achieved;
  const next = Math.floor((Number(prevVideoKbps) || MIN_VIDEO_KBPS) * ratio * SAFETY);
  return Math.max(MIN_VIDEO_KBPS, next);
}
