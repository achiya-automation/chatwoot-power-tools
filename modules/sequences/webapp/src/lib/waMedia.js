/*
 * waMedia — מגבלות מדיה של WhatsApp (מראָה לצד-הלקוח של engine/src/media.js).
 * משמש לוולידציה מיידית לפני העלאה (חוויה), והשרת מאמת שוב (אבטחה).
 * i18n: הודעות הוולידציה דו-לשוניות (he/en) לפי השפה הנוכחית — מוצגות ב-UI.
 */
import { getLocale } from '../i18n.js';

const MB = 1024 * 1024;

// תווית סוג המדיה לפי שפה (לשגיאות ולידציה)
const MEDIA_LABEL = {
  he: { IMAGE: 'תמונה', VIDEO: 'וידאו', DOCUMENT: 'מסמך' },
  en: { IMAGE: 'Image', VIDEO: 'Video', DOCUMENT: 'Document' },
};

export const WA_MEDIA = {
  IMAGE: { label: 'תמונה', maxBytes: 5 * MB, mimes: ['image/jpeg', 'image/png'] },
  VIDEO: { label: 'וידאו', maxBytes: 16 * MB, mimes: ['video/mp4', 'video/3gpp'] },
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

function cleanMime(mime) {
  return String(mime || '').toLowerCase().split(';')[0].trim();
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < MB) return `${(b / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  if (b < 1024 * MB) return `${(b / MB).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${(b / (1024 * MB)).toFixed(2).replace(/\.0+$/, '')} GB`;
}

// מחזיר ערך ל-<input accept=> לפי פורמט הכותרת (מסנן את בורר הקבצים)
export function acceptFor(format) {
  return (WA_MEDIA[String(format || '').toUpperCase()]?.mimes || []).join(',');
}

// ולידציה: { ok:true } או { ok:false, error } — השגיאה בשפת המשתמש הנוכחית
export function validateWhatsAppMedia({ format, mime, byteSize } = {}) {
  const en = getLocale() === 'en';
  const fmt = String(format || '').toUpperCase();
  const spec = WA_MEDIA[fmt];
  if (!spec) return { ok: false, error: en ? 'Unsupported media type in the template header' : 'סוג מדיה לא נתמך בכותרת התבנית' };
  const size = Number(byteSize) || 0;
  if (size <= 0) return { ok: false, error: en ? 'The file is empty' : 'הקובץ ריק' };
  const label = MEDIA_LABEL[en ? 'en' : 'he'][fmt] || fmt;
  if (!spec.mimes.includes(cleanMime(mime))) {
    const types = spec.mimes.map((m) => m.split('/')[1]).join(' / ');
    return { ok: false, error: en ? `Unsupported format for ${label} — requires ${types}` : `פורמט לא נתמך ל${label} — נדרש ${types}` };
  }
  if (size > spec.maxBytes) {
    return { ok: false, error: en ? `File too large for ${label} (max ${formatBytes(spec.maxBytes)})` : `הקובץ גדול מדי ל${label} (מקסימום ${formatBytes(spec.maxBytes)})` };
  }
  return { ok: true };
}
