import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ArrowLeft, AlertCircle, Download, MessageSquare, Coins } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Skeleton from './ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from './ui/Table.jsx';
import { getCampaignDetail } from '../api/sequencesApi.js';
import { estimateCost } from '../lib/campaignCost.js';
import useT, { useLocale } from '../useT.js';
import { translate } from '../i18n.js';

// מילון co-located (he/en) — כל הטקסטים הגלויים של תצוגת פרטי הקמפיין (רמה 2).
const M = {
  he: { back: 'חזרה', audience: 'קהל', sent: 'נשלחו', delivered: 'נמסרו', read: 'נקראו', failed: 'נכשלו',
        funnel: 'משפך מסירה', replied: 'הגיבו', replyRate: 'שיעור תגובה', costTitle: 'עלות משוערת',
        costNote: 'אומדן לפי תעריפי Meta לישראל — לא כולל חלון חינם/הנחות',
        recipients: 'נמענים', notSent: 'לא נשלחו', name: 'שם', phone: 'טלפון', status: 'סטטוס', when: 'זמן',
        export: 'ייצוא CSV', errLoad: 'שגיאה בטעינת הקמפיין', notFound: 'הקמפיין לא נמצא',
        s_sent: 'נשלח', s_delivered: 'נמסר', s_read: 'נקרא', s_failed: 'נכשל', s_pending: 'ממתין' },
  en: { back: 'Back', audience: 'Audience', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed',
        funnel: 'Delivery funnel', replied: 'Replied', replyRate: 'Reply rate', costTitle: 'Estimated cost',
        costNote: 'Estimate at Meta IL rates — excludes free window / discounts',
        recipients: 'Recipients', notSent: 'Not sent', name: 'Name', phone: 'Phone', status: 'Status', when: 'Time',
        export: 'Export CSV', errLoad: 'Failed to load campaign', notFound: 'Campaign not found',
        s_sent: 'Sent', s_delivered: 'Delivered', s_read: 'Read', s_failed: 'Failed', s_pending: 'Pending' },
};
// Status enum (messages.status, ראו engine/src/campaigns.js): sent:0, delivered:1, read:2, failed:3.
const STATUS_KEY = { 0: 's_sent', 1: 's_delivered', 2: 's_read', 3: 's_failed' };
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

/*
 * CampaignDetailView — רמה 2 (קמפיין בודד): משפך מסירה, engagement + עלות, טבלת נמענים
 * (עם שגיאת שליחה per-recipient), "לא נשלחו" (קהל היעד שלא קיבל הודעה), וייצוא CSV צד-לקוח.
 * נטען דרך CampaignsView.onSelect(campaignId) → onBack חוזר לרמה 1.
 */
