import { useMemo } from 'react';

/*
 * MessageBubble — בועת הודעה נכנסת בסגנון WhatsApp. מציגה את גוף התבנית
 * כשכל {{N}} מוחלף בערך שהוזן (או בצ'יפ placeholder לשדה מערכת / דוגמה).
 * משותף לעורך (StepCard) ולתצוגת הרצף המלאה (SequencePreview).
 */

const SYSTEM_FIELD_PREVIEW = {
  '@first_name': '[שם פרטי]',
  '@name': '[שם הלקוח]',
  '@phone': '[טלפון]',
  '@email': '[אימייל]',
};

function isSystemField(v) {
  return v === '@first_name' || v === '@name' || v === '@phone' || v === '@email';
}

// מפצל את גוף התבנית ל-segments: טקסט רגיל וצ'יפים של משתנים (לפי האינדקס)
function buildSegments(body, params, examples) {
  const out = [];
  let last = 0;
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: body.slice(last, m.index) });
    const idx = Number(m[1]) - 1;
    const filled = params[idx];
    if (isSystemField(filled)) {
      out.push({ type: 'chip', value: SYSTEM_FIELD_PREVIEW[filled] });
    } else if (filled != null && String(filled).trim() !== '') {
      out.push({ type: 'text', value: String(filled) });
    } else {
      const ex = examples[idx];
      out.push({
        type: 'chip',
        value: ex != null && String(ex) !== '' ? String(ex) : `משתנה ${idx + 1}`,
      });
    }
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ type: 'text', value: body.slice(last) });
  return out;
}

const MEDIA_HDR = { IMAGE: 'תמונה', VIDEO: 'וידאו', DOCUMENT: 'מסמך' };
const MEDIA_ICON = { IMAGE: '📷', VIDEO: '🎬', DOCUMENT: '📄' };
function headerMediaFmt(template) {
  const f = String(template?.header_format || '').toUpperCase();
  return MEDIA_HDR[f] ? f : null;
}

export default function MessageBubble({ template, params = [], mediaUrl = '', className = '' }) {
  const body = String(template?.body || '');
  const examples = Array.isArray(template?.examples) ? template.examples : [];
  const buttons = Array.isArray(template?.buttons) ? template.buttons : [];

  const segments = useMemo(
    () => buildSegments(body, params, examples),
    [body, params, examples]
  );

  return (
    <div
      className={`max-w-sm rounded-lg bg-n-teal-3 px-3 py-2 text-sm text-n-slate-12 shadow-sm ${className}`}
    >
      {/* header מדיה — תצוגה מקדימה של התמונה אם יש URL, אחרת חיווי */}
      {headerMediaFmt(template) ? (
        headerMediaFmt(template) === 'IMAGE' && mediaUrl ? (
          <img
            src={mediaUrl}
            alt=""
            className="mb-2 max-h-44 w-full rounded-md object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div className="mb-2 flex items-center gap-1.5 rounded-md bg-n-alpha-2 px-2 py-3 text-xs text-n-slate-11">
            <span aria-hidden="true">{MEDIA_ICON[headerMediaFmt(template)]}</span>
            {MEDIA_HDR[headerMediaFmt(template)]} בכותרת
            {mediaUrl ? '' : ' (קישור יוגדר בשלב)'}
          </div>
        )
      ) : null}

      {template?.header_text ? (
        <p className="font-semibold mb-1 whitespace-pre-wrap">{template.header_text}</p>
      ) : null}

      <p className="whitespace-pre-wrap leading-relaxed">
        {segments.map((seg, i) =>
          seg.type === 'chip' ? (
            <span
              key={i}
              className="inline-flex items-center rounded bg-n-amber-3 px-1 text-n-amber-11"
            >
              {seg.value}
            </span>
          ) : (
            <span key={i}>{seg.value}</span>
          )
        )}
      </p>

      {template?.footer_text ? (
        <p className="mt-1.5 text-xs text-n-slate-10 whitespace-pre-wrap">
          {template.footer_text}
        </p>
      ) : null}

      {buttons.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1 border-t border-n-weak pt-2">
          {buttons.map((b, i) => (
            <span
              key={i}
              className="block rounded-md bg-n-alpha-2 px-2 py-1 text-center text-xs font-medium text-n-blue-11"
            >
              {typeof b === 'string' ? b : b?.text || b?.label || '—'}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
