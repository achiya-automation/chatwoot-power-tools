/*
 * waMedia — מגבלות מדיה של WhatsApp (מראָה לצד-הלקוח של engine/src/media.js).
 * משמש לוולידציה מיידית לפני העלאה (חוויה), והשרת מאמת שוב (אבטחה).
 */
const MB = 1024 * 1024;

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

// ולידציה: { ok:true } או { ok:false, error }
export function validateWhatsAppMedia({ format, mime, byteSize } = {}) {
  const spec = WA_MEDIA[String(format || '').toUpperCase()];
  if (!spec) return { ok: false, error: 'סוג מדיה לא נתמך בכותרת התבנית' };
  const size = Number(byteSize) || 0;
  if (size <= 0) return { ok: false, error: 'הקובץ ריק' };
  if (!spec.mimes.includes(cleanMime(mime))) {
    return { ok: false, error: `פורמט לא נתמך ל${spec.label} — נדרש ${spec.mimes.map((m) => m.split('/')[1]).join(' / ')}` };
  }
  if (size > spec.maxBytes) {
    return { ok: false, error: `הקובץ גדול מדי ל${spec.label} (מקסימום ${formatBytes(spec.maxBytes)})` };
  }
  return { ok: true };
}
