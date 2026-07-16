import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ArrowLeft, AlertCircle, Download, MessageSquare, Coins, Printer, ExternalLink } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Skeleton from './ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from './ui/Table.jsx';
import { getCampaignDetail } from '../api/sequencesApi.js';
import { estimateCost } from '../lib/campaignCost.js';
import { csvRow } from '../lib/csv.js';
import { deliveryErrorLabel } from '../lib/deliveryError.js';
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
        s_sent: 'נשלח — ממתין למסירה', s_delivered: 'נמסר', s_read: 'נקרא', s_failed: 'נכשל', s_pending: 'ממתין', s_notsent: 'לא נוסה לשליחה' },
  en: { back: 'Back', audience: 'Target audience', attempted: 'Attempted', sent: 'Sent successfully', delivered: 'Delivered', read: 'Read', failed: 'Failed',
        funnel: 'Delivery funnel', replied: 'Replied', replyRate: 'Reply rate', costTitle: 'Estimated cost',
        costNote: 'Estimate: Meta IL rate ($/msg), excl. free service window / volume discounts · updated',
        costUnknown: 'The template has no synced category — no cost estimate',
        readNote: "Read rate depends on recipients' read receipts — recipients who disabled them are not counted",
        recipients: 'Recipients', notSent: 'Not attempted', snapshotNote: 'from the audience snapshot captured at campaign time', currentLabelNote: 'from current label membership — this legacy campaign has no saved audience snapshot',
        name: 'Name', phone: 'Phone', status: 'Status', attempts: 'Attempts', when: 'Time', reason: 'Reason', conversation: 'Conversation link', noAttempt: 'No send attempt was created',
        export: 'Export CSV', print: 'Print / PDF', printedAt: 'Generated', openConv: 'Open the conversation in Chatwoot',
        noReplyText: '(media or empty message)', errLoad: 'Failed to load campaign', notFound: 'Campaign not found', retry: 'Retry',
        s_sent: 'Sent — awaiting delivery', s_delivered: 'Delivered', s_read: 'Read', s_failed: 'Failed', s_pending: 'Pending', s_notsent: 'Not attempted' },
};
// Status enum (messages.status, ראו engine/src/campaigns.js): sent:0, delivered:1, read:2, failed:3.
const STATUS_KEY = { 0: 's_sent', 1: 's_delivered', 2: 's_read', 3: 's_failed' };
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

