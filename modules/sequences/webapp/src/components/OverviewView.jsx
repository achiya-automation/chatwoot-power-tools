import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertCircle, Layers, BarChart3, HardDrive, Send, Ban, Clock, TrendingUp, Target } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Skeleton, { SkeletonCard, SkeletonText } from './ui/Skeleton.jsx';
import { listEnrollments, listSequences, getStorageUsage, getDeliveryStats } from '../api/sequencesApi.js';
import { summarizeEnrollments } from '../lib/summarize.js';
import { formatBytes } from '../lib/waMedia.js';
import useT from '../useT.js';
import { translate } from '../i18n.js';

// מילון co-located (he/en) — כל הטקסטים הגלויים של תצוגת הסקירה.
const M = {
  he: {
    tcTotal: 'סה״כ משויכים',
    tcActive: 'פעילים',
    tcFailed: 'נתקעו',
    tcCompleted: 'הושלמו',
    tcStopped: 'נעצרו',
    errLoad: 'שגיאה בטעינת הסקירה',
    perSequenceTitle: 'פילוח לפי סדרה',
    refresh: 'רענון',
    emptyBody: 'אין עדיין סדרות או אנשי קשר משויכים.',
    storageTitle: 'אחסון החשבון',
    storageChatwoot: 'Chatwoot (קבצי שיחות): ',
    storageDrip: 'מדיה שהועלתה לרצפים: ',
    filesCount: '({count} קבצים)',
    deliveryTitle: 'פעילות שליחה — היום',
    retryWaiting: 'ממתינים לניסיון חוזר',
    mSent: 'נשלחו',
    mDelivered: 'נמסרו',
    mRead: 'נקראו',
    mBlocked: 'נחסמו',
    reasonCap: 'תקרת שיווק',
    reasonInvalid: 'מספר לא תקין',
    reasonOptout: 'ביטלו הסכמה',
    reasonOther: 'אחר',
    blockReasons: 'סיבות חסימה:',
    blockedMessages: 'הודעות שנחסמו:',
    trend7: 'מגמת 7 ימים',
    steps: 'שלבים',
    active: 'פעיל',
    off: 'כבוי',
    // משפך המסירה — "נקראו" הוא תת-קבוצה של "הגיעו", לא קטגוריה לצידו
    arrived: 'הגיעו',
    ofSent: 'מהנשלחות',
    ofArrived: 'מאלה שהגיעו',
    waiting: 'ממתינות',
    waitingHint: 'מטא עוד לא אישרה',
    arrivalRate: 'שיעור הגעה',
    successRate: 'לא נחסמו',
    ofDecided: 'ממה שהוכרע',
    notCounted: 'מטא עוד לא אישרה · לא נספרות באחוז',
    srcNew: 'לידים חדשים',
    srcNewHint: 'ההודעה הראשונה בחייהם',
    srcSeq: 'המשך הרצף',
    srcSeqHint: 'כבר קיבלו מאיתנו',
    blockedOf: 'נחסמו',
    noneBlocked: 'אף אחד לא נחסם',
    sendError: 'שגיאת שליחה',
    sendErrorHint: 'בעיה בתבנית · לתקן',
    sendErrTitle: 'שגיאות שליחה (לתקן):',
    errTemplate: 'פרמטרים בתבנית',
    errMedia: 'מדיה',
    errOther: 'אחר',
    failedMessages: 'הודעות שנכשלו:',
    todayOutcome: 'תוצאות היום',
    nothingToday: 'עוד לא נשלחו הודעות היום',
    // מי מהרשימה עוד ניתן להשגה
    reachTitle: 'למי עוד אפשר להגיע',
    reachClean: 'מטא מעולם לא חסמה',
    reachCapped: 'נחסמו {n} פעמים או פחות',
    reachRefused: 'המנוע מפסיק לפנות',
    reachCleanHint: 'סיכוי מסירה גבוה',
    reachCappedHint: 'עדיין נשלחות, סיכוי נמוך',
    reachRefusedHint: 'מעל {n} חסימות — לא נשלחות',
    leads: 'לידים',
    // מתגי הרצף — שניים נפרדים, לא "כבוי" אחד
    sending: 'שולח',
    notSending: 'לא שולח',
    enrolling: 'קולט לידים',
    notEnrolling: 'לא קולט',
    enrolled: 'משויכים',
    activeCount: 'פעילים',
    stuckCount: 'נתקעו',
    completedCount: 'הושלמו',
    stoppedCount: 'נעצרו',
    completionRate: 'שיעור השלמה',
  },
  en: {
    tcTotal: 'Total enrolled',
    tcActive: 'Active',
    tcFailed: 'Stuck',
    tcCompleted: 'Completed',
    tcStopped: 'Stopped',
    errLoad: 'Failed to load overview',
    perSequenceTitle: 'Breakdown by sequence',
    refresh: 'Refresh',
    emptyBody: 'No sequences or enrolled contacts yet.',
    storageTitle: 'Account storage',
    storageChatwoot: 'Chatwoot (conversation files): ',
    storageDrip: 'Media uploaded to sequences: ',
    filesCount: '({count} files)',
    deliveryTitle: 'Sending activity — today',
    retryWaiting: 'waiting for retry',
    mSent: 'Sent',
    mDelivered: 'Delivered',
    mRead: 'Read',
    mBlocked: 'Blocked',
    reasonCap: 'Marketing cap',
    reasonInvalid: 'Invalid number',
    reasonOptout: 'Opted out',
    reasonOther: 'Other',
    blockReasons: 'Block reasons:',
    blockedMessages: 'Blocked messages:',
    trend7: '7-day trend',
    steps: 'steps',
    active: 'Active',
    off: 'Off',
    arrived: 'Arrived',
    ofSent: 'of sent',
    ofArrived: 'of arrived',
    waiting: 'Awaiting',
    waitingHint: 'Meta has not confirmed yet',
    arrivalRate: 'Arrival rate',
    successRate: 'Not blocked',
    ofDecided: 'of decided',
    notCounted: 'Meta has not confirmed · not in the rate',
    srcNew: 'New leads',
    srcNewHint: 'first message of their life',
    srcSeq: 'Later in the sequence',
    srcSeqHint: 'already heard from us',
    blockedOf: 'blocked',
    noneBlocked: 'none blocked',
    sendError: 'send error',
    sendErrorHint: 'template issue · fix it',
    sendErrTitle: 'Send errors (to fix):',
    errTemplate: 'template parameters',
    errMedia: 'media',
    errOther: 'other',
    failedMessages: 'Failed messages:',
    todayOutcome: "Today's outcome",
    nothingToday: 'No messages sent today yet',
    reachTitle: 'Who is still reachable',
    reachClean: 'Never capped by Meta',
    reachCapped: 'Capped {n} times or fewer',
    reachRefused: 'Engine stops contacting',
    reachCleanHint: 'High delivery odds',
    reachCappedHint: 'Still sent, low odds',
    reachRefusedHint: 'Over {n} caps — not sent',
    leads: 'leads',
    sending: 'Sending',
    notSending: 'Not sending',
    enrolling: 'Enrolling',
    notEnrolling: 'Not enrolling',
    enrolled: 'enrolled',
    activeCount: 'active',
    stuckCount: 'stuck',
    completedCount: 'completed',
    stoppedCount: 'stopped',
    completionRate: 'Completion rate',
  },
};

