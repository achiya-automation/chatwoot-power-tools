import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, AlertCircle, ChevronDown, Download, MessageSquare, Coins, Printer, ExternalLink, Filter, Radio, RotateCcw, FlaskConical } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import ResendDialog from './ResendDialog.jsx';
import Skeleton from './ui/Skeleton.jsx';
import { useToast } from './ui/Toast.jsx';
import { Table, THead, TBody, TR, TH, TD } from './ui/Table.jsx';
import {
  getCampaignDetail, getCampaignsTier, resendCampaignFailed, getCampaignResendStatus,
  getCampaignExperiments, scheduleCampaignResend, getPendingResend, cancelCampaignResend,
} from '../api/sequencesApi.js';
import { API_BASE } from '../config.js';
import { estimateCost } from '../lib/campaignCost.js';
import { buildRows, countRows, filterRows, failureGroups, STATUS_KEYS } from '../lib/campaignRows.js';
import { deliveryErrorLabel } from '../lib/deliveryError.js';
import { readCache, writeCache } from '../lib/swr.js';
import useT, { useLocale } from '../useT.js';
import { translate } from '../i18n.js';

// מילון co-located (he/en) — כל הטקסטים הגלויים של תצוגת פרטי הקמפיין (רמה 2).
const M = {
  he: { back: 'חזרה', audience: 'קהל יעד', attempted: 'נוסו לשליחה', sent: 'נשלחו בהצלחה', delivered: 'נמסרו', read: 'נקראו', failed: 'נכשלו',
        funnel: 'משפך מסירה', replied: 'הגיבו', replyRate: 'שיעור תגובה', costTitle: 'עלות משוערת',
        costNote: 'אומדן: תעריף Meta לישראל ($ להודעה), ללא חלון שירות חינם/הנחות נפח · עודכן',
        costUnknown: 'לתבנית אין קטגוריה מסונכרנת — אין אומדן עלות',
        readNote: 'אחוז הקריאה תלוי באישורי קריאה אצל הנמענים — נמענים שכיבו אותם לא נספרים',
        recipients: 'נמענים', notSent: 'לא נוסו לשליחה', snapshotNote: 'לפי תמונת הקהל שנשמרה בזמן הקמפיין', currentLabelNote: 'לפי החברות בתווית כרגע — לקמפיין הישן אין תמונת קהל שמורה',
        name: 'שם', phone: 'טלפון', status: 'סטטוס', attempts: 'ניסיונות', when: 'זמן', reason: 'סיבה', conversation: 'קישור לשיחה', noAttempt: 'לא נוצר ניסיון שליחה',
        export: 'ייצוא CSV', print: 'הדפסה / PDF', printedAt: 'הופק', openConv: 'פתיחת השיחה ב-Chatwoot',
        noReplyText: '(מדיה או הודעה ללא טקסט)', errLoad: 'שגיאה בטעינת הקמפיין', notFound: 'הקמפיין לא נמצא', retry: 'ניסיון חוזר',
        s_sent: 'נשלח — ממתין למסירה', s_delivered: 'נמסר', s_read: 'נקרא', s_failed: 'נכשל', s_pending: 'ממתין', s_notsent: 'לא נוסה לשליחה',
        // ── סינון + עמודות תגובה ──
        filter: 'סינון', clearFilter: 'ניקוי סינון', outOf: 'מתוך', noMatch: 'אין נמענים שתואמים לסינון',
        exportAll: 'הכל', exportCurrent: 'לפי הסינון הנוכחי', exportWhat: 'מה להוריד?',
        reply: 'תגובה', col_replied: 'הגיב', yes: 'כן', no: 'לא', replyText: 'תוכן התגובה', replyWhen: 'זמן התגובה',
        f_read: 'נקראו', f_delivered: 'נמסרו · טרם נקראו', f_sent: 'נשלחו · טרם נמסרו', f_pending: 'ממתינים', f_failed: 'נכשלו', f_notsent: 'לא נוסו',
        f_replied: 'הגיבו', f_noreply: 'לא הגיבו',
        exactNote: 'הסטטוס בטבלה הוא המצב הסופי של כל נמען, ולכן הקטגוריות אינן חופפות (סכומן = קהל היעד) — בשונה מהמשפך למעלה',
        // ── פירוק כשלים + שליחה מחדש ──
        breakdownTitle: 'כשלים לפי סיבה', breakdownHint: 'לחיצה על סיבה מסננת את הטבלה',
        resend: 'שליחה מחדש לנכשלים',
        resendRunning: 'שולח מחדש…', resendDoneMsg: 'שליחה מחדש הסתיימה: {ok} נשלחו, {bad} נכשלו',
        resendStarted: 'השליחה מחדש התחילה', adminOnly: 'שליחה מחדש דורשת הרשאת מנהל בחשבון',
        // ── סיכום אחרי ריצה + תזמון ──
        resendDoneTitle: 'השליחה מחדש הסתיימה', resendOk: 'יצאו בהצלחה', resendBad: 'נכשלו שוב',
        resendAgain: 'ניסיון נוסף לנכשלים', resendDismiss: 'סגירה',
        resendWhy: 'הסיבות לכישלון החוזר', resendMore: 'ועוד {n}',
        resendNote: 'הסטטוס הסופי (נמסר/נקרא) ממשיך להתעדכן מהוואטסאפ בדקות הבאות — הטבלה למטה תשקף אותו.',
        scheduledFor: '⏱️ שליחה מחדש מתוזמנת ל-{when}', scheduledTpl: 'בתבנית {name}',
        cancelSchedule: 'ביטול התזמון', scheduleSaved: 'התזמון נשמר ל-{when}', scheduleCancelled: 'התזמון בוטל',
        live: 'קמפיין רץ — הדוח מתעדכן אוטומטית',
        skippedNote: 'נמענים שלא נוסו (חסר טלפון/תבנית) אינם חלק מהשליחה מחדש — אין לאן לשלוח',
        // ── תוצאות לפי ניסוי ──
        expTitle: 'תוצאות לפי ניסוי', expHint: 'כל שליחה מחדש נמדדת בנפרד — אותם נמענים, תבנית אחרת',
        expOriginal: 'השליחה המקורית', expRound: 'ניסוי {n}', expTemplate: 'תבנית', expWhen: 'מתי',
        expAttempted: 'יצאו', expDelivered: 'נמסרו', expRead: 'נקראו', expFailed: 'נכשלו', expReplied: 'הגיבו',
        expNote: 'אותו נמען יכול להופיע ביותר מניסוי אחד, ולכן סכום השורות גדול מקהל היעד. "הגיבו" נזקף לניסוי שאחריו הגיעה התגובה.' },
  en: { back: 'Back', audience: 'Target audience', attempted: 'Attempted', sent: 'Sent successfully', delivered: 'Delivered', read: 'Read', failed: 'Failed',
        funnel: 'Delivery funnel', replied: 'Replied', replyRate: 'Reply rate', costTitle: 'Estimated cost',
        costNote: 'Estimate: Meta IL rate ($/msg), excl. free service window / volume discounts · updated',
        costUnknown: 'The template has no synced category — no cost estimate',
        readNote: "Read rate depends on recipients' read receipts — recipients who disabled them are not counted",
        recipients: 'Recipients', notSent: 'Not attempted', snapshotNote: 'from the audience snapshot captured at campaign time', currentLabelNote: 'from current label membership — this legacy campaign has no saved audience snapshot',
        name: 'Name', phone: 'Phone', status: 'Status', attempts: 'Attempts', when: 'Time', reason: 'Reason', conversation: 'Conversation link', noAttempt: 'No send attempt was created',
        export: 'Export CSV', print: 'Print / PDF', printedAt: 'Generated', openConv: 'Open the conversation in Chatwoot',
        noReplyText: '(media or empty message)', errLoad: 'Failed to load campaign', notFound: 'Campaign not found', retry: 'Retry',
        s_sent: 'Sent — awaiting delivery', s_delivered: 'Delivered', s_read: 'Read', s_failed: 'Failed', s_pending: 'Pending', s_notsent: 'Not attempted',
        filter: 'Filter', clearFilter: 'Clear filter', outOf: 'of', noMatch: 'No recipients match the filter',
        exportAll: 'All', exportCurrent: 'Current filter', exportWhat: 'What to download?',
        reply: 'Reply', col_replied: 'Replied', yes: 'Yes', no: 'No', replyText: 'Reply text', replyWhen: 'Reply time',
        f_read: 'Read', f_delivered: 'Delivered · not read yet', f_sent: 'Sent · not delivered yet', f_pending: 'Pending', f_failed: 'Failed', f_notsent: 'Not attempted',
        f_replied: 'Replied', f_noreply: 'No reply',
        exactNote: 'The table status is each recipient’s final state, so the categories do not overlap (they sum to the audience) — unlike the funnel above',
        breakdownTitle: 'Failures by reason', breakdownHint: 'Click a reason to filter the table',
        resend: 'Resend to failed',
        resendRunning: 'Resending…', resendDoneMsg: 'Resend finished: {ok} sent, {bad} failed',
        resendStarted: 'The resend has started', adminOnly: 'Resending requires an administrator role',
        resendDoneTitle: 'The resend has finished', resendOk: 'went out', resendBad: 'failed again',
        resendAgain: 'Try the failed ones again', resendDismiss: 'Dismiss',
        resendWhy: 'Why they failed again', resendMore: 'and {n} more',
        resendNote: 'Final status (delivered/read) keeps updating from WhatsApp over the next minutes — the table below will reflect it.',
        scheduledFor: '⏱️ A resend is scheduled for {when}', scheduledTpl: 'using {name}',
        cancelSchedule: 'Cancel the schedule', scheduleSaved: 'Scheduled for {when}', scheduleCancelled: 'Schedule cancelled',
        live: 'Campaign running — the report auto-refreshes',
        skippedNote: 'Recipients that were never attempted (no phone/template) are not part of the resend — there is nowhere to send',
        expTitle: 'Results per experiment', expHint: 'Every resend is measured on its own — same recipients, different template',
        expOriginal: 'Original send', expRound: 'Experiment {n}', expTemplate: 'Template', expWhen: 'When',
        expAttempted: 'Went out', expDelivered: 'Delivered', expRead: 'Read', expFailed: 'Failed', expReplied: 'Replied',
        expNote: 'The same recipient can appear in more than one experiment, so the rows sum to more than the audience. A reply is credited to the experiment it followed.' },
};
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
// מועד תזמון לתצוגה בשעון המקומי של הדפדפן (השרת שומר UTC).
const fmtWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
};
// גוון הבאדג' לכל מצב סופי בטבלה (ראו lib/campaignRows.js).
const STATUS_COLOR = { read: 'blue', delivered: 'teal', sent: 'slate', pending: 'slate', failed: 'ruby', notsent: 'amber' };

