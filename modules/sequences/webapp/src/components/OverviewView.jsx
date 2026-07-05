import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertCircle, Layers, BarChart3, HardDrive, Send, Ban, Clock, TrendingUp } from 'lucide-react';
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
      {/* סה"כ */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TOTAL_CARDS.map((c) => (
          <div key={c.key} className="flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 ring-1 ring-n-weak">
            <span className={`text-2xl font-semibold leading-none ${c.text}`}>{totals[c.key]}</span>
            <span className="mt-1 text-xs text-n-slate-11">{t(c.label)}</span>
          </div>
        ))}
      </div>

      {/* פעילות שליחה — מה יצא היום, כמה הגיע ללקוחות וכמה נחסם */}
      {stats ? <DeliveryCard stats={stats} /> : null}

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
  const sent = t.sent || 0;
  const pct = (n) => (sent > 0 ? Math.round((n / sent) * 100) : 0);
  const reasons = [
    { label: tr('reasonCap'), n: t.block_cap || 0 },
    { label: tr('reasonInvalid'), n: t.block_invalid || 0 },
    { label: tr('reasonOptout'), n: t.block_optout || 0 },
    { label: tr('reasonOther'), n: t.block_other || 0 },
  ].filter((r) => r.n > 0);
  const trend = stats.trend || [];
  const maxTrend = Math.max(1, ...trend.map((d) => d.sent || 0));

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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DeliveryMetric label={tr('mSent')} value={sent} text="text-n-slate-12" />
        <DeliveryMetric label={tr('mDelivered')} value={t.delivered || 0} sub={`${pct(t.delivered || 0)}%`} text="text-n-teal-11" />
        <DeliveryMetric label={tr('mRead')} value={t.read || 0} sub={`${pct(t.read || 0)}%`} text="text-n-blue-11" />
        <DeliveryMetric label={tr('mBlocked')} value={t.failed || 0} sub={`${pct(t.failed || 0)}%`} text="text-n-ruby-11" />
      </div>

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

      {stats.byTemplate && stats.byTemplate.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-n-slate-11">
          <span className="text-n-slate-10">{tr('blockedMessages')}</span>
          {stats.byTemplate.map((x) => (
            <span key={x.template} className="font-mono">
              {x.template} <span className="text-n-ruby-11">({x.failed})</span>
            </span>
          ))}
        </div>
      ) : null}

      {trend.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-n-slate-11">
            <span className="inline-flex items-center gap-1"><TrendingUp size={12} aria-hidden="true" />{tr('trend7')}</span>
            <span className="inline-flex items-center gap-1 text-n-slate-10"><Dot c="bg-n-teal-9" />{tr('mDelivered')}</span>
            <span className="inline-flex items-center gap-1 text-n-slate-10"><Dot c="bg-n-ruby-9" />{tr('mBlocked')}</span>
          </div>
          <div className="flex items-end gap-1.5">
            {trend.map((d) => {
              const okH = Math.round(((d.delivered || 0) / maxTrend) * 44);
              const failH = Math.round(((d.failed || 0) / maxTrend) * 44);
              return (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full max-w-[28px] flex-col justify-end" style={{ height: '48px' }}>
                    <div className="w-full rounded-t bg-n-ruby-9" style={{ height: `${failH}px` }} title={`${d.day}: ${tr('mBlocked')} ${d.failed || 0}`} />
                    <div className="w-full bg-n-teal-9" style={{ height: `${okH}px` }} title={`${d.day}: ${tr('mDelivered')} ${d.delivered || 0}`} />
                  </div>
                  <span className="text-[10px] text-n-slate-10">{d.day}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeliveryMetric({ label, value, sub, text }) {
  return (
    <div className="flex flex-col items-start rounded-lg bg-n-alpha-1 px-3 py-2 ring-1 ring-n-weak">
      <span className={`text-xl font-semibold leading-none ${text}`}>{value}</span>
      <span className="mt-1 text-xs text-n-slate-11">{label}{sub ? ` · ${sub}` : ''}</span>
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
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge color="slate">{s.steps} {t('steps')}</Badge>
          <Badge color={s.enabled ? 'teal' : 'slate'}>{s.enabled ? t('active') : t('off')}</Badge>
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