/*
 * OverviewView — תמונת-על: סה"כ + פילוח מלא לפי סדרה.
 * מאגד צד-לקוח מ-listEnrollments + listSequences (בלי backend נוסף).
 */

const TOTAL_CARDS = [
  { key: 'total', label: 'tcTotal', text: 'text-n-blue-11' },
  { key: 'active', label: 'tcActive', text: 'text-n-teal-11' },
  { key: 'failed', label: 'tcFailed', text: 'text-n-ruby-11' },
  { key: 'completed', label: 'tcCompleted', text: 'text-n-blue-11' },
  { key: 'stopped', label: 'tcStopped', text: 'text-n-slate-12' },
];

export default function OverviewView({ accountId }) {
  const t = useT(M);
  const [enrollments, setEnrollments] = useState([]);
  const [sequences, setSequences] = useState([]);
  const [storage, setStorage] = useState(null);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (accountId == null) return;
    setLoading(true);
    setError('');
    Promise.all([
      listEnrollments(accountId),
      listSequences(accountId),
      getStorageUsage(accountId).catch(() => null), // אחסון — לא קריטי, לא שובר את הסקירה
      getDeliveryStats(accountId).catch(() => null), // פעילות שליחה — לא קריטי, לא שובר את הסקירה
    ])
      .then(([en, sq, st, ds]) => {
        setEnrollments(en);
        setSequences(sq);
        setStorage(st);
        setStats(ds);
      })
      .catch((e) => setError(e.message || translate(M, 'errLoad')))
      .finally(() => setLoading(false));
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const { totals, perSequence } = useMemo(
    () => summarizeEnrollments(enrollments, sequences),
    [enrollments, sequences]
  );

  if (loading) {
    return (
      <>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <Skeleton className="mb-3 h-5 w-32" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
              <SkeletonText lines={4} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <>
      {/* סה"כ — כרטיס שערכו תמיד 0 הוא רעש: הוא תופס מקום בשורה הראשונה, גורם לעין
          לסרוק חמישה מספרים, ואומר "אין כאן כלום". מוצגים רק אלה שיש בהם משהו. */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {TOTAL_CARDS.filter((c) => c.key === 'total' || c.key === 'active' || totals[c.key] > 0).map((c) => (
          <div key={c.key} className="flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 ring-1 ring-n-weak">
            <span className={`text-2xl font-semibold leading-none ${c.text}`}>{totals[c.key]}</span>
            <span className="mt-1 text-xs text-n-slate-11">{t(c.label)}</span>
          </div>
        ))}
      </div>

      {/* פעילות שליחה — מה יצא היום, כמה הגיע ללקוחות וכמה נחסם */}
      {stats ? <DeliveryCard stats={stats} /> : null}

      {/* למי עוד אפשר להגיע — "פעילים" לבדו מסתיר את זה שרוב הרשימה חסומה אצל מטא */}
      {stats?.burn ? <ReachCard burn={stats.burn} /> : null}

      {/* אחסון החשבון — Chatwoot + מדיה שהועלתה, יחד */}
      {storage ? <StorageCard storage={storage} /> : null}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <BarChart3 size={15} className="text-n-blue-11" aria-hidden="true" />
          {t('perSequenceTitle')}
        </h2>
        <Button variant="ghost" color="slate" size="sm" icon={RefreshCw} onClick={load}>
          {t('refresh')}
        </Button>
      </div>

      {perSequence.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-16 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-brand/10 text-n-blue-11">
            <Layers size={24} aria-hidden="true" />
          </span>
          <p className="text-sm text-n-slate-11">{t('emptyBody')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {perSequence.map((s) => (
            <SequenceCard key={s.key} s={s} />
          ))}
        </div>
      )}
    </>
  );
}

function StorageCard({ storage }) {
  const t = useT(M);
  const total = Number(storage.total_bytes) || 0;
  const cw = Number(storage.chatwoot_bytes) || 0;
  const drip = Number(storage.drip_bytes) || 0;
  const count = Number(storage.drip_count) || 0;
  return (
    <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <HardDrive size={15} className="text-n-blue-11" aria-hidden="true" />
          {t('storageTitle')}
        </h2>
        <span className="text-xl font-semibold text-n-slate-12">{formatBytes(total)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-n-slate-11">
        <span className="inline-flex items-center gap-1.5">
          <Dot c="bg-n-blue-9" />{t('storageChatwoot')}<span className="font-medium text-n-slate-12">{formatBytes(cw)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Dot c="bg-n-teal-9" />{t('storageDrip')}<span className="font-medium text-n-slate-12">{formatBytes(drip)}</span>
          <span className="text-n-slate-10">{t('filesCount', { count })}</span>
        </span>
      </div>
    </div>
  );
}

function DeliveryCard({ stats }) {
  const tr = useT(M);
  const t = stats.today || {};
  const sent = Number(t.sent) || 0;

  // ⚠️ `delivered` שמגיע מהשרת כבר כולל את `read` (m.status IN (1,2)) — `read` הוא
  // תת-קבוצה שלו. הצגתם זה לצד זה כשתי קטגוריות שוות ייצרה שני שקרים על אותו מסך:
  //   • הסכום לא הסתדר — 49 נשלחו, אבל 31+14+1 הוצגו, ו-17 ה"ממתינות" נעלמו לגמרי;
  //   • שיעור הקריאה נראה כמו 29% מהנשלחות, בזמן שהוא 45% ממי שההודעה בכלל הגיעה אליה.
  // הפירוק כאן הוא היחיד שמסתכם: הגיעו + ממתינות + נחסמו = נשלחו.
  const arrived = Number(t.delivered) || 0;      // נמסרו + נקראו
  const read = Number(t.read) || 0;              // תת-קבוצה של arrived
  const blocked = Number(t.blocked) || 0;        // ⭐ חסימת מטא בלבד (הנמענת)
  const sendError = Number(t.send_error) || 0;   // ⭐ שגיאת שליחה שלנו (תבנית/מדיה)
  const waiting = Number(t.pending) || 0;

  const readOfArrived = arrived > 0 ? Math.round((read / arrived) * 100) : 0;

  // ⭐ המכנה הוא מה שהוכרע ע"י מטא, לא מה שנשלח.
  // "ממתינה" איננה כישלון (מטא עוד לא אישרה — 98% נפתרות תוך 6ש'), ו**שגיאת שליחה
  // שלנו איננה חסימה** (הבקשה הייתה שגויה, ההודעה מעולם לא יצאה — זה באג לתקן, לא
  // נמענת שרופה). שיעור "לא נחסמו" נמדד רק מול מה שמטא הכריעה: הגיע או חסמה.
  const decided = arrived + blocked;
  const successRate = decided > 0 ? Math.round((arrived / decided) * 100) : 0;

  // ארבע פרוסות: שתי דרגות "בסדר" (הגיע/ממתין) באותה משפחת teal, ואז שני מיני
  // כישלון נפרדים — שגיאת שליחה שלנו (כתום, "לתקן") וחסימת מטא (אדום, "הנמענת").
  // כל פרוסה עם תווית ישירה: כתום↔אדום בטריטנופיה קרובים, הצבע לבדו לא מספיק.
  const slices = [
    { key: 'arrived', label: tr('arrived'), value: arrived, cls: 'text-n-teal-9' },
    { key: 'waiting', label: tr('waiting'), value: waiting, cls: 'text-n-teal-8' },
    { key: 'sendError', label: tr('sendError'), value: sendError, cls: 'text-n-amber-9' },
    { key: 'blocked', label: tr('mBlocked'), value: blocked, cls: 'text-n-ruby-9' },
  ];

  const empty = { sent: 0, arrived: 0, blocked: 0, sendError: 0 };
  const bySrc = {
    newLead: stats.bySource?.newLead || empty,
    inSequence: stats.bySource?.inSequence || empty,
  };

  const reasons = [
    { label: tr('reasonCap'), n: t.block_cap || 0 },
    { label: tr('reasonInvalid'), n: t.block_invalid || 0 },
    { label: tr('reasonOptout'), n: t.block_optout || 0 },
  ].filter((r) => r.n > 0);
  // שגיאות שליחה שלנו — קטגוריה נפרדת מהחסימות, עם קריאה לפעולה ("לתקן")
  const sendErrors = [
    { label: tr('errTemplate'), n: t.err_template || 0 },
    { label: tr('errMedia'), n: t.err_media || 0 },
    { label: tr('errOther'), n: t.err_other || 0 },
  ].filter((r) => r.n > 0);
  const trend = stats.trend || [];

  return (
    <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <Send size={15} className="text-n-blue-11" aria-hidden="true" />
          {tr('deliveryTitle')}
        </h2>
        {stats.retryWaiting > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-n-alpha-3 px-2 py-0.5 text-xs text-n-slate-11">
            <Clock size={12} aria-hidden="true" />
            {stats.retryWaiting} {tr('retryWaiting')}
          </span>
        ) : null}
      </div>

      {sent === 0 ? (
        <p className="py-6 text-center text-sm text-n-slate-10">{tr('nothingToday')}</p>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          {/* מספר-גיבור אחד. חמישה מספרים בגודל שווה נלחמים על העין ואף אחד לא נקרא;
              כאן יש דבר אחד להסתכל עליו, והשאר הוא ההקשר שלו. */}
          <div className="flex items-center gap-4">
            <Donut slices={slices} centerValue={`${successRate}%`} centerLabel={tr('successRate')} />
            <div className="min-w-0 space-y-1.5 sm:w-52">
              <LegendRow cls="text-n-teal-9" label={tr('arrived')} value={String(arrived)} />
              <LegendRow cls="text-n-ruby-9" label={tr('mBlocked')} value={String(blocked)} />
              {sendError > 0 ? (
                <LegendRow cls="text-n-amber-9" label={tr('sendError')} hint={tr('sendErrorHint')}
                           value={String(sendError)} />
              ) : null}
              {waiting > 0 ? (
                <LegendRow cls="text-n-teal-8" label={tr('waiting')} hint={tr('notCounted')}
                           value={String(waiting)} />
              ) : null}
            </div>
          </div>

          {/* שורת ההקשר — משפט אחד במקום רשת מספרים. אחוז הקריאה נמדד מתוך מי שההודעה
              הגיעה אליה בכלל; מדידה מתוך "נשלחו" מענישה אותנו על חסימות של מטא. */}
          <div className="flex flex-1 flex-wrap items-baseline justify-center gap-x-5 gap-y-2 text-sm sm:justify-start">
            <span className="text-n-slate-11">
              {tr('mSent')} <b className="font-semibold text-n-slate-12">{sent}</b>
            </span>
            <span className="text-n-slate-11">
              {tr('mRead')} <b className="font-semibold text-n-blue-11">{read}</b>
              <span className="text-n-slate-10"> · {readOfArrived}% {tr('ofArrived')}</span>
            </span>
          </div>
        </div>
      )}

      {/* ⭐ מי נחסם: ליד חדש או מישהו שכבר ברצף.
          שתי בעיות שונות לגמרי, ומספר אחד מסתיר את שתיהן — ליד חדש שנחסם בהודעה
          הראשונה בחייו הגיע רווי מעסקים אחרים (בעיית מקור לידים), וחסימה בהמשך הרצף
          היא משהו שאנחנו עשינו. שורת אחוזים מספיקה: אין כאן צורך בגרף. */}
      {sent > 0 && (bySrc.newLead.sent > 0 || bySrc.inSequence.sent > 0) ? (
        <div className="mt-4 space-y-2 border-t border-n-weak pt-3">
          <SourceRow label={tr('srcNew')} hint={tr('srcNewHint')} src={bySrc.newLead} tr={tr} />
          <SourceRow label={tr('srcSeq')} hint={tr('srcSeqHint')} src={bySrc.inSequence} tr={tr} />
        </div>
      ) : null}

      {reasons.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-n-ruby-11">
            <Ban size={12} aria-hidden="true" />{tr('blockReasons')}
          </span>
          {reasons.map((r) => (
            <span key={r.label} className="text-n-slate-11">
              {r.label}: <span className="font-medium text-n-slate-12">{r.n}</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* ⚠️ שגיאות שליחה שלנו — נפרד מהחסימות, עם קריאה לפעולה. אלה לא נמענות שרופות
          אלא בקשות שגויות (פרמטר חסר בתבנית, מדיה שבורה) — משהו לתקן בקוד/בתבנית. */}
      {sendErrors.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-n-amber-11">
            <AlertCircle size={12} aria-hidden="true" />{tr('sendErrTitle')}
          </span>
          {sendErrors.map((r) => (
            <span key={r.label} className="text-n-slate-11">
              {r.label}: <span className="font-medium text-n-slate-12">{r.n}</span>
            </span>
          ))}
        </div>
      ) : null}

      {stats.byTemplate && stats.byTemplate.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-n-slate-11">
          <span className="text-n-slate-10">{tr('failedMessages')}</span>
          {stats.byTemplate.map((x) => (
            <span key={x.template} className="font-mono">
              {x.template}{' '}
              {/* אדום = חסימת מטא, כתום = שגיאה שלנו. שם התבנית עם המספר הדומיננטי. */}
              <span className={x.blocked >= x.send_error ? 'text-n-ruby-11' : 'text-n-amber-11'}>
                ({x.failed})
              </span>
            </span>
          ))}
        </div>
      ) : null}

      {trend.length > 0 ? <TrendChart trend={trend} tr={tr} /> : null}
    </div>
  );
}

/**
 * Donut — חלק-מתוך-שלם. הפרוסות חייבות להסתכם ב-100% של אותו שלם, אחרת הצורה משקרת.
 *
 * הצבע נטען דרך `stroke-current` על טוקן טקסט של Chatwoot, כך שמצב כהה מגיע חינם
 * מ-design system במקום שני סטים של hex מקודדים ביד. בין פרוסות יש מרווח של 2px
 * בצבע המשטח — בלעדיו שתי פרוסות סמוכות נקראות כפרוסה אחת.
 *
 * ⚠️ ה-ΔE של כתום↔אדום תחת טריטנופיה הוא 7.8 (בתוך רצפת 8-12), ולכן הצבע לבדו
 * אינו קביל: לכל פרוסה יש תווית ישירה במקרא. אל תסיר אותן.
 */
function Donut({ slices, size = 132, thickness = 17, centerValue, centerLabel }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const GAP = 2;
  let offset = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness}
          className="stroke-current text-n-alpha-2"
        />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {total > 0 && slices.filter((s) => s.value > 0).map((s) => {
            const len = (s.value / total) * circ;
            const dash = Math.max(1, len - GAP);
            const node = (
              <circle
                key={s.key} cx={size / 2} cy={size / 2} r={r}
                fill="none" strokeWidth={thickness} strokeLinecap="butt"
                className={`stroke-current ${s.cls}`}
                strokeDasharray={`${dash} ${circ - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${s.label}: ${s.value}`}</title>
              </circle>
            );
            offset += len;
            return node;
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold leading-none text-n-slate-12">{centerValue}</span>
        <span className="mt-1 text-[10px] text-n-slate-10">{centerLabel}</span>
      </div>
    </div>
  );
}

/**
 * SourceRow — שורה אחת: כמה נחסמו מקבוצה זו, ומה החלק שלה מתוך מה שהוכרע.
 *
 * מד (meter) ולא עוגה: זה יחס בודד מול תקרה, וזה בדיוק המקום שבו עוגה של שתי פרוסות
 * היא הצורה הלא נכונה. הפס הוא באורך אחוז החסימה — כך ששורה ארוכה יותר = בעיה גדולה
 * יותר, גם בלי לקרוא את המספר.
 */
function SourceRow({ label, hint, src, tr }) {
  const sent = Number(src.sent) || 0;
  const blocked = Number(src.blocked) || 0;        // חסימת מטא בלבד (ה-backend כבר סינן)
  const sendError = Number(src.sendError) || 0;    // שגיאת שליחה שלנו
  const arrived = Number(src.arrived) || 0;
  const decided = arrived + blocked;
  // אחוז החסימה נמדד מתוך מה שמטא הכריעה (הגיע או חסמה). ממתינות ושגיאות-שלנו
  // אינן חסימה ולא במכנה. ראה DeliveryCard.
  const pct = decided > 0 ? Math.round((blocked / decided) * 100) : 0;

  if (sent === 0) return null;   // קבוצה בלי שליחות היום — אין מה להראות, שורה ריקה היא רעש

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-n-slate-11">
          {label}<span className="text-n-slate-10"> · {hint}</span>
        </span>
        {/* לשון מפורשת: "נשלחו X · נחסמו Y". "נחסמו" = מטא בלבד; שגיאת שליחה שלנו
            מצוינת בנפרד בכתום, כדי לא להיקרא כחסימה של הנמענת. */}
        <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-n-slate-11">
          {tr('mSent')} <b className="font-semibold text-n-slate-12">{sent}</b>
          <span className="text-n-slate-10"> · </span>
          {blocked === 0 ? (
            <span className="text-n-teal-11">{tr('noneBlocked')}</span>
          ) : (
            <>
              {tr('blockedOf')} <b className="font-semibold text-n-ruby-11">{blocked}</b>
              <span className="text-n-slate-10"> · {pct}%</span>
            </>
          )}
          {sendError > 0 ? (
            <span className="text-n-amber-11"> · {sendError} {tr('sendError')}</span>
          ) : null}
        </span>
      </div>
      {/* מסילה: אחוז החסימה (מטא) באדום. קבוצה נקייה = מסילה ריקה. */}
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-n-alpha-2">
        <div className="h-full rounded-full bg-current text-n-ruby-9"
             style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** מקרא — הצבע לעולם לא לבד: נקודה + שם + ערך, בטקסט רגיל (לא בצבע הסדרה). */
function LegendRow({ cls, label, value, hint }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-current ${cls}`} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-n-slate-11">
        {label}
        {hint ? <span className="text-n-slate-10"> · {hint}</span> : null}
      </span>
      <span className="shrink-0 text-xs font-medium tabular-nums text-n-slate-12">{value}</span>
    </div>
  );
}

/**
 * ReachCard — כמה מהרשימה עוד ניתנת להשגה.
 *
 * "856 פעילים" הוא מספר מנחם וחסר-משמעות: התקרה האישית של מטא (131049) היא המשתנה
 * היחיד שמנבא מסירה — נמענת שמעולם לא נחסמה נמסרת ב-60-84%, ואחרי שנחסמה ב-7.9%.
 * שלוש הקבוצות כאן הן מצבים (טוב / אזהרה / קריטי), ולכן צבעי סטטוס ולא רמפה סדורה:
 * רמפת אדום הייתה צובעת גם את הנקיים באדום בהיר, ומשקרת עליהם.
 */
function ReachCard({ burn }) {
  const t = useT(M);
  const clean = Number(burn?.clean) || 0;
  const capped = Number(burn?.capped) || 0;
  const refused = Number(burn?.refused) || 0;
  const maxCap = Number(burn?.maxCap) || 4;
  const total = clean + capped + refused;
  if (total === 0) return null;

  const rows = [
    { key: 'clean', cls: 'text-n-teal-9', n: clean,
      label: t('reachClean'), hint: t('reachCleanHint') },
    { key: 'capped', cls: 'text-n-amber-9', n: capped,
      label: t('reachCapped').replace('{n}', String(maxCap - 1)), hint: t('reachCappedHint') },
    { key: 'refused', cls: 'text-n-ruby-9', n: refused,
      label: t('reachRefused'), hint: t('reachRefusedHint').replace('{n}', String(maxCap - 1)) },
  ];

  return (
    <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
        <Target size={15} className="text-n-blue-11" aria-hidden="true" />
        {t('reachTitle')}
      </h2>

      {/* עמודה מוערמת — part-to-whole על ציר אחד. 2px משטח בין מקטעים. */}
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img"
           aria-label={rows.map((r) => `${r.label}: ${r.n}`).join(', ')}>
        {rows.filter((r) => r.n > 0).map((r) => (
          <div key={r.key} className={`h-full bg-current ${r.cls}`}
               style={{ width: `${(r.n / total) * 100}%` }} title={`${r.label}: ${r.n}`} />
        ))}
      </div>

      <div className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <LegendRow key={r.key} cls={r.cls} label={r.label} hint={r.hint}
                     value={`${r.n} · ${Math.round((r.n / total) * 100)}%`} />
        ))}
      </div>
    </div>
  );
}

function SequenceCard({ s }) {
  const t = useT(M);
  return (
    <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-n-slate-12">{s.name}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-n-slate-10">{s.key}</p>
        </div>
        {/* ⚠️ שני מתגים נפרדים, ולא תג "פעיל/כבוי" אחד. `enabled` הוא שדה נגזר
            ("פעיל במשהו") שאף אחד לא מתחזק — המנוע אוכף אך ורק לפי send_enabled
            ו-enroll_enabled. הצגה לפי הנגזרת הראתה "כבוי" בזמן שהרצף שלח בפועל. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge color="slate">{s.steps} {t('steps')}</Badge>
          <Badge color={s.sendEnabled ? 'teal' : 'slate'}>
            {s.sendEnabled ? t('sending') : t('notSending')}
          </Badge>
          <Badge color={s.enrollEnabled ? 'blue' : 'slate'}>
            {s.enrollEnabled ? t('enrolling') : t('notEnrolling')}
          </Badge>
        </div>
      </div>

      {/* מספרים */}
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold leading-none text-n-slate-12">{s.total}</span>
        <span className="text-xs text-n-slate-11">{t('enrolled')}</span>
      </div>

      {/* פילוח סטטוס */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-n-slate-11">
        <span className="inline-flex items-center gap-1"><Dot c="bg-n-teal-9" />{s.active} {t('activeCount')}</span>
        {s.failed > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-n-ruby-11"><Dot c="bg-n-ruby-9" />{s.failed} {t('stuckCount')}</span>
        ) : null}
        <span className="inline-flex items-center gap-1"><Dot c="bg-n-blue-9" />{s.completed} {t('completedCount')}</span>
        <span className="inline-flex items-center gap-1"><Dot c="bg-n-slate-8" />{s.stopped} {t('stoppedCount')}</span>
      </div>

      {/* % השלמה + פס */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-n-slate-11">{t('completionRate')}</span>
          <span className="text-xs font-medium text-n-slate-12">{s.completionPct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full rounded-full bg-n-alpha-3" aria-hidden="true">
          <div className="h-1.5 rounded-full bg-n-brand" style={{ width: `${s.completionPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function Dot({ c }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${c}`} aria-hidden="true" />;
}

/**
 * TrendChart — נמסר / שגיאת שליחה / חסימת מטא, ליום, לאורך שבוע.
 *
 * ⚠️ קנה מידה מרוכך (√), לא לינארי. יום בודד יכול להיות פי 30 משכנו — 12/07 שלח
 * 1,658 בסופת retry, ושאר הימים 40–170. בקנה מידה לינארי היום הענק מוחץ את כולם
 * לפיקסל, והמגמה — שכל תפקידה להשוות ימים — הופכת לעמודה אחת וחמישה קווים. השורש
 * √ נותן ליום הגדול להישאר הגדול ביותר בלי למחוק את הקטנים; המספר המדויק על כל
 * עמודה מחזיר את הדיוק שהעין מאבדת. (ponytail: √-scale, לוג אם הטווח יגדל מעבר ל-×100.)
 *
 * הגובה מייצג נפח (√), והחלוקה הפנימית לינארית — כך שהפרופורציה ירוק/כתום/אדום
 * בתוך העמודה נאמנה. 2px רווח-משטח בין המקטעים כמו בעוגה.
 */
function TrendChart({ trend, tr }) {
  const H = 104;               // גובה מרבי — היה 48, נמוך מכדי לראות ימים קטנים
  const total = (d) => (d.delivered || 0) + (d.send_error || 0) + (d.failed || 0);
  const maxTotal = Math.max(1, ...trend.map(total));
  const scale = (v) => (v <= 0 ? 0 : Math.round((Math.sqrt(v) / Math.sqrt(maxTotal)) * H));

  const legend = [
    { cls: 'bg-n-teal-9', label: tr('mDelivered') },
    { cls: 'bg-n-amber-9', label: tr('sendError') },
    { cls: 'bg-n-ruby-9', label: tr('mBlocked') },
  ];

  return (
    <div className="mt-5 border-t border-n-weak pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-n-slate-11">
        <span className="inline-flex items-center gap-1 font-medium text-n-slate-12">
          <TrendingUp size={13} aria-hidden="true" />{tr('trend7')}
        </span>
        {legend.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1 text-n-slate-10">
            <Dot c={l.cls} />{l.label}
          </span>
        ))}
      </div>

      <div className="flex items-end justify-between gap-2 sm:gap-3" style={{ height: `${H + 22}px` }}>
        {trend.map((d) => {
          const n = total(d);
          const barH = scale(n);
          // גובה מינימלי 3px למקטע לא-אפס: תוצאה אמיתית (בעיקר שגיאת שליחה, שיכולה
          // להיות זעירה מול נפח גדול) לא תיעלם לקו של פיקסל.
          const seg = (v) => (v <= 0 ? 0 : Math.max(3, Math.round((v / n) * barH)));
          const title = `${d.day} · ${tr('mSent')} ${d.sent || 0} · `
            + `${tr('mDelivered')} ${d.delivered || 0} · ${tr('mBlocked')} ${d.failed || 0}`
            + ((d.send_error || 0) > 0 ? ` · ${tr('sendError')} ${d.send_error}` : '');
          return (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5" title={title}>
              {/* נפח היום — המספר שהעין מאבדת בקנה מידה מרוכך */}
              <span className="text-[10px] font-medium tabular-nums text-n-slate-11">
                {n > 0 ? n : ''}
              </span>
              <div className="flex w-full max-w-[40px] flex-col justify-end gap-px"
                   style={{ height: `${H}px` }}>
                {seg(d.failed || 0) > 0 ? (
                  <div className="w-full rounded-t-md bg-n-ruby-9" style={{ height: `${seg(d.failed || 0)}px` }} />
                ) : null}
                {seg(d.send_error || 0) > 0 ? (
                  <div className={`w-full bg-n-amber-9 ${seg(d.failed || 0) === 0 ? 'rounded-t-md' : ''}`}
                       style={{ height: `${seg(d.send_error || 0)}px` }} />
                ) : null}
                {seg(d.delivered || 0) > 0 ? (
                  <div className={`w-full bg-n-teal-9 ${seg(d.failed || 0) === 0 && seg(d.send_error || 0) === 0 ? 'rounded-t-md' : ''}`}
                       style={{ height: `${seg(d.delivered || 0)}px` }} />
                ) : null}
                {n === 0 ? <div className="w-full rounded bg-n-alpha-2" style={{ height: '3px' }} /> : null}
              </div>
              <span className="text-[11px] tabular-nums text-n-slate-10">{d.day}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
