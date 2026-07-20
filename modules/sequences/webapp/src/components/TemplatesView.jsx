import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Plus,
  Eye,
  Pencil,
  Copy,
  Trash2,
  ChevronDown,
  AlertCircle,
  ShieldAlert,
  FileText,
} from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Input from './ui/Input.jsx';
import Modal from './ui/Modal.jsx';
import Dropdown from './ui/Dropdown.jsx';
import Skeleton, { SkeletonRows } from './ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from './ui/Table.jsx';
import { useToast } from './ui/Toast.jsx';
import { listTemplates, deleteTemplate } from '../api/templatesApi.js';
import { deserializeTemplate } from '../lib/templateRules.js';
import { statusChip, qualityDot, canEdit, groupLabel } from '../lib/templateDisplay.js';
import useT, { useLocale } from '../useT.js';
import { translate } from '../i18n.js';

/*
 * TemplatesView — Template Studio list screen. Loads every WABA the account can see
 * (grouped by business account, not by phone number — see templatesApi.listTemplates /
 * engine actionTplList), lets the admin switch between WABAs when there's more than one,
 * and exposes preview/edit/duplicate/delete per template.
 *
 * This screen owns exactly one write action: delete. Create/edit/duplicate are handed
 * off to the parent via callbacks (wired to TemplateBuilder in Task 12) — this component
 * never calls createTemplate/editTemplate itself.
 */

// Co-located dictionary (he/en) — every user-facing string on the templates list screen.
const M = {
  he: {
    title: 'תבניות WhatsApp',
    refresh: 'רענון',
    newTemplate: '+ תבנית חדשה',
    wabaSelectorAria: 'בחירת חשבון WhatsApp עסקי',

    forbiddenTitle: 'העמוד זמין למנהלי חשבון בלבד',
    forbiddenBody: 'רק מנהלי חשבון יכולים לנהל תבניות WhatsApp.',

    errLoad: 'שגיאה בטעינת התבניות',
    retry: 'נסה שוב',
    errDelete: 'מחיקת התבנית נכשלה',

    noWaba: 'אין מספרי WhatsApp מחוברים לחשבון זה.',
    empty: 'אין עדיין תבניות. אפשר ליצור תבנית חדשה למעלה.',

    colName: 'שם',
    colLang: 'שפה',
    colCategory: 'קטגוריה',
    colStatus: 'סטטוס',
    colQuality: 'איכות',
    colUpdated: 'עדכון אחרון',
    colActions: 'פעולות',

    cat_MARKETING: 'שיווק',
    cat_UTILITY: 'שירות',
    cat_AUTHENTICATION: 'אימות',

    preview: 'תצוגה מקדימה',
    edit: 'עריכה',
    duplicate: 'שכפול',
    delete: 'מחיקה',
    editResend: 'ערוך ושלח מחדש',
    rejectedReasonLabel: 'סיבת הדחייה',
    expandAria: 'הצגת סיבת הדחייה',
    collapseAria: 'הסתרת סיבת הדחייה',

    previewNoComponents: 'אין רכיבים להצגה',

    deleteTitle: 'מחיקת תבנית',
    deleteWarning: '"{name}" תימחק בכל השפות שלה. הפעולה בלתי הפיכה.',
    deleteTypeLabel: 'הקלידו את שם התבנית לאישור',
    deleteConfirm: 'מחיקה',
    cancel: 'ביטול',
    deleted: 'התבנית נמחקה',
  },
  en: {
    title: 'WhatsApp Templates',
    refresh: 'Refresh',
    newTemplate: '+ New template',
    wabaSelectorAria: 'Select WhatsApp Business Account',

    forbiddenTitle: 'This page is available to account administrators only',
    forbiddenBody: 'Only account administrators can manage WhatsApp templates.',

    errLoad: 'Failed to load templates',
    retry: 'Retry',
    errDelete: 'Failed to delete template',

    noWaba: 'No WhatsApp numbers connected to this account.',
    empty: 'No templates yet. Create one above.',

    colName: 'Name',
    colLang: 'Language',
    colCategory: 'Category',
    colStatus: 'Status',
    colQuality: 'Quality',
    colUpdated: 'Last updated',
    colActions: 'Actions',

    cat_MARKETING: 'Marketing',
    cat_UTILITY: 'Utility',
    cat_AUTHENTICATION: 'Authentication',

    preview: 'Preview',
    edit: 'Edit',
    duplicate: 'Duplicate',
    delete: 'Delete',
    editResend: 'Edit and resend',
    rejectedReasonLabel: 'Rejection reason',
    expandAria: 'Show rejection reason',
    collapseAria: 'Hide rejection reason',

    previewNoComponents: 'No components to display',

    deleteTitle: 'Delete template',
    deleteWarning: '"{name}" will be deleted in ALL its languages. This cannot be undone.',
    deleteTypeLabel: 'Type the template name to confirm',
    deleteConfirm: 'Delete',
    cancel: 'Cancel',
    deleted: 'Template deleted',
  },
};

