import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertCircle, Megaphone, BarChart3, Trophy } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Skeleton, { SkeletonRows } from './ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from './ui/Table.jsx';
import { listCampaigns } from '../api/sequencesApi.js';
import useT from '../useT.js';
import { translate } from '../i18n.js';

// מילון co-located (he/en) — כל הטקסטים הגלויים של תצוגת הקמפיינים (רמה 1: סקירה).
const M = {
  he: {
    kTotal: 'קמפיינים', kSent: 'נשלחו', kDelivered: 'נמסרו', kRead: 'נקראו', kFailed: 'נכשלו',
    colName: 'קמפיין', colStatus: 'סטטוס', colDate: 'תאריך', colAudience: 'קהל',
    colSent: 'נשלחו', colDelivered: 'נמסרו', colRead: 'נקראו', colReadRate: 'אחוז קריאה',
    refresh: 'רענון', empty: 'אין עדיין קמפייני WhatsApp.', errLoad: 'שגיאה בטעינת הקמפיינים',
    compareTitle: 'השוואת קמפיינים (לפי אחוז קריאה)',
    st_active: 'פעיל', st_completed: 'הסתיים', st_processing: 'בעיבוד',
  },
  en: {
    kTotal: 'Campaigns', kSent: 'Sent', kDelivered: 'Delivered', kRead: 'Read', kFailed: 'Failed',
    colName: 'Campaign', colStatus: 'Status', colDate: 'Date', colAudience: 'Audience',
    colSent: 'Sent', colDelivered: 'Delivered', colRead: 'Read', colReadRate: 'Read rate',
    refresh: 'Refresh', empty: 'No WhatsApp campaigns yet.', errLoad: 'Failed to load campaigns',
    compareTitle: 'Campaign comparison (by read rate)',
    st_active: 'Active', st_completed: 'Completed', st_processing: 'Processing',
  },
};

const STATUS_LABEL = { 0: 'st_active', 1: 'st_completed', 2: 'st_processing' };
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

/*
 * CampaignsView — רמה 1 (סקירה): כרטיסי KPI + השוואת קמפיינים לפי אחוז קריאה + טבלה מלאה.
 * לחיצה על שורה → onSelect(campaignId) לצלילה לרמה 2 (CampaignDetailView, Task 8).
 */
export default function CampaignsView({ accountId, onSelect }) {
  const t = useT(M);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (accountId == null) return;
    setLoading(true); setError('');
    listCampaigns(accountId)
      .then(setRows)
      .catch((e) => setError(e.message || translate(M, 'errLoad')))
      .finally(() => setLoading(false));
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => rows.reduce((a, c) => ({
    sent: a.sent + c.sent, delivered: a.delivered + c.delivered, read: a.read + c.read, failed: a.failed + c.failed,
  }), { sent: 0, delivered: 0, read: 0, failed: 0 }), [rows]);

  const ranked = useMemo(
    () => [...rows].filter((c) => c.sent > 0).sort((a, b) => pct(b.read, b.sent) - pct(a.read, a.sent)).slice(0, 5),
    [rows]
  );

  if (loading) return <div className="flex flex-col gap-4"><Skeleton className="h-20 w-full rounded-xl" /><SkeletonRows rows={4} cols={6} /></div>;
  if (error) return (
    <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{error}</span>
    </div>
  );

  const KPIS = [
    { label: t('kTotal'), value: rows.length, text: 'text-n-blue-11' },
    { label: t('kSent'), value: totals.sent, text: 'text-n-slate-12' },
    { label: t('kDelivered'), value: `${pct(totals.delivered, totals.sent)}%`, text: 'text-n-teal-11' },
    { label: t('kRead'), value: `${pct(totals.read, totals.sent)}%`, text: 'text-n-blue-11' },
    { label: t('kFailed'), value: `${pct(totals.failed, totals.sent)}%`, text: 'text-n-ruby-11' },
  ];

  return (
    <>
      {/* KPI cards — דפוס זהה ל-TOTAL_CARDS ב-OverviewView */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {KPIS.map((c) => (
          <div key={c.label} className="flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 ring-1 ring-n-weak">
            <span className={`text-2xl font-semibold leading-none ${c.text}`}>{c.value}</span>
            <span className="mt-1 text-xs text-n-slate-11">{c.label}</span>
          </div>
        ))}
      </div>

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
                  <div className="h-2 flex-1 rounded-full bg-n-alpha-3"><div className="h-2 rounded-full bg-n-brand" style={{ width: `${rr}%` }} /></div>
                  <span className="w-10 text-end text-xs font-medium text-n-slate-12">{rr}%</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <BarChart3 size={15} className="text-n-blue-11" aria-hidden="true" />{t('kTotal')}
        </h2>
        <Button variant="ghost" color="slate" size="sm" icon={RefreshCw} onClick={load}>{t('refresh')}</Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-16 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-brand/10 text-n-blue-11"><Megaphone size={24} aria-hidden="true" /></span>
          <p className="text-sm text-n-slate-11">{t('empty')}</p>
        </div>
      ) : (
        <Table>
          <THead><TR className="hover:bg-transparent">
            <TH>{t('colName')}</TH><TH>{t('colStatus')}</TH><TH>{t('colDate')}</TH>
            <TH align="end">{t('colSent')}</TH><TH align="end">{t('colDelivered')}</TH>
            <TH align="end">{t('colRead')}</TH><TH align="end">{t('colReadRate')}</TH>
          </TR></THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id} className="cursor-pointer" onClick={() => onSelect?.(c.id)}>
                <TD><span className="font-medium text-n-slate-12">{c.title}</span>
                  {c.template_name ? <span className="mt-0.5 block font-mono text-xs text-n-slate-10">{c.template_name}</span> : null}</TD>
                <TD><Badge color={c.campaign_status === 1 ? 'slate' : c.campaign_status === 2 ? 'blue' : 'teal'}>{t(STATUS_LABEL[c.campaign_status] || 'st_active')}</Badge></TD>
                <TD><span className="text-xs text-n-slate-11">{c.created_at || '—'}</span></TD>
                <TD align="end">{c.sent}</TD>
                <TD align="end"><span className="text-n-teal-11">{c.delivered}</span></TD>
                <TD align="end">{c.read}</TD>
                <TD align="end"><span className="font-medium">{pct(c.read, c.sent)}%</span></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
