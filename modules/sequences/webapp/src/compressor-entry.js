/*
 * compressor-entry — standalone ESM entry imported by the Chatwoot dashboard injector
 * (chatwoot/dashboard-script.html) to compress an oversized WhatsApp video IN THE BROWSER
 * before Chatwoot's native composer uploads it. Served at a stable URL /drip/compressor.js.
 *
 * Reuses the exact same proven pipeline as the drip panel (videoCompress.js planning +
 * mediabunny/WebCodecs runner). Fail-safe: any error returns the original file untouched,
 * so the injector never blocks the agent — worst case is Chatwoot's normal behavior.
 */
import { needsTranscode, VIDEO_TARGET_BYTES } from './lib/videoCompress.js';
import { compressVideo, isCompressionSupported } from './lib/videoCompressRunner.js';

/**
 * Compress `file` if it's an oversized / wrong-container video; otherwise return it as-is.
 * @param {File} file
 * @param {{onProgress?:(p:number)=>void, onStage?:(s:string)=>void}} cbs
 * @returns {Promise<{file:File, compressed:boolean, before?:number, after?:number, error?:string}>}
 */
export async function maybeCompressForWhatsApp(file, cbs = {}) {
  try {
    if (!file || !isCompressionSupported()) return { file, compressed: false };
    if (!needsTranscode({ format: 'VIDEO', mime: file.type, byteSize: file.size })) {
      return { file, compressed: false };
    }
    const r = await compressVideo(file, cbs);
    return { file: r.file, compressed: true, before: r.before, after: r.after };
  } catch (e) {
    // fail-safe — never block the agent's attachment
    return { file, compressed: false, error: String((e && e.message) || e) };
  }
}

// Expose on a global as well as named exports. The dashboard injector imports this module
// for its side effect and reads window.__dripCompressor — robust against the bundler mangling
// entry export names (Vite minifies entry signatures, so the named export isn't reliable).
if (typeof window !== 'undefined') {
  window.__dripCompressor = { maybeCompressForWhatsApp, isCompressionSupported, needsTranscode, VIDEO_TARGET_BYTES };
}

// (maybeCompressForWhatsApp is already exported via its declaration above)
export { isCompressionSupported, needsTranscode, VIDEO_TARGET_BYTES };