// external_error מגיע מ-Meta כמחרוזת גולמית ("131049: This message was not delivered…") —
// מחלצים את הקוד המספרי וממפים להסבר מתורגם מ-deliveryError.js (משותף עם הרצפים).
const errorLabel = (raw) => {
  if (!raw) return '';
  const code = (/^(\d+)/.exec(String(raw)) || [])[1] || null;
  return deliveryErrorLabel(code, raw);
};

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

  // ניווט לשיחה ב-Chatwoot: בתוך iframe (ה-overlay של עמוד הקמפיינים) — postMessage להורה,
  // שסוגר את ה-overlay ומנווט; standalone — טאב חדש. same-origin בלבד.
  const openConversation = (displayId) => {
    if (!Number.isInteger(displayId)) return;
    if (window.parent !== window) {
      try { window.parent.postMessage({ type: 'drip-open-conversation', display_id: displayId }, window.location.origin); return; } catch { /* fallthrough */ }
    }
    window.open(`/app/accounts/${accountId}/conversations/${displayId}`, '_blank', 'noopener');
  };

  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (error) return (
    <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{error}</span>
      <Button variant="faded" color="slate" size="sm" className="ms-auto shrink-0" onClick={load}>{t('retry')}</Button>
    </div>
  );
  if (!d) return <div className="py-16 text-center text-sm text-n-slate-11">{t('notFound')}</div>;

  const { campaign, funnel, engagement, recipients, not_sent, audience_source } = d;
  // Meta charges for delivered template messages; failed/pending attempts must not inflate cost.
  const cost = estimateCost({ category: campaign.category, sent: funnel.delivered });

  // ייצוא CSV צד-לקוח: BOM (פתיחה תקינה בעברית ב-Excel) + בריחה מלאה דרך lib/csv.js
  // (ציטוט, הכפלת גרשיים, ומגן הזרקת-נוסחאות CWE-1236 — שם/טלפון מפרופיל וואטסאפ אינם מהימנים).
  // כולל עמודת סיבת-כשל מתורגמת, ואת רשימת "לא נשלחו" כשורות עם סטטוס משלהן.
  const exportCsv = () => {
    const head = [t('name'), t('phone'), t('status'), t('attempts'), t('when'), t('reason'), t('conversation')];
    const body = recipients.map((r) => {
      const conversationUrl = Number.isInteger(r.conversation_display_id)
        ? `${window.location.origin}/app/accounts/${accountId}/conversations/${r.conversation_display_id}` : '';
      return [r.contact_name || '', r.phone || '', t(STATUS_KEY[r.status] || 's_pending'), r.attempt_count || 1, r.sent_at || '', r.status === 3 ? errorLabel(r.error_title) : '', conversationUrl];
    });
    const missed = (not_sent || []).map((c) => [c.contact_name || '', c.phone || '', t('s_notsent'), 0, '', t('noAttempt'), '']);
    const csv = '﻿' + [head, ...body, ...missed].map(csvRow).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const safeTitle = String(campaign.title || `campaign-${campaign.id}`).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 70);
    const date = String(campaign.created_at || '').slice(0, 10) || campaign.id;
    const a = document.createElement('a'); a.href = url; a.download = `דוח-${safeTitle}-${date}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

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
          <Button variant="faded" color="slate" size="sm" icon={Download} onClick={exportCsv}>{t('export')}</Button>
        </div>
      </div>

      <div className="mb-4">
        <h1 className="text-lg font-semibold text-n-slate-12">{campaign.title}</h1>
        {/* חותמת להדפסה בלבד — דוח שנשלח ללקוח נושא תאריך הפקה */}
        <p className="print-only text-xs text-n-slate-10">{t('printedAt')}: {new Date().toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB')} · {campaign.created_at || ''}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {campaign.template_name ? <Badge color="slate">{campaign.template_name}</Badge> : null}
          {campaign.category ? <Badge color="blue">{campaign.category}</Badge> : null}
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
                    <span className="shrink-0 text-[10px] text-n-slate-10">{r.replied_at}</span>
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

      {/* נמענים */}
      <h2 className="mb-2 text-sm font-medium text-n-slate-12">{t('recipients')} ({recipients.length})</h2>
      <Table>
        <THead><TR className="hover:bg-transparent"><TH>{t('name')}</TH><TH>{t('phone')}</TH><TH>{t('status')}</TH><TH>{t('attempts')}</TH><TH>{t('when')}</TH></TR></THead>
        <TBody>
          {recipients.map((r, i) => (
            <TR
              key={i}
              className={Number.isInteger(r.conversation_display_id) ? 'cursor-pointer' : ''}
              onClick={Number.isInteger(r.conversation_display_id) ? () => openConversation(r.conversation_display_id) : undefined}
              tabIndex={Number.isInteger(r.conversation_display_id) ? 0 : undefined}
              role={Number.isInteger(r.conversation_display_id) ? 'button' : undefined}
              aria-label={Number.isInteger(r.conversation_display_id) ? `${r.contact_name || r.phone || ''} — ${t('openConv')}` : undefined}
              onKeyDown={Number.isInteger(r.conversation_display_id) ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openConversation(r.conversation_display_id); } } : undefined}
            >
              <TD><span className="text-n-slate-12">{r.contact_name || '—'}</span></TD>
              <TD><span className="font-mono text-xs">{r.phone || '—'}</span></TD>
              <TD><Badge color={r.status === 3 ? 'ruby' : r.status === 2 ? 'blue' : r.status === 1 ? 'teal' : 'slate'}>{t(STATUS_KEY[r.status] || 's_pending')}</Badge>
                {/* ההסבר המתורגם מוצג; המחרוזת הגולמית של Meta נשמרת ב-title לרחיפה (תמיכה/דיבוג) */}
                {r.error_title ? <span title={r.error_title} className="mt-0.5 block text-xs text-n-ruby-11">{errorLabel(r.error_title)}</span> : null}</TD>
              <TD><span className="text-xs text-n-slate-11">{r.attempt_count || 1}</span></TD>
              <TD><span className="text-xs text-n-slate-11">{r.sent_at || '—'}</span></TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {/* לא נשלחו — קהל היעד שלא קיבל הודעה (למשל: הצטרף לתווית אחרי השליחה) */}
      {not_sent && not_sent.length > 0 ? (
        <div className="mt-5">
          <h2 className="mb-2 text-sm font-medium text-n-slate-12">{t('notSent')} ({not_sent.length}) <span className="font-normal text-xs text-n-slate-10">· {t(audience_source === 'snapshot' ? 'snapshotNote' : 'currentLabelNote')}</span></h2>
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