// error_title הוא או מחרוזת גולמית של Meta ("131049: This message was not delivered…"),
// שממנה מחלצים את הקוד המספרי, או מפתח סיבה מילולי מה-ledger ("no_phone") כשהשליחה
// נעצרה אצלנו. שניהם ממופים דרך אותה טבלה ב-deliveryError.js (משותפת עם הרצפים).
const errorLabel = (raw) => {
  if (!raw) return '';
  const text = String(raw);
  const code = (/^(\d+)/.exec(text) || [])[1] || text;
  return deliveryErrorLabel(code, text);
};

/*
 * ExportMenu — כפתור "ייצוא CSV" שנפתח לתפריט חתכים. כל פריט הוא <a href> רגיל אל
 * נקודת הקצה בשרת — בלי blob, בלי download attribute, בלי JS בזמן הלחיצה: הניווט
 * עצמו מוריד את הקובץ (attachment), ולכן עובד גם ב-Safari בתוך iframe.
 */
function ExportMenu({ options, label, heading }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="faded" color="slate" size="sm" icon={Download} trailingIcon={ChevronDown}
        aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </Button>
      {open ? (
        <div role="menu" className="absolute end-0 top-full z-20 mt-1 w-56 rounded-xl border border-n-weak bg-n-surface-1 p-1 shadow-lg">
          <p className="px-2.5 pb-1 pt-1.5 text-xs text-n-slate-10">{heading}</p>
          {options.map((o) => (
            <a
              key={o.key}
              role="menuitem"
              href={o.href}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm text-n-slate-12 no-underline hover:bg-n-alpha-2"
            >
              <span>{o.label}</span>
              <span className="text-xs text-n-slate-10">{o.count}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* צ'יפ סינון דו-מצבי — אותו דפוס טבעות של כרטיסי הסינון ב-EnrollmentsView. */
function FilterChip({ active, onClick, label, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
        active ? 'bg-n-brand/10 text-n-blue-11 ring-1 ring-n-brand' : 'bg-n-alpha-2 text-n-slate-11 ring-1 ring-transparent hover:bg-n-alpha-3'
      }`}
    >
      {label} <span className="font-semibold">{count}</span>
    </button>
  );
}

/*
 * CampaignDetailView — רמה 2 (קמפיין בודד): משפך מסירה, engagement + עלות, וטבלת נמענים
 * מאוחדת (מי שנוסה + מי שלא נוסה כלל) עם סינון דו-צירי — סטטוס מסירה × תגובה — שחל גם על
 * הטבלה, גם על ההדפסה וגם על ייצוא ה-CSV. נטען דרך CampaignsView.onSelect(campaignId).
 */
export default function CampaignDetailView({ campaignId, accountId, onBack }) {
  const t = useT(M);
  const locale = useLocale();
  const { toast } = useToast();
  const cacheKey = `campaign:${accountId}:${campaignId}`;
  // stale-while-revalidate: מצטייר מיד מהעותק האחרון, מתרענן ברקע. null = אין עדיין כלום.
  const [d, setD] = useState(() => readCache(cacheKey));
  const [error, setError] = useState('');
  // סינון הטבלה והייצוא — שני צירים בלתי-תלויים, כל אחד קבוצת מפתחות. ריקה = בלי סינון.
  const [statusSel, setStatusSel] = useState(() => new Set());
  const [replySel, setReplySel] = useState(() => new Set());
  // שליחה מחדש: tier לאזהרת תקציב, מודאל אישור, ומצב העבודה הרצה (null = אין).
  const [tier, setTier] = useState(null);
  const [resendOpen, setResendOpen] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendJob, setResendJob] = useState(null);
  // תוצאות פר-ניסוי (השליחה המקורית + כל שליחה מחדש). [] = נטען ואין מה להציג.
  const [experiments, setExperiments] = useState([]);
  // תזמון ממתין ({ run_at, template_name }) — נטען מהשרת, שורד רענון דף.
  const [pending, setPending] = useState(null);
  const alive = useRef(true);
  // איפוס בגוף האפקט ולא רק ב-cleanup — אחרת ה-double-mount של StrictMode משאיר את
  // הדגל false לתמיד והתשובות של ה-fetch נזרקות (skeleton נצחי בפיתוח).
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    if (accountId == null || campaignId == null) return;
    setError('');
    getCampaignDetail(campaignId, accountId)
      .then((data) => {
        if (!alive.current) return;
        // קמפיין שלא נמצא → מסמן במקום להשאיר skeleton נצחי; לא נשמר ב-cache.
        if (!data) { setD({ missing: true }); return; }
        setD(data); writeCache(cacheKey, data);
        // תקציב 24h של המספר שהקמפיין שולח ממנו (לא ניחוש ברמת חשבון) — לאזהרה
        // שבמודאל. נכשל בשקט: בלי נתון המודאל פשוט לא מזהיר.
        getCampaignsTier(accountId, data.campaign?.inbox_id)
          .then((x) => { if (alive.current) setTier(x); }).catch(() => {});
      })
      .catch((e) => { if (alive.current) setError(e.message || translate(M, 'errLoad')); });
    // תוצאות הניסויים; נכשל בשקט — הכרטיס פשוט לא יוצג.
    getCampaignExperiments(campaignId, accountId)
      .then((x) => { if (alive.current) setExperiments(x); })
      .catch(() => {});
    getPendingResend(campaignId, accountId)
      .then((x) => { if (alive.current) setPending(x); })
      .catch(() => {});
  }, [campaignId, accountId, cacheKey]);
  useEffect(() => { load(); }, [load]);

  // קמפיין בעיבוד → רענון מהיר; יש עוד הודעות "בדרך" (pending) → רענון רגוע. נעצר כשהטאב מוסתר.
  const pollMs = d?.campaign?.campaign_status === 2 ? 8_000 : (d?.funnel?.pending > 0 ? 30_000 : 0);
  useEffect(() => {
    if (!pollMs) return undefined;
    const timer = setInterval(() => { if (!document.hidden) load(); }, pollMs);
    return () => clearInterval(timer);
  }, [pollMs, load]);

  // עבודת שליחה-מחדש שרצה (גם אם התחילה בטאב אחר) — נצמדים אליה ומתשאלים עד סיום.
  useEffect(() => {
    if (accountId == null || campaignId == null) return;
    getCampaignResendStatus(campaignId, accountId)
      .then((s) => { if (alive.current && s && s.status === 'running') setResendJob(s); })
      .catch(() => {});
  }, [campaignId, accountId]);
  useEffect(() => {
    if (resendJob?.status !== 'running') return undefined;
    const timer = setInterval(async () => {
      try {
        const s = await getCampaignResendStatus(campaignId, accountId);
        if (!alive.current) return;
        if (!s) { setResendJob(null); return; }
        setResendJob(s);
        if (s.status === 'done') {
          toast({
            message: translate(M, 'resendDoneMsg', { ok: s.sent, bad: s.failed.length }),
            variant: s.failed.length ? undefined : 'success',
          });
          load(); // הדוח משקף מיד את הניסיונות החדשים
        }
      } catch { /* מתשאלים שוב בטיק הבא */ }
    }, 1500);
    return () => clearInterval(timer);
  }, [resendJob?.status, campaignId, accountId, load, toast]);

  // template = null → תבנית הקמפיין המקורית; אחרת { name, language, params, mediaUrl }.
  // runAt = null → שליחה מיידית; אחרת ISO — נכנס לתור בשרת ומורץ שם בשעה שנקבעה.
  const startResend = async (template, runAt) => {
    setResendBusy(true);
    try {
      if (runAt) {
        await scheduleCampaignResend(campaignId, accountId, runAt, locale, template);
        setResendOpen(false);
        setPending({ run_at: runAt, template_name: template?.name || campaign.template_name });
        toast({ message: translate(M, 'scheduleSaved', { when: fmtWhen(runAt) }), variant: 'success' });
        return;
      }
      const { total, template_name } = await resendCampaignFailed(campaignId, accountId, locale, template);
      setResendOpen(false);
      setResendJob({ status: 'running', total, done: 0, sent: 0, failed: [], template_name });
      toast({ message: translate(M, 'resendStarted'), variant: 'success' });
    } catch (e) {
      setResendOpen(false);
      toast({ message: e.forbidden ? translate(M, 'adminOnly') : e.message, variant: 'error' });
    } finally {
      setResendBusy(false);
    }
  };

  const unschedule = async () => {
    try {
      await cancelCampaignResend(campaignId, accountId);
      setPending(null);
      toast({ message: translate(M, 'scheduleCancelled'), variant: 'success' });
    } catch (e) {
      toast({ message: e.forbidden ? translate(M, 'adminOnly') : e.message, variant: 'error' });
    }
  };

  // ── שורות, ספירות וסינון (כל ה-hooks לפני ה-return המוקדמים של טעינה/שגיאה) ──
  const rows = useMemo(() => buildRows(d || {}), [d]);
  const counts = useMemo(() => countRows(rows), [rows]);
  const failGroups = useMemo(() => failureGroups(rows), [rows]);
  // שני צ'יפים דלוקים בציר התגובה = כמו אף אחד: אין סינון.
  const replyMode = replySel.size === 1 ? (replySel.has('replied') ? 'yes' : 'no') : 'all';
  const visible = useMemo(
    () => filterRows(rows, { statuses: statusSel, reply: replyMode }),
    [rows, statusSel, replyMode]
  );

  // חץ "חזרה" — כיוון ויזואלי לפי שפה (עברית RTL: חזרה = ימינה).
  const BackIcon = locale === 'he' ? ArrowRight : ArrowLeft;

  const toggle = (set, update, key) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    update(next);
  };
  const clearFilters = () => { setStatusSel(new Set()); setReplySel(new Set()); };
  const filtered = statusSel.size > 0 || replyMode !== 'all';

  // ניווט לשיחה ב-Chatwoot: בתוך iframe (ה-overlay של עמוד הקמפיינים) — postMessage להורה,
  // שסוגר את ה-overlay ומנווט; standalone — טאב חדש. same-origin בלבד.
  const openConversation = (displayId) => {
    if (!Number.isInteger(displayId)) return;
    if (window.parent !== window) {
      try { window.parent.postMessage({ type: 'drip-open-conversation', display_id: displayId }, window.location.origin); return; } catch { /* fallthrough */ }
    }
    window.open(`/app/accounts/${accountId}/conversations/${displayId}`, '_blank', 'noopener');
  };

  // skeleton רק בכניסה הראשונה אי-פעם; אחרי זה תמיד יש עותק מיידי ורענון שקט ברקע.
  if (d == null && !error) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (d == null && error) return (
    <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{error}</span>
      <Button variant="faded" color="slate" size="sm" className="ms-auto shrink-0" onClick={load}>{t('retry')}</Button>
    </div>
  );
  if (d.missing) return <div className="py-16 text-center text-sm text-n-slate-11">{t('notFound')}</div>;

  const { campaign, funnel, engagement, not_sent, audience_source } = d;
  // Meta charges for delivered template messages; failed/pending attempts must not inflate cost.
  const cost = estimateCost({ category: campaign.category, sent: funnel.delivered });

  // כתובת הורדת CSV בשרת (Content-Disposition: attachment) — הורדה בניווט רגיל, עובדת
  // גם מתוך ה-iframe של ה-overlay ב-Chatwoot שבו Safari חוסם הורדות blob בשקט.
  // extra: { statuses?: [..], reply?: 'yes'|'no' } — אותו סינון כמו הטבלה, בצד השרת.
  const csvHref = (extra = {}) => {
    const p = new URLSearchParams({ account_id: accountId, campaign_id: campaign.id, locale });
    if (extra.statuses?.length) p.set('statuses', extra.statuses.join(','));
    if (extra.reply) p.set('reply', extra.reply);
    return `${API_BASE}/campaign-csv?${p}`;
  };
  // אפשרויות ההורדה: הסינון הנוכחי (כשפעיל), הכל, ואז החתכים העסקיים שביקש הלקוח —
  // הגיבו / לא הגיבו / נכשלו / לא נוסו. חתך ריק לא מוצג (אין מה להוריד).
  const exportOptions = [
    filtered && { key: 'current', label: t('exportCurrent'), count: visible.length,
      href: csvHref({ statuses: [...statusSel], reply: replyMode === 'all' ? undefined : replyMode }) },
    { key: 'all', label: t('exportAll'), count: rows.length, href: csvHref() },
    { key: 'replied', label: t('f_replied'), count: counts.replied, href: csvHref({ reply: 'yes' }) },
    { key: 'noreply', label: t('f_noreply'), count: counts.noreply, href: csvHref({ reply: 'no' }) },
    { key: 'failed', label: t('f_failed'), count: counts.failed, href: csvHref({ statuses: ['failed'] }) },
    { key: 'notsent', label: t('f_notsent'), count: counts.notsent, href: csvHref({ statuses: ['notsent'] }) },
  ].filter((o) => o && (o.key === 'all' || o.key === 'current' || o.count > 0));

  const FUNNEL = [
    { label: t('audience'), value: funnel.audience, text: 'text-n-slate-12' },
    { label: t('attempted'), value: funnel.attempted, text: 'text-n-slate-12' },
    { label: t('sent'), value: funnel.sent, text: 'text-n-slate-12' },
    { label: t('delivered'), value: funnel.delivered, sub: `${pct(funnel.delivered, funnel.sent)}%`, text: 'text-n-teal-11' },
    { label: t('read'), value: funnel.read, sub: `${pct(funnel.read, funnel.sent)}%`, text: 'text-n-blue-11' },
    { label: t('failed'), value: funnel.failed, sub: `${pct(funnel.failed, funnel.attempted)}%`, text: 'text-n-ruby-11' },
  ];

  return (
    <>
      <div className="no-print mb-4 flex items-center justify-between">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-n-slate-11 hover:text-n-slate-12">
          <BackIcon size={15} aria-hidden="true" />{t('back')}
        </button>
        <div className="flex items-center gap-2">
          <Button variant="faded" color="slate" size="sm" icon={Printer} onClick={() => window.print()}>{t('print')}</Button>
          <ExportMenu options={exportOptions} label={t('export')} heading={t('exportWhat')} />
        </div>
      </div>

      <div className="mb-4">
        <h1 className="text-lg font-semibold text-n-slate-12">{campaign.title}</h1>
        {/* חותמת להדפסה בלבד — דוח שנשלח ללקוח נושא תאריך הפקה */}
        <p className="print-only text-xs text-n-slate-10">{t('printedAt')}: {new Date().toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB')} · {campaign.created_at || ''}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {campaign.template_name ? <Badge color="slate">{campaign.template_name}</Badge> : null}
          {campaign.category ? <Badge color="blue">{campaign.category}</Badge> : null}
          {campaign.campaign_status === 2 ? (
            <span className="inline-flex items-center gap-1 text-xs text-n-teal-11" title={t('live')}>
              <Radio size={13} className="animate-pulse" aria-hidden="true" />{t('live')}
            </span>
          ) : null}
        </div>
        {campaign.message ? (
          <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg bg-n-alpha-1 px-3 py-2 text-sm text-n-slate-11">{campaign.message}</p>
        ) : null}
      </div>

      {/* funnel — דפוס DeliveryMetric מ-OverviewView (grid + ערך גדול + תת-אחוז) */}
      <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
        <h2 className="mb-3 text-sm font-medium text-n-slate-12">{t('funnel')}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {FUNNEL.map((m) => (
            <div key={m.label} className="flex flex-col items-start rounded-lg bg-n-alpha-1 px-3 py-2 ring-1 ring-n-weak">
              <span className={`text-xl font-semibold leading-none ${m.text}`}>{m.value}</span>
              <span className="mt-1 text-xs text-n-slate-11">{m.label}{m.sub ? ` · ${m.sub}` : ''}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-n-slate-10">{t('readNote')}</p>
      </div>

      {/* engagement + cost — שני כרטיסים */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-n-slate-12"><MessageSquare size={15} className="text-n-blue-11" aria-hidden="true" />{t('replied')}</h2>
          <div className="flex items-baseline gap-2"><span className="text-2xl font-semibold text-n-slate-12">{engagement.replied}</span><span className="text-xs text-n-slate-11">{t('replyRate')}: {engagement.reply_rate}%</span></div>
          {/* התגובות עצמן — לידים: מי ענה + במה פתח; לחיצה פותחת את השיחה ב-Chatwoot */}
          {engagement.replies && engagement.replies.length > 0 ? (
            <ul className="mt-3 flex max-h-44 list-none flex-col gap-1 overflow-y-auto p-0">
              {engagement.replies.map((r, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => openConversation(r.conversation_display_id)}
                    title={t('openConv')}
                    className="group flex w-full items-baseline gap-2 rounded-lg px-2 py-1 text-start hover:bg-n-alpha-2"
                  >
                    <span className="shrink-0 text-xs font-medium text-n-slate-12">{r.contact_name || '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-n-slate-11">{r.content || t('noReplyText')}</span>
                    <span className="shrink-0 text-xxs text-n-slate-10">{r.replied_at}</span>
                    <ExternalLink size={11} className="no-print shrink-0 text-n-slate-10 opacity-0 group-hover:opacity-100" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-n-slate-12"><Coins size={15} className="text-n-blue-11" aria-hidden="true" />{t('costTitle')}</h2>
          {/* קמפיין ללא קטגוריה מסונכרנת → אין תעריף; $0 היה מטעה — מציגים מקף והסבר */}
          <div className="flex items-baseline gap-1"><span className="text-2xl font-semibold text-n-slate-12">{cost.perMessage > 0 ? `$${cost.total}` : '—'}</span></div>
          <p className="mt-1 text-xs text-n-slate-10">{cost.perMessage > 0 ? `${t('costNote')} ${cost.updated}` : t('costUnknown')}</p>
        </div>
      </div>

      {/* כשלים לפי סיבה + שליחה מחדש — מוצג כשיש מה לתקן, וגם כשאין: סיכום ריצה שהסתיימה
          ותזמון ממתין חייבים להישאר גלויים גם אחרי ששליחה מחדש ניקתה את כל הכשלים.
          לחיצה על סיבה מסננת את הטבלה; הכפתור שולח מחדש למי שנשאר במצב סופי "נכשל". */}
      {failGroups.length > 0 || resendJob || pending ? (
        <div className="no-print mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
              <AlertCircle size={15} className="text-n-ruby-11" aria-hidden="true" />{t('breakdownTitle')}
              {failGroups.length > 0 ? <span className="text-xs font-normal text-n-slate-10">· {t('breakdownHint')}</span> : null}
            </h2>
            {/* בזמן ריצה יש פס התקדמות, ואחרי ריצה הכפתור יושב בתוך הסיכום — כאן רק
                כשאין ריצה בכלל, אחרת מוצגים שני כפתורים שעושים אותו דבר. */}
            {counts.failed > 0 && !resendJob ? (
              <Button variant="solid" color="blue" size="sm" icon={RotateCcw} onClick={() => setResendOpen(true)}>
                {t('resend')} ({counts.failed})
              </Button>
            ) : null}
          </div>

          {/* תזמון ממתין — שורד רענון דף (הוא יושב בשרת), עם ביטול במקום */}
          {pending ? (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-n-blue-3 px-3 py-2 text-xs text-n-blue-11">
              <span>{translate(M, 'scheduledFor', { when: fmtWhen(pending.run_at) })}</span>
              {pending.template_name ? <span className="text-n-slate-11">· {translate(M, 'scheduledTpl', { name: pending.template_name })}</span> : null}
              <button type="button" onClick={unschedule} className="ms-auto rounded-md px-2 py-0.5 text-n-slate-11 hover:bg-n-alpha-2 hover:text-n-ruby-11">
                {t('cancelSchedule')}
              </button>
            </div>
          ) : null}
          {/* הסתיימה — סיכום שנשאר על המסך: כמה יצאו, כמה נכשלו שוב ולמה, ומיד
              אפשרות לנסות שוב (הכפתור מחשב את הנכשלים העדכניים) או לתזמן. */}
          {resendJob?.status === 'done' ? (
            <div className="mb-3 rounded-lg border border-n-weak bg-n-alpha-1 px-3 py-2.5" role="status">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-n-slate-12">{t('resendDoneTitle')}</span>
                <span className="text-sm text-n-teal-11"><span className="font-semibold tabular-nums">{resendJob.sent}</span> {t('resendOk')}</span>
                {resendJob.failed.length ? (
                  <span className="text-sm text-n-ruby-11"><span className="font-semibold tabular-nums">{resendJob.failed.length}</span> {t('resendBad')}</span>
                ) : null}
                <div className="ms-auto flex items-center gap-2">
                  {counts.failed > 0 ? (
                    <Button variant="solid" color="blue" size="sm" icon={RotateCcw} onClick={() => setResendOpen(true)}>
                      {t('resendAgain')} ({counts.failed})
                    </Button>
                  ) : null}
                  <button type="button" onClick={() => setResendJob(null)} className="rounded-md px-2 py-1 text-xs text-n-slate-11 hover:bg-n-alpha-2">
                    {t('resendDismiss')}
                  </button>
                </div>
              </div>
              {/* למה נכשלו שוב — מקובץ לפי סיבה, לא רשימת 1,000 שורות */}
              {resendJob.failed.length ? (
                <div className="mt-2 flex flex-col gap-0.5">
                  {Object.entries(resendJob.failed.reduce((acc, f) => {
                    const k = f.error || '—';
                    acc[k] = (acc[k] || 0) + 1;
                    return acc;
                  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([reason, n]) => (
                    <p key={reason} className="m-0 flex items-baseline gap-2 text-xs text-n-slate-11">
                      <span className="shrink-0 font-semibold tabular-nums text-n-ruby-11">{n}</span>
                      <span className="min-w-0 truncate" title={reason}>{reason}</span>
                    </p>
                  ))}
                </div>
              ) : null}
              <p className="mb-0 mt-2 text-xs text-n-slate-10">{t('resendNote')}</p>
            </div>
          ) : null}

          {/* עבודת שליחה-מחדש רצה — פס התקדמות חי במקום הכפתור */}
          {resendJob?.status === 'running' ? (
            <div className="mb-3 flex items-center gap-3" role="status">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-n-alpha-3">
                <span className="block h-full rounded-full bg-n-blue-9 transition-all duration-500" style={{ width: `${resendJob.total ? Math.round((resendJob.done / resendJob.total) * 100) : 0}%` }} />
              </span>
              <span className="shrink-0 text-xs tabular-nums text-n-slate-11">
                {resendJob.template_name ? <span className="text-n-slate-12">{resendJob.template_name} · </span> : null}
                {t('resendRunning')} {resendJob.done}/{resendJob.total}
                {resendJob.failed.length ? <span className="text-n-ruby-11"> · {resendJob.failed.length}</span> : null}
              </span>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            {failGroups.map((g) => {
              const share = Math.round((g.count / Math.max(1, failGroups.reduce((s, x) => s + x.count, 0))) * 100);
              return (
                <button
                  key={`${g.statusKey}|${g.error_title}`}
                  type="button"
                  onClick={() => setStatusSel(new Set([g.statusKey]))}
                  title={g.error_title}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1 text-start hover:bg-n-alpha-2"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${g.statusKey === 'notsent' ? 'bg-n-amber-9' : 'bg-n-ruby-9'}`} aria-hidden="true" />
                  <span className={`min-w-0 flex-1 truncate text-xs ${g.statusKey === 'notsent' ? 'text-n-amber-11' : 'text-n-ruby-11'}`}>
                    {errorLabel(g.error_title) || t(`s_${g.statusKey}`)}
                  </span>
                  {/* חלקה של הסיבה מכלל הכשלים — אותו דפוס bar-list של כרטיס ההשוואה */}
                  <span className="h-2 w-28 shrink-0 rounded-full bg-n-alpha-3 sm:w-40" aria-hidden="true">
                    <span className={`block h-2 rounded-full ${g.statusKey === 'notsent' ? 'bg-n-amber-9' : 'bg-n-ruby-9'}`} style={{ width: `${share}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-end text-xs font-semibold tabular-nums text-n-slate-12">{g.count}</span>
                </button>
              );
            })}
          </div>
          {failGroups.some((g) => g.statusKey === 'notsent') ? (
            <p className="mb-0 mt-2 text-xs text-n-slate-10">{t('skippedNote')}</p>
          ) : null}
        </div>
      ) : null}

      {/* תוצאות לפי ניסוי — מוצג רק אחרי שנעשתה לפחות שליחה מחדש אחת, אחרת אין מה
          להשוות והשורה היחידה כבר מסוכמת במשפך למעלה. */}
      {experiments.length > 1 ? (
        <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-3 flex flex-wrap items-center gap-1.5 text-sm font-medium text-n-slate-12">
            <FlaskConical size={15} className="text-n-blue-11" aria-hidden="true" />{t('expTitle')}
            <span className="text-xs font-normal text-n-slate-10">· {t('expHint')}</span>
          </h2>
          <Table>
            <THead>
              <TR>
                <TH>{t('expTemplate')}</TH><TH>{t('expAttempted')}</TH><TH>{t('expDelivered')}</TH>
                <TH>{t('expRead')}</TH><TH>{t('expFailed')}</TH><TH>{t('expReplied')}</TH><TH>{t('expWhen')}</TH>
              </TR>
            </THead>
            <TBody>
              {experiments.map((e, i) => (
                <TR key={e.run_id || 'original'}>
                  <TD>
                    <span className="block text-xs text-n-slate-10">
                      {e.run_id ? translate(M, 'expRound', { n: i }) : t('expOriginal')}
                    </span>
                    {/* שורות ledger שקדמו לתיעוד התבנית פר-שליחה נופלות לתבנית של הקמפיין */}
                    <span className="text-n-slate-12">{e.template_name || campaign.template_name || '—'}</span>
                  </TD>
                  <TD><span className="tabular-nums text-n-slate-12">{e.attempted}</span></TD>
                  <TD><span className="tabular-nums text-n-teal-11">{e.delivered}<span className="text-n-slate-10"> · {pct(e.delivered, e.attempted)}%</span></span></TD>
                  <TD><span className="tabular-nums text-n-blue-11">{e.read}<span className="text-n-slate-10"> · {pct(e.read, e.attempted)}%</span></span></TD>
                  <TD><span className="tabular-nums text-n-ruby-11">{e.failed}<span className="text-n-slate-10"> · {pct(e.failed, e.attempted)}%</span></span></TD>
                  <TD><span className="tabular-nums text-n-slate-12">{e.replied}<span className="text-n-slate-10"> · {pct(e.replied, e.attempted)}%</span></span></TD>
                  <TD><span className="text-xs text-n-slate-11">{e.started_at}</span></TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="mb-0 mt-2 text-xs text-n-slate-10">{t('expNote')}</p>
        </div>
      ) : null}

      {/* נמענים — כותרת + סרגל סינון. הטבלה מאחדת את מי שנוסה עם מי שלא נוסה כלל,
          כדי שסינון אחד יכסה את כל קהל היעד (ולא רק חלק ממנו). */}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-sm font-medium text-n-slate-12">{t('recipients')} ({visible.length}{filtered ? ` ${t('outOf')} ${rows.length}` : ''})</h2>
        {not_sent && not_sent.length > 0 ? (
          <span className="text-xs text-n-slate-10">· {t(audience_source === 'snapshot' ? 'snapshotNote' : 'currentLabelNote')}</span>
        ) : null}
      </div>

      <div className="no-print mb-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-n-alpha-1 px-2.5 py-2 ring-1 ring-n-weak">
        <span className="flex items-center gap-1.5 pe-1 text-xs text-n-slate-11"><Filter size={13} aria-hidden="true" />{t('filter')}</span>
        {STATUS_KEYS.filter((key) => counts[key] > 0).map((key) => (
          <FilterChip
            key={key}
            active={statusSel.has(key)}
            onClick={() => toggle(statusSel, setStatusSel, key)}
            label={t(`f_${key}`)}
            count={counts[key]}
          />
        ))}
        {counts.replied > 0 || counts.noreply > 0 ? (
          <span className="mx-1 h-4 w-px bg-n-slate-6" aria-hidden="true" />
        ) : null}
        {['replied', 'noreply'].filter((key) => counts[key] > 0).map((key) => (
          <FilterChip
            key={key}
            active={replySel.has(key)}
            onClick={() => toggle(replySel, setReplySel, key)}
            label={t(`f_${key}`)}
            count={counts[key]}
          />
        ))}
        {filtered ? (
          <button type="button" onClick={clearFilters} className="ms-auto rounded-lg px-2 py-1 text-xs text-n-slate-11 hover:bg-n-alpha-2 hover:text-n-slate-12">
            {t('clearFilter')}
          </button>
        ) : null}
      </div>

      <Table>
        <THead><TR><TH>{t('name')}</TH><TH>{t('phone')}</TH><TH>{t('status')}</TH><TH>{t('reply')}</TH><TH>{t('attempts')}</TH><TH>{t('when')}</TH></TR></THead>
        <TBody>
          {visible.map((r, i) => (
            <TR
              key={i}
              className={r.conversation_display_id ? 'cursor-pointer' : ''}
              onClick={r.conversation_display_id ? () => openConversation(r.conversation_display_id) : undefined}
              tabIndex={r.conversation_display_id ? 0 : undefined}
              role={r.conversation_display_id ? 'button' : undefined}
              aria-label={r.conversation_display_id ? `${r.contact_name || r.phone || ''} — ${t('openConv')}` : undefined}
              onKeyDown={r.conversation_display_id ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openConversation(r.conversation_display_id); } } : undefined}
            >
              <TD><span className="text-n-slate-12">{r.contact_name || '—'}</span></TD>
              <TD><span className="font-mono text-xs">{r.phone || '—'}</span></TD>
              <TD><Badge color={STATUS_COLOR[r.statusKey] || 'slate'}>{t(`s_${r.statusKey}`)}</Badge>
                {/* ההסבר המתורגם מוצג; המחרוזת הגולמית של Meta נשמרת ב-title לרחיפה (תמיכה/דיבוג) */}
                {r.error_title ? <span title={r.error_title} className={`mt-0.5 block text-xs ${r.statusKey === 'notsent' ? 'text-n-amber-11' : 'text-n-ruby-11'}`}>{errorLabel(r.error_title)}</span> : null}</TD>
              <TD>{r.replied
                ? <span title={r.reply_content || undefined} className="block max-w-[16rem] truncate text-xs text-n-teal-11">{r.reply_content || t('yes')}</span>
                : <span className="text-xs text-n-slate-10">—</span>}</TD>
              <TD><span className="text-xs text-n-slate-11">{r.attempts || '—'}</span></TD>
              <TD><span className="text-xs text-n-slate-11">{r.sent_at || '—'}</span></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-n-slate-11">{t('noMatch')}</p>
      ) : null}
      <p className="mt-2 text-xs text-n-slate-10">{t('exactNote')}</p>

      {/* אישור שליחה מחדש — פעולת outbound אמיתית: מספרים בדיוק מה יקרה, מאפשרים
          לבחור תבנית אחרת לניסוי, ומזהירים כשהתקציב היומי של Meta לא מספיק לכולם. */}
      <ResendDialog
        open={resendOpen}
        onClose={() => setResendOpen(false)}
        onConfirm={startResend}
        campaign={campaign}
        failedCount={counts.failed}
        tier={tier}
        loading={resendBusy}
        accountId={accountId}
      />
    </>
  );
}