const TABLE_COLS = 7; // name, language, category, status, quality, updated, actions — skeleton must match

// Plain-text summary of one Graph template component — placeholder for Task 11's real
// <TemplatePreview tpl={...} /> WhatsApp-bubble render (see the preview modal below).
function summarizeComponent(c) {
  if (!c || !c.type) return '';
  switch (c.type) {
    case 'HEADER':
      return `HEADER (${c.format || 'TEXT'})${c.text ? `: "${c.text}"` : ''}`;
    case 'BODY':
      return `BODY: "${c.text || ''}"`;
    case 'FOOTER':
      return `FOOTER: "${c.text || ''}"`;
    case 'BUTTONS':
      return `BUTTONS: ${(c.buttons || []).map((b) => `${b.type}${b.text ? ` "${b.text}"` : ''}`).join(', ') || '—'}`;
    case 'CAROUSEL':
      return `CAROUSEL: ${(c.cards || []).length} card(s)`;
    case 'LIMITED_TIME_OFFER':
      return `LIMITED_TIME_OFFER${c.limited_time_offer?.text ? `: "${c.limited_time_offer.text}"` : ''}`;
    default:
      return c.type;
  }
}

export default function TemplatesView({ accountId, onEdit, onCreate, onDuplicate }) {
  const t = useT(M);
  const locale = useLocale();
  const { toast } = useToast();
  const tOr = (key, raw) => (t(key) === key ? raw : t(key));
  const pick = (obj) => (locale === 'he' ? obj.he : obj.en);
  const fmt = useCallback(
    (iso) => (iso ? new Date(iso).toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB') : '—'),
    [locale]
  );

  const [wabas, setWabas] = useState(null); // null = not loaded yet
  const [selectedWabaId, setSelectedWabaId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [previewTpl, setPreviewTpl] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const storageKey = `tpl_waba_${accountId}`;

  const load = useCallback(() => {
    if (accountId == null) return;
    setLoading(true);
    setError('');
    setForbidden(false);
    listTemplates(accountId)
      .then((res) => {
        const list = (res && res.wabas) || [];
        setWabas(list);
        setSelectedWabaId((prev) => {
          const ids = list.map((w) => String(w.wabaId));
          if (ids.includes(prev)) return prev;
          let saved = null;
          try { saved = localStorage.getItem(storageKey); } catch { /* ignore */ }
          return ids.includes(saved) ? saved : (ids[0] ?? null);
        });
      })
      .catch((e) => {
        if (e.forbidden) setForbidden(true);
        else setError(e.message || translate(M, 'errLoad'));
      })
      .finally(() => setLoading(false));
  }, [accountId, storageKey]);

  useEffect(() => { load(); }, [load]);

  // Persist the WABA selection — so a page refresh stays on the same business account
  // (per-account key, so an admin managing several Chatwoot accounts doesn't leak a
  // selection across accounts).
  useEffect(() => {
    if (selectedWabaId == null) return;
    try { localStorage.setItem(storageKey, selectedWabaId); } catch { /* ignore */ }
  }, [selectedWabaId, storageKey]);

  const selectedWaba = useMemo(
    () => (wabas || []).find((w) => String(w.wabaId) === selectedWabaId) || null,
    [wabas, selectedWabaId]
  );
  const templates = selectedWaba?.templates || [];

  const toggleExpand = (key) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openDelete = (tpl) => { setDeleteTarget(tpl); setDeleteInput(''); setError(''); };
  const closeDelete = () => { setDeleteTarget(null); setDeleteInput(''); };

  const confirmDelete = async () => {
    if (!deleteTarget || deleteInput !== deleteTarget.name) return;
    setDeleting(true);
    setError('');
    try {
      const inboxId = selectedWaba?.inboxes?.[0]?.inboxId;
      // No hsm_id: deletes by name only — matches the warning copy ("all languages").
      await deleteTemplate(accountId, inboxId, deleteTarget.name);
      toast({ message: t('deleted'), variant: 'success' });
      closeDelete();
      load();
    } catch (e) {
      setError(e.message || translate(M, 'errDelete'));
    } finally {
      setDeleting(false);
    }
  };

  // 3rd arg: deserializeTemplate() builds a fresh UI-shaped object and doesn't carry the
  // Graph template id — the builder needs it separately (engine's tpl_edit requires the
  // numeric id, not name+language) to know it's editing rather than creating.
  const doEdit = (tpl) => onEdit?.(deserializeTemplate(tpl), selectedWaba, tpl.id);
  const doDuplicate = (tpl) => {
    const dup = deserializeTemplate(tpl);
    dup.name = '';
    onDuplicate?.(dup, selectedWaba);
  };

  if (forbidden) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-20 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-ruby-3 text-n-ruby-11">
          <ShieldAlert size={24} aria-hidden="true" />
        </span>
        <p className="text-base font-medium text-n-slate-12">{t('forbiddenTitle')}</p>
        <p className="text-sm text-n-slate-11">{t('forbiddenBody')}</p>
      </div>
    );
  }

  // Always the full skeleton while loading — including a manual refresh — exactly like
  // CampaignsView/ComplianceView (this codebase has no "keep stale data during refresh"
  // pattern; not inventing one here).
  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-full rounded-lg sm:max-w-xs" />
        <SkeletonRows rows={4} cols={TABLE_COLS} />
      </div>
    );
  }

  if (error && wabas === null) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
        <span className="flex items-start gap-2.5">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </span>
        <Button variant="faded" color="ruby" size="sm" onClick={load}>{t('retry')}</Button>
      </div>
    );
  }

  const wabaList = wabas || [];

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
            <FileText size={15} className="text-n-blue-11" aria-hidden="true" />
            {t('title')}
          </h2>
          {wabaList.length > 1 ? (
            <Dropdown
              value={selectedWabaId}
              onChange={setSelectedWabaId}
              options={wabaList.map((w) => ({ value: String(w.wabaId), label: groupLabel(w) }))}
              ariaLabel={t('wabaSelectorAria')}
              className="sm:w-72"
            />
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" color="slate" size="sm" icon={RefreshCw} onClick={load}>
            {t('refresh')}
          </Button>
          {selectedWaba ? (
            <Button variant="solid" color="blue" size="sm" icon={Plus} onClick={() => onCreate?.(selectedWaba)}>
              {t('newTemplate')}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {wabaList.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-16 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-brand/10 text-n-blue-11">
            <FileText size={24} aria-hidden="true" />
          </span>
          <p className="text-sm text-n-slate-11">{t('noWaba')}</p>
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-16 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-brand/10 text-n-blue-11">
            <FileText size={24} aria-hidden="true" />
          </span>
          <p className="text-sm text-n-slate-11">{t('empty')}</p>
        </div>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>{t('colName')}</TH>
              <TH>{t('colLang')}</TH>
              <TH>{t('colCategory')}</TH>
              <TH>{t('colStatus')}</TH>
              <TH>{t('colQuality')}</TH>
              <TH>{t('colUpdated')}</TH>
              <TH align="end">{t('colActions')}</TH>
            </TR>
          </THead>
          <TBody>
            {templates.flatMap((tpl) => {
              const rowKey = tpl.id || `${tpl.name}::${tpl.language}`;
              const chip = statusChip(tpl.status);
              const quality = qualityDot(tpl.quality_score);
              const editable = canEdit(tpl.status);
              const isRejected = tpl.status === 'REJECTED';
              const expanded = isRejected && expandedRows.has(rowKey);

              const rows = [
                <TR key={rowKey}>
                  <TD>
                    <span className="flex items-center gap-1.5">
                      {isRejected ? (
                        <button
                          type="button"
                          onClick={() => toggleExpand(rowKey)}
                          aria-label={expanded ? t('collapseAria') : t('expandAria')}
                          aria-expanded={expanded}
                          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-n-slate-10 transition-colors hover:bg-n-alpha-2 hover:text-n-slate-12"
                        >
                          <ChevronDown
                            size={14}
                            aria-hidden="true"
                            className={`transition-transform ${expanded ? '' : '-rotate-90'}`}
                          />
                        </button>
                      ) : null}
                      <span className="font-mono text-xs text-n-slate-12" dir="ltr">{tpl.name}</span>
                    </span>
                  </TD>
                  <TD><span className="text-xs text-n-slate-11" dir="ltr">{tpl.language}</span></TD>
                  <TD><span className="text-xs text-n-slate-11">{tOr(`cat_${tpl.category}`, tpl.category)}</span></TD>
                  <TD><Badge color={chip.cls}>{pick(chip)}</Badge></TD>
                  <TD>
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${quality.color}`}
                      role="img"
                      aria-label={pick(quality)}
                      title={pick(quality)}
                    />
                  </TD>
                  <TD><span className="text-xs text-n-slate-11">{fmt(tpl.last_updated_time)}</span></TD>
                  <TD align="end">
                    <span className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" color="slate" size="sm" iconOnly icon={Eye}
                        aria-label={t('preview')} title={t('preview')}
                        onClick={() => setPreviewTpl(tpl)}
                      />
                      {editable ? (
                        <Button
                          variant="ghost" color="slate" size="sm" iconOnly icon={Pencil}
                          aria-label={t('edit')} title={t('edit')}
                          onClick={() => doEdit(tpl)}
                        />
                      ) : null}
                      <Button
                        variant="ghost" color="slate" size="sm" iconOnly icon={Copy}
                        aria-label={t('duplicate')} title={t('duplicate')}
                        onClick={() => doDuplicate(tpl)}
                      />
                      <Button
                        variant="ghost" color="ruby" size="sm" iconOnly icon={Trash2}
                        aria-label={t('delete')} title={t('delete')}
                        onClick={() => openDelete(tpl)}
                      />
                    </span>
                  </TD>
                </TR>,
              ];

              if (expanded) {
                rows.push(
                  <tr key={`${rowKey}-expand`} className="border-b border-n-weak bg-n-alpha-1">
                    <td colSpan={TABLE_COLS} className="px-4 py-3">
                      <p className="mb-2 text-xs font-medium text-n-slate-11">{t('rejectedReasonLabel')}</p>
                      <p className="mb-3 text-sm text-n-slate-12">{tpl.rejected_reason || '—'}</p>
                      <Button variant="faded" color="blue" size="sm" onClick={() => doEdit(tpl)}>
                        {t('editResend')}
                      </Button>
                    </td>
                  </tr>
                );
              }
              return rows;
            })}
          </TBody>
        </Table>
      )}

      {/* Preview — plain-text breakdown of the component structure.
          TODO(Task 11): replace this textual dump with the real <TemplatePreview tpl={...} />
          WhatsApp-bubble render (header/body/buttons/carousel styled like SequencePreview.jsx). */}
      <Modal open={!!previewTpl} onClose={() => setPreviewTpl(null)} title={previewTpl?.name} size="md">
        <div className="flex flex-col gap-2">
          {(previewTpl?.components || []).length === 0 ? (
            <p className="text-sm text-n-slate-11">{t('previewNoComponents')}</p>
          ) : (
            (previewTpl.components || []).map((c, i) => (
              <div
                key={`${c.type}-${i}`}
                className="rounded-lg border border-n-weak bg-n-alpha-1 px-3 py-2 font-mono text-xs text-n-slate-11"
                dir="ltr"
              >
                {summarizeComponent(c)}
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Delete — double confirmation: typing the exact template name enables the button. */}
      <Modal
        open={!!deleteTarget}
        onClose={closeDelete}
        title={t('deleteTitle')}
        size="sm"
        closeOnOverlay={!deleting}
        footer={
          <>
            <Button variant="ghost" color="slate" onClick={closeDelete} disabled={deleting}>
              {t('cancel')}
            </Button>
            <Button
              variant="solid"
              color="ruby"
              onClick={confirmDelete}
              loading={deleting}
              disabled={!deleteTarget || deleteInput !== deleteTarget.name}
            >
              {t('deleteConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex gap-3.5">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-n-ruby-3 text-n-ruby-11" aria-hidden="true">
            <Trash2 size={20} strokeWidth={2} />
          </span>
          <div className="min-w-0 grow pt-0.5">
            <p className="text-sm leading-relaxed text-n-slate-11">
              {t('deleteWarning', { name: deleteTarget?.name || '' })}
            </p>
            {/* Delete errors surface here — not just in the page banner behind the modal,
                which isn't visible while it's open */}
            {error ? (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-n-ruby-7 bg-n-ruby-3 px-3 py-2 text-sm text-n-ruby-11">
                <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}
            <div className="mt-3">
              <Input
                label={t('deleteTypeLabel')}
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
