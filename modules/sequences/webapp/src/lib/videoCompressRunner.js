/*
 * videoCompressRunner — the impure side of in-browser compression. Reads the file's
 * metadata, asks videoCompress.js for an encode plan, and transcodes via mediabunny,
 * which drives the browser's native WebCodecs H.264 encoder (hardware-accelerated).
 *
 * Nothing runs on the server — the agent's machine does the work and the server only
 * ever receives the already-small result. WebCodecs needs no SharedArrayBuffer / COOP-COEP
 * headers (unlike multi-threaded ffmpeg.wasm), so the embedded Chatwoot iframe is untouched,
 * and hardware encoding is ~10-50× faster than ffmpeg.wasm (seconds, not minutes).
 *
 * The pure planning math lives in videoCompress.js and is codec-agnostic — this file only
 * turns a plan (target bitrate + height) into a mediabunny Conversion.
 */
import { VIDEO_TARGET_BYTES, planCompression, nextBitrate } from './videoCompress.js';

const MAX_ATTEMPTS = 3; // first pass + up to 2 bitrate-reducing retries

// mediabunny is dynamically imported so it only loads when a video actually needs
// transcoding — keeps the main bundle lean (it never loads for image/doc uploads).
let _mb = null;
async function mb() {
  if (!_mb) _mb = await import('mediabunny');
  return _mb;
}

/** Can this browser transcode video? (WebCodecs present.) Used for graceful degradation. */
export function isCompressionSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';
}

// ── cancellation ─────────────────────────────────────────────────────────────
let _current = null; // the in-flight Conversion, so the UI can abort it

export async function terminateCompression() {
  const c = _current;
  _current = null;
  try {
    if (c && c.isValid) await c.cancel();
  } catch {
    /* already done */
  }
}

/** Read duration + dimensions + audio presence straight from the container (reliable). */
async function readMeta(file) {
  const { Input, BlobSource, ALL_FORMATS } = await mb();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const vtrack = await input.getPrimaryVideoTrack();
  let durationSec = 0;
  try {
    durationSec = (await input.getDurationFromMetadata()) || 0;
  } catch {
    /* fall through to compute */
  }
  if (!durationSec) {
    try {
      durationSec = await input.computeDuration();
    } catch {
      durationSec = 0;
    }
  }
  const hasAudio = !!(await input.getPrimaryAudioTrack().catch(() => null));
  const width = vtrack ? await vtrack.getDisplayWidth().catch(() => 0) : 0;
  const height = vtrack ? await vtrack.getDisplayHeight().catch(() => 0) : 0;
  return { durationSec, width, height, hasAudio };
}

/** Even output dimensions preserving aspect ratio; never upscales (targetH ≤ source). */
function evenDims(srcW, srcH, targetH) {
  if (!srcW || !srcH) return { height: targetH }; // unknown → let the lib keep aspect
  const w = Math.max(2, Math.round((srcW * targetH) / srcH / 2) * 2);
  return { width: w, height: targetH };
}

function mp4Name(name) {
  const base = String(name || 'video').replace(/\.[^./\\]+$/, '');
  return `${base || 'video'}.mp4`;
}

async function convertOnce(file, { dims, videoKbps, audioKbps, hasAudio, onProgress }) {
  const { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS } = await mb();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const opts = {
    input,
    output,
    // dims are already aspect-proportional; 'contain' is required by mediabunny when both
    // width+height are set, and guarantees no distortion (at most a hair of letterbox).
    video: { ...dims, ...(dims.width ? { fit: 'contain' } : {}), codec: 'avc', bitrate: videoKbps * 1000 },
  };
  if (hasAudio) opts.audio = { codec: 'aac', bitrate: audioKbps * 1000 };

  const conversion = await Conversion.init(opts);
  _current = conversion;
  if (onProgress) conversion.onProgress = (p) => onProgress(Math.max(0, Math.min(1, p || 0)));
  await conversion.execute();
  _current = null;

  const buf = output.target.buffer;
  if (!buf) throw new Error('ההמרה לא הפיקה פלט');
  return buf; // ArrayBuffer
}

// serialize: one transcode at a time (and a clean cancel point)
let _chain = Promise.resolve();

/**
 * Compress an oversized / wrong-format video under targetBytes, in the browser via WebCodecs.
 *
 * @param {File} file
 * @param {{targetBytes?:number, onProgress?:(p:number)=>void, onStage?:(s:string)=>void}} opts
 * @returns {Promise<{file:File, before:number, after:number, plan:object}>}
 * @throws Error with .code 'UNSUPPORTED' | 'INFEASIBLE' (too long) | 'OVERSIZE' (didn't fit)
 */
export function compressVideo(file, opts = {}) {
  const run = async () => {
    const { targetBytes = VIDEO_TARGET_BYTES, onProgress, onStage } = opts;
    if (!isCompressionSupported()) {
      const e = new Error('הדפדפן לא תומך בדחיסת וידאו — עדכנו את הדפדפן או שלחו כקישור');
      e.code = 'UNSUPPORTED';
      throw e;
    }

    onStage?.('probe');
    const meta = await readMeta(file);
    const plan = planCompression({ durationSec: meta.durationSec, height: meta.height, targetBytes });
    if (!plan.feasible) {
      const e = new Error('הסרטון ארוך מדי לדחיסה אוטומטית מתחת ל-16MB — קצרו אותו או שלחו כקישור');
      e.code = 'INFEASIBLE';
      throw e;
    }
    const { canEncodeVideo } = await mb();
    if (!(await canEncodeVideo('avc').catch(() => false))) {
      const e = new Error('הדפדפן לא תומך בקידוד H.264 — שלחו כקישור');
      e.code = 'UNSUPPORTED';
      throw e;
    }

    const dims = evenDims(meta.width, meta.height, plan.scaleHeight);
    let videoKbps = plan.videoKbps;
    let buf = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      onStage?.(attempt === 1 ? 'encode' : 'encode-retry');
      onProgress?.(0);
      buf = await convertOnce(file, { dims, videoKbps, audioKbps: plan.audioKbps, hasAudio: meta.hasAudio, onProgress });
      if (buf.byteLength <= targetBytes) break;
      if (attempt === MAX_ATTEMPTS) {
        const e = new Error('לא הצלחנו לכווץ מתחת ל-16MB — נסו סרטון קצר יותר או שלחו כקישור');
        e.code = 'OVERSIZE';
        throw e;
      }
      videoKbps = nextBitrate({ prevVideoKbps: videoKbps, achievedBytes: buf.byteLength, targetBytes });
    }
    onProgress?.(1);
    const result = new File([buf], mp4Name(file.name), { type: 'video/mp4' });
    return { file: result, before: file.size, after: result.size, plan };
  };
  const result = _chain.then(run, run);
  _chain = result.catch(() => {});
  return result;
}
