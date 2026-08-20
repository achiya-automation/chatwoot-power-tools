import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, AlertCircle, Megaphone, BarChart3, Trophy, TrendingUp, Search, ChevronUp, ChevronDown, Radio } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Skeleton, { SkeletonRows } from './ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from './ui/Table.jsx';
import { listCampaigns, getCampaignsTrend, getCampaignsTier } from '../api/sequencesApi.js';
import { readCache, writeCache } from '../lib/swr.js';
import useT from '../useT.js';
import { translate } from '../i18n.js';

// מילון co-located (he/en) — כל הטקסטים הגלויים של תצוגת הקמפיינים (רמה 1: סקירה).
const M = {
  he: {
    kTotal: 'קמפיינים', kSent: 'נשלחו', kDelivered: 'נמסרו', kRead: 'נקראו', kFailed: 'נכשלו',
    kLeft: 'נותרו להיום', kLeftTitle: 'תקציב שליחה יומי מול תקרת ה-tier של Meta (משוער)', unlimitedTier: 'ללא הגבלה',
    colName: 'קמפיין', colStatus: 'סטטוס', colDate: 'תאריך',
    colSent: 'נשלחו', colDelivered: 'נמסרו', colRead: 'נקראו', colReadRate: 'אחוז קריאה', colFailed: 'נכשלו',
    refresh: 'רענון', empty: 'אין עדיין קמפייני WhatsApp.', errLoad: 'שגיאה בטעינת הקמפיינים',
    compareTitle: 'השוואת קמפיינים (לפי אחוז קריאה)',
    trendTitle: 'מגמת קמפיינים',
    st_active: 'פעיל', st_completed: 'הסתיים', st_processing: 'בעיבוד',
    search: 'חיפוש קמפיין או תבנית…', noMatch: 'אין קמפיינים שתואמים לחיפוש/סינון', clearFilter: 'ניקוי סינון',
    live: 'קמפיין רץ — מתעדכן אוטומטית', progressOf: 'מתוך',
    sortBy: 'מיון לפי',
  },
  en: {
    kTotal: 'Campaigns', kSent: 'Sent', kDelivered: 'Delivered', kRead: 'Read', kFailed: 'Failed',
    kLeft: 'Left today', kLeftTitle: "Daily send budget vs Meta's tier cap (estimate)", unlimitedTier: 'Unlimited',
    colName: 'Campaign', colStatus: 'Status', colDate: 'Date',
    colSent: 'Sent', colDelivered: 'Delivered', colRead: 'Read', colReadRate: 'Read rate', colFailed: 'Failed',
    refresh: 'Refresh', empty: 'No WhatsApp campaigns yet.', errLoad: 'Failed to load campaigns',
    compareTitle: 'Campaign comparison (by read rate)',
    trendTitle: 'Campaign trend',
    st_active: 'Active', st_completed: 'Completed', st_processing: 'Processing',
    search: 'Search campaign or template…', noMatch: 'No campaigns match the search/filter', clearFilter: 'Clear filter',
    live: 'A campaign is running — auto-refreshing', progressOf: 'of',
    sortBy: 'Sort by',
  },
};

const STATUS_LABEL = { 0: 'st_active', 1: 'st_completed', 2: 'st_processing' };
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);
// רענון חי בזמן שקמפיין בעיבוד — מהיר מספיק כדי לראות התקדמות, איטי מספיק כדי לא להעמיס.
const LIVE_POLL_MS = 10_000;

/* כותרת עמודה ממוינת — אותו TH של Chatwoot, עם חץ כיוון כשהעמודה פעילה. */
function SortTH({ id, sort, onSort, children, align = 'start' }) {
  const active = sort.key === id;
  const Arrow = sort.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <TH align={align}>
      <button
        type="button"
        onClick={() => onSort(id)}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
        className={`inline-flex items-center gap-0.5 bg-transparent p-0 text-heading-3 ${active ? 'text-n-slate-12' : 'text-n-slate-12 hover:text-n-blue-11'}`}
      >
        {children}
        {active ? <Arrow size={13} aria-hidden="true" className="text-n-blue-11" /> : null}
      </button>
    </TH>
  );
}

