/**
 * headerMedia.js — pure mapping "template header → what the preview should actually render".
 * No React, no DOM: plain functions, trivial to unit test.
 *
 * A media header reaches the UI carrying one of three very different sources:
 *   • approved template from Meta — deserializeTemplate copies example.header_handle[0]
 *     into header.mediaHandle, and that one IS a real scontent URL that loads straight
 *     into <img>/<video>. It carries an `oe=` expiry, so a failed load is expected and
 *     the caller must fall back to the placeholder rather than show a broken image.
 *   • fresh Template Studio upload — Meta returns an opaque handle ("4::aW1hZ2Uv…") that
 *     no browser can fetch; only the local blob: URL of the picked File is renderable.
 *   • sequence / journey step — an engine-served https URL (uploadMedia).
 *
 * Hence the single rule: anything that is not an http(s)/blob/data URL is a handle, not a
 * picture — the caller gets the kind but no url, and shows its own placeholder.
 */

const MEDIA_KINDS = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);
const LOADABLE = /^(?:https?:|blob:|data:)/i;

export function isLoadableMedia(src) {
  return LOADABLE.test(String(src == null ? '' : src).trim());
}

// headerMedia('IMAGE', blobUrl, mediaHandle) → { kind: 'IMAGE', url: blobUrl }
// Sources are tried in order and the first loadable one wins, so a caller can put the
// local object URL ahead of the stored handle. kind is '' for a header that carries no
// media at all (NONE / TEXT / LOCATION) — that is how callers skip the block entirely.
export function headerMedia(format, ...sources) {
  const kind = String(format || '').trim().toUpperCase();
  if (!MEDIA_KINDS.has(kind)) return { kind: '', url: '' };
  const url = sources.find(isLoadableMedia);
  return { kind, url: url ? String(url).trim() : '' };
}

// Filename for a DOCUMENT header — WhatsApp shows a file chip, never an embedded viewer.
// "https://cdn/x/invoice_2026.pdf?oe=6A9C" → "invoice_2026.pdf"; an extension-less URL
// returns '' so the caller can fall back to the generic "document" label.
export function mediaFileName(url) {
  const path = String(url || '').split(/[?#]/)[0];
  const last = path.split('/').filter(Boolean).pop() || '';
  if (!/\.[a-z0-9]{2,5}$/i.test(last)) return '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last; // ‎%‎ בודד בשם הקובץ מפיל את decodeURIComponent — עדיף השם הגולמי מכלום
  }
}
