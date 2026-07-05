import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';
import useT from '../../useT.js';

/*
 * ChatBubble — בועת הודעת WhatsApp יוצאת, תואמת 1:1 למראה של Chatwoot.
 * מציגה את ההודעה *המלאה* כפי שהלקוח יקבל אותה: כותרת-מדיה, כותרת טקסט,
 * גוף (עם שבירת שורות אמיתית), footer וכפתורים — ולמטה meta של זמן + טיקים.
 *
 * שימוש כפול:
 *   • נשלח  → text = התוכן שנשלח בפועל, meta.status = delivered/failed/pending.
 *   • תצוגה מקדימה → text = הגוף עם השם של הלקוח מוטמע, meta.status = scheduled.
 *
 * props:
 *   text      — גוף ההודעה (כבר מורכב, עם השם של הלקוח)
 *   template  — אובייקט התבנית (header_format/header_text/footer_text/buttons)
 *   mediaUrl  — קישור מדיה לכותרת (IMAGE מוצג כתמונה)
 *   meta      — { time, status } — status: delivered|failed|pending|scheduled
 */

// מילון co-located (he/en)
const M = {
  he: {
    mediaImage: 'תמונה',
    mediaVideo: 'וידאו',
    mediaDocument: 'מסמך',
    inHeader: 'בכותרת',
    linkWillBeSet: '(קישור יוגדר בשלב)',
    notDelivered: 'לא נמסר',
  },
  en: {
    mediaImage: 'Image',
    mediaVideo: 'Video',
    mediaDocument: 'Document',
    inHeader: 'in header',
    linkWillBeSet: '(link will be set in the step)',
    notDelivered: 'Not delivered',
  },
};

const MEDIA_HDR = { IMAGE: 'mediaImage', VIDEO: 'mediaVideo', DOCUMENT: 'mediaDocument' };
const MEDIA_ICON = { IMAGE: '📷', VIDEO: '🎬', DOCUMENT: '📄' };

function mediaFormat(template) {
  const f = String(template?.header_format || '').toUpperCase();
  return MEDIA_HDR[f] ? f : null;
}

// meta תחתון בסגנון WhatsApp: זמן + חיווי מסירה (טיקים)
function MetaRow({ time, status, ltr = true }) {
  const t = useT(M);
  if (!time && !status) return null;
  const map = {
    delivered: { Icon: CheckCheck, cls: 'text-n-teal-11', label: '' },
    pending: { Icon: Check, cls: 'text-n-slate-10', label: '' },
    failed: { Icon: AlertCircle, cls: 'text-n-ruby-11', label: t('notDelivered') },
    scheduled: { Icon: Clock, cls: 'text-n-slate-9', label: '' },
  };
  const m = map[status] || map.pending;
  return (
    <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${m.cls}`}>
      {m.label ? <span className="font-medium">{m.label}</span> : null}
      {time ? <span dir={ltr ? 'ltr' : 'rtl'} className="tabular-nums">{time}</span> : null}
      <m.Icon size={13} className="shrink-0" aria-hidden="true" />
    </div>
  );
}

export default function ChatBubble({ text = '', template = null, mediaUrl = '', meta = null, className = '' }) {
  const t = useT(M);
  const fmt = mediaFormat(template);
  const buttons = Array.isArray(template?.buttons) ? template.buttons : [];

  return (
    <div
      className={`relative w-fit max-w-[min(20rem,100%)] rounded-2xl rounded-ss-md border border-n-teal-5/50 bg-n-teal-3 px-3.5 py-2.5 text-n-slate-12 shadow-sm ${className}`}
    >
      {/* כותרת מדיה — תמונה אמיתית אם יש URL, אחרת חיווי סוג המדיה */}
      {fmt ? (
        fmt === 'IMAGE' && mediaUrl ? (
          <img
            src={mediaUrl}
            alt=""
            className="mb-2 max-h-44 w-full rounded-lg object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-n-alpha-2 px-2.5 py-3 text-xs text-n-slate-11">
            <span aria-hidden="true">{MEDIA_ICON[fmt]}</span>
            {t(MEDIA_HDR[fmt])} {t('inHeader')}{mediaUrl ? '' : ` ${t('linkWillBeSet')}`}
          </div>
        )
      ) : null}

      {template?.header_text ? (
        <p className="mb-1 whitespace-pre-wrap font-semibold leading-snug">{template.header_text}</p>
      ) : null}

      <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{text}</p>

      {template?.footer_text ? (
        <p className="mt-2 whitespace-pre-wrap text-[11px] leading-snug text-n-slate-10">{template.footer_text}</p>
      ) : null}

      {buttons.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1 border-t border-n-teal-6/40 pt-2">
          {buttons.map((b, i) => (
            <span
              key={i}
              className="block rounded-lg bg-n-alpha-1 px-2 py-1.5 text-center text-xs font-medium text-n-blue-11"
            >
              {typeof b === 'string' ? b : b?.text || b?.label || '—'}
            </span>
          ))}
        </div>
      ) : null}

      <MetaRow time={meta?.time} status={meta?.status} ltr={meta?.ltr !== false} />
    </div>
  );
}