export default function CampaignDetailView({ campaignId, accountId, onBack }) {
  const t = useT(M);
  const locale = useLocale();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (accountId == null || campaignId == null) return;
    setLoading(true); setError('');
    getCampaignDetail(campaignId, accountId)
      .then(setD)
      .catch((e) => setError(e.message || translate(M, 'errLoad')))
      .finally(() => setLoading(false));
  }, [campaignId, accountId]);
  useEffect(() => { load(); }, [load]);

  // חץ "חזרה" — כיוון ויזואלי לפי שפה (עברית RTL: חזרה = ימינה).
  const BackIcon = locale === 'he' ? ArrowRight : ArrowLeft;

  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (error) return (
    <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{error}</span>
    </div>
  );
  if (!d) return <div className="py-16 text-center text-sm text-n-slate-11">{t('notFound')}</div>;

  const { campaign, funnel, engagement, recipients, not_sent } = d;
  const cost = estimateCost({ category: campaign.category, sent: funnel.sent });

  // ייצוא CSV צד-לקוח: BOM (פתיחה תקינה בעברית ב-Excel) + ציטוט כל שדה + בריחת גרשיים כפולים.
  // הגנה מפני הזרקת נוסחאות (CWE-1236): contact_name/phone מגיעים מפרופיל וואטסאפ (לא מהימנים) —
  // תא שמתחיל ב-=/+/-/@/טאב מתפרש כנוסחה ב-Excel/Sheets, לכן מקדימים גרש בודד לפני הציטוט.
  const exportCsv = () => {
    const head = [t('name'), t('phone'), t('status'), t('when')];
    const body = recipients.map((r) => [r.contact_name || '', r.phone || '', t(STATUS_KEY[r.status] || 's_pending'), r.sent_at || '']);
    const csv = '﻿' + [head, ...body].map((row) => row.map((c) => {
      const s = String(c);
      const safe = /^[=+\-@\t]/.test(s) ? "'" + s : s;
      return `"${safe.replace(/"/g, '""')}"`;
    }).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `campaign-${campaign.id}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const FUNNEL = [
    { label: t('audience'), value: funnel.audience, text: 'text-n-slate-12' },
    { label: t('sent'), value: funnel.sent, text: 'text-n-slate-12' },
    { label: t('delivered'), value: funnel.delivered, sub: `${pct(funnel.delivered, funnel.sent)}%`, text: 'text-n-teal-11' },
    { label: t('read'), value: funnel.read, sub: `${pct(funnel.read, funnel.sent)}%`, text: 'text-n-blue-11' },
    { label: t('failed'), value: funnel.failed, sub: `${pct(funnel.failed, funnel.sent)}%`, text: 'text-n-ruby-11' },
  ];

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-n-slate-11 hover:text-n-slate-12">
          <BackIcon size={15} aria-hidden="true" />{t('back')}
        </button>
        <Button variant="faded" color="slate" size="sm" icon={Download} onClick={exportCsv}>{t('export')}</Button>
      </div>

      <div className="mb-4">
        <h1 className="text-lg font-semibold text-n-slate-12">{campaign.title}</h1>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {campaign.template_name ? <Badge color="slate">{campaign.template_name}</Badge> : null}
          {campaign.category ? <Badge color="blue">{campaign.category}</Badge> : null}
        </div>
      </div>

      {/* funnel — דפוס DeliveryMetric מ-OverviewView (grid + ערך גדול + תת-אחוז) */}
      <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
        <h2 className="mb-3 text-sm font-medium text-n-slate-12">{t('funnel')}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {FUNNEL.map((m) => (
            <div key={m.label} className="flex flex-col items-start rounded-lg bg-n-alpha-1 px-3 py-2 ring-1 ring-n-weak">
              <span className={`text-xl font-semibold leading-none ${m.text}`}>{m.value}</span>
              <span className="mt-1 text-xs text-n-slate-11">{m.label}{m.sub ? ` · ${m.sub}` : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {/* engagement + cost — שני כרטיסים */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-n-slate-12"><MessageSquare size={15} className="text-n-blue-11" aria-hidden="true" />{t('replied')}</h2>
          <div className="flex items-baseline gap-2"><span className="text-2xl font-semibold text-n-slate-12">{engagement.replied}</span><span className="text-xs text-n-slate-11">{t('replyRate')}: {engagement.reply_rate}%</span></div>
        </div>
        <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-n-slate-12"><Coins size={15} className="text-n-blue-11" aria-hidden="true" />{t('costTitle')}</h2>
          <div className="flex items-baseline gap-1"><span className="text-2xl font-semibold text-n-slate-12">₪{cost.total}</span></div>
          <p className="mt-1 text-xs text-n-slate-10">{t('costNote')}</p>
        </div>
      </div>

      {/* נמענים */}
      <h2 className="mb-2 text-sm font-medium text-n-slate-12">{t('recipients')} ({recipients.length})</h2>
      <Table>
        <THead><TR className="hover:bg-transparent"><TH>{t('name')}</TH><TH>{t('phone')}</TH><TH>{t('status')}</TH><TH>{t('when')}</TH></TR></THead>
        <TBody>
          {recipients.map((r, i) => (
            <TR key={i}>
              <TD><span className="text-n-slate-12">{r.contact_name || '—'}</span></TD>
              <TD><span className="font-mono text-xs">{r.phone || '—'}</span></TD>
              <TD><Badge color={r.status === 3 ? 'ruby' : r.status === 2 ? 'blue' : r.status === 1 ? 'teal' : 'slate'}>{t(STATUS_KEY[r.status] || 's_pending')}</Badge>
                {r.error_title ? <span className="mt-0.5 block text-xs text-n-ruby-11">{r.error_title}</span> : null}</TD>
              <TD><span className="text-xs text-n-slate-11">{r.sent_at || '—'}</span></TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {/* לא נשלחו — קהל היעד שלא קיבל הודעה (למשל: הצטרף לתווית אחרי השליחה) */}
      {not_sent && not_sent.length > 0 ? (
        <div className="mt-5">
          <h2 className="mb-2 text-sm font-medium text-n-slate-12">{t('notSent')} ({not_sent.length})</h2>
          <div className="flex flex-wrap gap-1.5">
            {not_sent.map((c, i) => (
              <span key={i} className="rounded-full bg-n-alpha-2 px-2.5 py-1 text-xs text-n-slate-11">{c.contact_name || c.phone}</span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
