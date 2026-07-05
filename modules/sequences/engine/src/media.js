/**
 * media.js — WhatsApp media rules (pure, testable). Used by the upload endpoint (server-side
 * gate) and mirrored on the client for instant feedback.
 *
 * Limits are Meta's WhatsApp Cloud API template-header media limits:
 *   IMAGE    JPEG/PNG               ≤ 5 MB
 *   VIDEO    MP4/3GPP (H.264+AAC)   ≤ 16 MB
 *   DOCUMENT PDF/Office/TXT         ≤ 100 MB
 * A file that violates these is rejected before upload — otherwise the send fails silently.
 */

const MB = 1024 * 1024;

export const WA_MEDIA = {
  IMAGE: {
    label: 'תמונה',
    maxBytes: 5 * MB,
    mimes: ['image/jpeg', 'image/png'],
  },
  VIDEO: {
    label: 'וידאו',
    maxBytes: 16 * MB,
    mimes: ['video/mp4', 'video/3gpp'],
  },
  DOCUMENT: {
    label: 'מסמך',
    maxBytes: 100 * MB,
    mimes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
    ],
  },
};

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
};

// normalize a mime: strip parameters (";charset=…") and lowercase
function cleanMime(mime) {
  return String(mime || '').toLowerCase().split(';')[0].trim();
}

export function extForMime(mime) {
  return MIME_EXT[cleanMime(mime)] || 'bin';
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < MB) return `${(b / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  if (b < 1024 * MB) return `${(b / MB).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${(b / (1024 * MB)).toFixed(2).replace(/\.0+$/, '')} GB`;
}

// bilingual media-type labels for validation errors (default he keeps existing tests green)
const MEDIA_LABEL = {
  he: { IMAGE: 'תמונה', VIDEO: 'וידאו', DOCUMENT: 'מסמך' },
  en: { IMAGE: 'Image', VIDEO: 'Video', DOCUMENT: 'Document' },
};

/**
 * Validate a file against the WhatsApp limits for a given template header format.
 * The error message is returned in `locale` (he | en) so the webapp shows it in the
 * user's language. Defaults to 'he' — callers/tests that omit it get the original text.
 * @param {{format:string, mime:string, byteSize:number}} input
 * @param {'he'|'en'} [locale]
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function validateWhatsAppMedia({ format, mime, byteSize } = {}, locale = 'he') {
  const en = locale === 'en';
  const fmt = String(format || '').toUpperCase();
  const spec = WA_MEDIA[fmt];
  if (!spec) return { ok: false, error: en ? 'Unsupported media type in the template header' : 'סוג מדיה לא נתמך בכותרת התבנית' };
  const size = Number(byteSize) || 0;
  if (size <= 0) return { ok: false, error: en ? 'The file is empty' : 'הקובץ ריק' };
  const label = MEDIA_LABEL[en ? 'en' : 'he'][fmt] || spec.label;
  if (!spec.mimes.includes(cleanMime(mime))) {
    const types = spec.mimes.map((m) => m.split('/')[1]).join(' / ');
    return { ok: false, error: en ? `Unsupported format for ${label} — requires ${types}` : `פורמט לא נתמך ל${label} — נדרש ${types}` };
  }
  if (size > spec.maxBytes) {
    return { ok: false, error: en ? `File too large for ${label} (max ${formatBytes(spec.maxBytes)})` : `הקובץ גדול מדי ל${label} (מקסימום ${formatBytes(spec.maxBytes)})` };
  }
  return { ok: true };
}