/* צ'יפ סינון סטטוס — אותו דפוס טבעות כמו בסינון הנמענים בדוח הקמפיין. */
function StatusChip({ active, onClick, label, count }) {
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
 * CampaignsView — רמה 1 (סקירה): כרטיסי KPI + מגמה + השוואה + טבלה עם חיפוש/סינון/מיון.
 * טעינה: stale-while-revalidate — מצטייר מיד מהעותק האחרון (sessionStorage) ומתרענן ברקע,
 * וכשקמפיין בעיבוד מתרענן לבד כל כמה שניות בלי להבהב. לחיצה על שורה → onSelect(campaignId).
 */
export default function CampaignsView({ accountId, onSelect }) {
  const t = useT(M);
  const cacheKey = `campaigns:${accountId}`;
  // null = אין עדיין כלום (skeleton); אחרת מציירים מיד ומרעננים ברקע.
  const [rows, setRows] = useState(() => readCache(cacheKey));
  const [trend, setTrend] = useState(() => readCache(`${cacheKey}:trend`) || []);
  const [tier, setTier] = useState(() => readCache(`${cacheKey}:tier`));
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState('');
  const [statusSel, setStatusSel] = useState(() => new Set());
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const alive = useRef(true);
  // איפוס בגוף האפקט ולא רק ב-cleanup — אחרת ה-double-mount של StrictMode משאיר את
  // הדגל false לתמיד והתשובות של ה-fetch נזרקות (skeleton נצחי בפיתוח).
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(() => {
    if (accountId == null) return;
    setError('');
    setRefreshing(true);
    listCampaigns(accountId)
      .then((data) => { if (!alive.current) return; setRows(data); writeCache(cacheKey, data); })
      .catch((e) => { if (alive.current) setError(e.message || translate(M, 'errLoad')); })
      .finally(() => { if (alive.current) setRefreshing(false); });
    // מקבילי לרשימה — לא חוסם ולא משפיע על מצב הטעינה/שגיאה שלה; נכשל בשקט.
    getCampaignsTrend(accountId)
      .then((d) => { if (!alive.current) return; setTrend(d); writeCache(`${cacheKey}:trend`, d); })
      .catch(() => {});
    getCampaignsTier(accountId)
      .then((d) => { if (!alive.current) return; setTier(d); writeCache(`${cacheKey}:tier`, d); })
      .catch(() => {});
  }, [accountId, cacheKey]);
  useEffect(() => { load(); }, [load]);

  // קמפיין בעיבוד → רענון חי, שנעצר כשהטאב מוסתר (ואין מה להראות לאף אחד).
  const processing = (rows || []).some((c) => c.campaign_status === 2);
  useEffect(() => {
    if (!processing) return undefined;
    const tick = () => { if (!document.hidden) load(); };
    const timer = setInterval(tick, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [processing, load]);

  const totals = useMemo(() => (rows || []).reduce((a, c) => ({
    attempted: a.attempted + (c.attempted || 0), sent: a.sent + c.sent,
    delivered: a.delivered + c.delivered, read: a.read + c.read, failed: a.failed + c.failed,
  }), { attempted: 0, sent: 0, delivered: 0, read: 0, failed: 0 }), [rows]);

  const ranked = useMemo(
    () => [...(rows || [])].filter((c) => c.sent > 0).sort((a, b) => pct(b.read, b.sent) - pct(a.read, a.sent)).slice(0, 5),
    [rows]
  );

  // ── חיפוש + סינון סטטוס + מיון — הכל בצד הלקוח (הרשימה קטנה, השרת כבר צבר) ──
  const statusCounts = useMemo(() => {
    const counts = { 0: 0, 1: 0, 2: 0 };
    for (const c of rows || []) counts[c.campaign_status] = (counts[c.campaign_status] || 0) + 1;
    return counts;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = (rows || []).filter((c) => {
      if (statusSel.size && !statusSel.has(c.campaign_status)) return false;
      if (!needle) return true;
      return String(c.title || '').toLowerCase().includes(needle)
        || String(c.template_name || '').toLowerCase().includes(needle);
    });
    const dirMul = sort.dir === 'asc' ? 1 : -1;
    const val = (c) => (
      sort.key === 'sent' ? c.sent
        : sort.key === 'delivered' ? c.delivered
          : sort.key === 'read' ? c.read
            : sort.key === 'readRate' ? pct(c.read, c.sent)
              : sort.key === 'failed' ? c.failed
                : c.created_at || '' // date
    );
    // tie-breaker קבוע (id) — בלעדיו סדר שווי-ערך מוגרל מחדש בכל רענון חי
    return filtered.sort((a, b) => {
      const av = val(a); const bv = val(b);
      if (av < bv) return -1 * dirMul;
      if (av > bv) return 1 * dirMul;
      return (b.id || 0) - (a.id || 0);
    });
  }, [rows, q, statusSel, sort]);

  const onSort = (key) => setSort((cur) => (
    cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
  ));
  const toggleStatus = (s) => setStatusSel((cur) => {
    const next = new Set(cur);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  if (rows == null && !error) {
    return <div className="flex flex-col gap-4"><Skeleton className="h-20 w-full rounded-xl" /><SkeletonRows rows={4} cols={8} /></div>;
  }
  if (rows == null && error) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{error}</span>
        <Button variant="faded" color="slate" size="sm" className="ms-auto shrink-0" onClick={load}>{t('refresh')}</Button>
      </div>
    );
  }

  const KPIS = [
    { label: t('kTotal'), value: rows.length, text: 'text-n-blue-11' },
    { label: t('kSent'), value: totals.sent, text: 'text-n-slate-12' },
    { label: t('kDelivered'), value: `${pct(totals.delivered, totals.sent)}%`, text: 'text-n-teal-11' },
    { label: t('kRead'), value: `${pct(totals.read, totals.sent)}%`, text: 'text-n-blue-11' },
    { label: t('kFailed'), value: `${pct(totals.failed, totals.attempted)}%`, text: 'text-n-ruby-11' },
  ];
  // Preflight — תקציב 24h מול תקרת ה-tier: מונע קמפיין שינחת על 131049 המוני.
  if (tier) {
    KPIS.push({
      label: t('kLeft'),
      title: t('kLeftTitle'),
      value: tier.unlimited ? t('unlimitedTier') : tier.remaining,
      text: !tier.unlimited && tier.remaining === 0 ? 'text-n-ruby-11' : 'text-n-teal-11',
    });
  }

  // מחושב פעם אחת לכל הגרף (לא בכל איטרציה של ה-map) — הגובה המקסימלי לנרמול העמודות.
  const maxT = Math.max(1, ...trend.map((x) => x.attempted || x.sent || 0));
  const filtered = statusSel.size > 0 || q.trim() !== '';

  return (
    <>
      {/* KPI cards — דפוס זהה ל-TOTAL_CARDS ב-OverviewView; עמודה שישית כשמידע ה-tier זמין */}
      <div className={`mb-5 grid grid-cols-2 gap-3 ${KPIS.length > 5 ? 'sm:grid-cols-6' : 'sm:grid-cols-5'}`}>
        {KPIS.map((c) => (
          <div key={c.label} title={c.title} className="flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 ring-1 ring-n-weak">
            <span className={`text-2xl font-semibold leading-none ${c.text}`}>{c.value}</span>
            <span className="mt-1 text-xs text-n-slate-11">{c.label}</span>
          </div>
        ))}
      </div>

      {/* גרף מגמה — נשלחו/נמסרו/נכשלו ליום, דפוס זהה ל-trend bars ב-DeliveryCard (OverviewView) */}
      {trend.length > 0 ? (
        <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-n-slate-12"><TrendingUp size={15} className="text-n-blue-11" aria-hidden="true" />{t('trendTitle')}</h2>
          <div className="flex items-end gap-1.5">
            {trend.map((dd) => {
              const okH = Math.round(((dd.delivered || 0) / maxT) * 44);
              const failH = Math.round(((dd.failed || 0) / maxT) * 44);
              return (
                <div key={dd.day} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full max-w-[28px] flex-col justify-end" style={{ height: '48px' }}>
                    <div className="w-full rounded-t bg-n-ruby-9" style={{ height: `${failH}px` }} title={`${dd.day}: ${dd.failed || 0}`} />
                    <div className="w-full bg-n-teal-9" style={{ height: `${okH}px` }} title={`${dd.day}: ${dd.delivered || 0}`} />
                  </div>
                  <span className="text-xxs text-n-slate-10">{dd.day}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* השוואה — bar-list לפי אחוז קריאה */}
      {ranked.length > 0 ? (
        <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
            <Trophy size={15} className="text-n-blue-11" aria-hidden="true" />{t('compareTitle')}
          </h2>
          <div className="flex flex-col gap-2">
            {ranked.map((c) => {
              const rr = pct(c.read, c.sent);
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="w-40 truncate text-xs text-n-slate-11" title={c.title}>{c.title}</span>
                  <div className="h-2 flex-1 rounded-full bg-n-alpha-3" aria-hidden="true"><div className="h-2 rounded-full bg-n-brand" style={{ width: `${rr}%` }} /></div>
                  <span className="w-10 text-end text-xs font-medium text-n-slate-12">{rr}%</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* כותרת הטבלה + חיווי חי + רענון */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <BarChart3 size={15} className="text-n-blue-11" aria-hidden="true" />{t('kTotal')}
          {processing ? (
            <span className="inline-flex items-center gap-1 text-xs font-normal text-n-teal-11" title={t('live')}>
              <Radio size={13} className="animate-pulse" aria-hidden="true" />{t('live')}
            </span>
          ) : null}
        </h2>
        <Button variant="ghost" color="slate" size="sm" icon={RefreshCw} onClick={load} loading={refreshing}>{t('refresh')}</Button>
      </div>

      {/* סרגל חיפוש + סינון סטטוס — מוצג רק כשיש ממה לסנן */}
      {rows.length > 0 ? (
        <div className="no-print mb-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-n-alpha-1 px-2.5 py-2 ring-1 ring-n-weak">
          <span className="relative">
            <Search size={13} aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-n-slate-10" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="h-8 w-56 rounded-lg border-none bg-n-alpha-black2 pe-3 ps-8 text-sm text-n-slate-12 outline outline-1 -outline-offset-1 outline-n-weak placeholder:text-n-slate-10 hover:outline-n-slate-6 focus:outline-n-brand"
            />
          </span>
          <span className="mx-1 h-4 w-px bg-n-slate-6" aria-hidden="true" />
          {[2, 0, 1].filter((s) => statusCounts[s] > 0).map((s) => (
            <StatusChip
              key={s}
              active={statusSel.has(s)}
              onClick={() => toggleStatus(s)}
              label={t(STATUS_LABEL[s])}
              count={statusCounts[s]}
            />
          ))}
          {filtered ? (
            <button type="button" onClick={() => { setQ(''); setStatusSel(new Set()); }} className="ms-auto rounded-lg px-2 py-1 text-xs text-n-slate-11 hover:bg-n-alpha-2 hover:text-n-slate-12">
              {t('clearFilter')}
            </button>
          ) : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-16 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-brand/10 text-n-blue-11"><Megaphone size={24} aria-hidden="true" /></span>
          <p className="text-sm text-n-slate-11">{t('empty')}</p>
        </div>
      ) : (
        <Table>
          <THead><TR>
            <TH>{t('colName')}</TH><TH>{t('colStatus')}</TH>
            <SortTH id="date" sort={sort} onSort={onSort}>{t('colDate')}</SortTH>
            <SortTH id="sent" sort={sort} onSort={onSort} align="end">{t('colSent')}</SortTH>
            <SortTH id="delivered" sort={sort} onSort={onSort} align="end">{t('colDelivered')}</SortTH>
            <SortTH id="read" sort={sort} onSort={onSort} align="end">{t('colRead')}</SortTH>
            <SortTH id="readRate" sort={sort} onSort={onSort} align="end">{t('colReadRate')}</SortTH>
            <SortTH id="failed" sort={sort} onSort={onSort} align="end">{t('colFailed')}</SortTH>
          </TR></THead>
          <TBody>
            {visible.map((c) => {
              const progress = c.campaign_status === 2 && c.audience_size > 0
                ? Math.min(100, pct(c.attempted, c.audience_size)) : null;
              return (
                <TR
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => onSelect?.(c.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={c.title}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(c.id); } }}
                >
                  <TD><span className="font-medium text-n-slate-12">{c.title}</span>
                    {c.template_name ? <span className="mt-0.5 block font-mono text-xs text-n-slate-10">{c.template_name}</span> : null}</TD>
                  <TD>
                    <Badge color={c.campaign_status === 1 ? 'slate' : c.campaign_status === 2 ? 'blue' : 'teal'}>{t(STATUS_LABEL[c.campaign_status] || 'st_active')}</Badge>
                    {/* קמפיין בעיבוד — פס התקדמות מול תמונת הקהל שנשמרה */}
                    {progress != null ? (
                      <span className="mt-1.5 flex items-center gap-1.5" title={`${c.attempted} ${t('progressOf')} ${c.audience_size}`}>
                        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-n-alpha-3"><span className="block h-full rounded-full bg-n-blue-9 transition-all duration-700" style={{ width: `${progress}%` }} /></span>
                        <span className="text-xxs tabular-nums text-n-slate-10">{c.attempted}/{c.audience_size}</span>
                      </span>
                    ) : null}
                  </TD>
                  <TD><span className="text-xs text-n-slate-11">{c.created_at || '—'}</span></TD>
                  <TD align="end">{c.sent}</TD>
                  <TD align="end"><span className="text-n-teal-11">{c.delivered}</span></TD>
                  <TD align="end">{c.read}</TD>
                  <TD align="end"><span className="font-medium">{pct(c.read, c.sent)}%</span></TD>
                  <TD align="end">{c.failed > 0 ? <span className="font-medium text-n-ruby-11">{c.failed}</span> : <span className="text-n-slate-10">0</span>}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      {rows.length > 0 && visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-n-slate-11">{t('noMatch')}</p>
      ) : null}
    </>
  );
}
