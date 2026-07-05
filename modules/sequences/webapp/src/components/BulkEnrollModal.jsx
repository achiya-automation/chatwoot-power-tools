import { useEffect, useMemo, useState } from 'react';
import { Tag, AlertCircle, Users, Send } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import Dropdown from './ui/Dropdown.jsx';
import { listLabels, bulkEnroll } from '../api/sequencesApi.js';
import useT from '../useT.js';
import { translate } from '../i18n.js';

/*
 * BulkEnrollModal — שיוך המוני: כל השיחות עם תווית מסוימת → רצף נבחר.
 * ה-engine כותב את מאפיין `sequence` לכל שיחה; ה-reconciler משייך ושולח בטיק הבא.
 * ⚠️ פעולה ששולחת הודעות להרבה אנשים — אישור מפורש עם ספירה לפני הפעלה.
 */

// מילון co-located (he/en) — כל המחרוזות מול-המשתמש במודאל השיוך ההמוני לפי תווית.
const M = {
  he: {
    title: 'שיוך המוני לפי תווית',
    errLoadLabels: 'שגיאה בטעינת התוויות',
    errAssign: 'השיוך נכשל',
    selectLabelOption: '— בחרו תווית —',
    selectSeqOption: '— בחרו רצף —',
    close: 'סגירה',
    cancel: 'ביטול',
    assign: 'שייך',
    contactsN: '{count} אנשי קשר',
    assignedResult: '{count} אנשי קשר שויכו לרצף',
    sendingSoon: 'ההודעות יתחילו להישלח בדקות הקרובות (לפי תזמון הרצף).',
    failedSuffix: ' ({failed} נכשלו)',
    label: 'תווית',
    selectLabelPlaceholder: 'בחרו תווית…',
    selectLabelAria: 'בחירת תווית',
    loadingLabels: 'טוען תוויות…',
    labelHint: 'כל השיחות עם התווית הזו יתווספו לרצף.',
    targetSeq: 'רצף יעד',
    selectSeqPlaceholder: 'בחרו רצף…',
    selectSeqAria: 'בחירת רצף',
    noActiveSeqs: 'אין רצפים פעילים — הפעילו רצף קודם בלשונית "רצפים".',
    bulkWarnContacts: 'אנשי קשר עם התווית',
    bulkWarnReceive: 'יקבלו את הרצף',
    bulkWarnSend: 'הפעולה תתחיל לשלוח להם הודעות WhatsApp.',
  },
  en: {
    title: 'Bulk assign by label',
    errLoadLabels: 'Failed to load labels',
    errAssign: 'Assignment failed',
    selectLabelOption: '— Select label —',
    selectSeqOption: '— Select sequence —',
    close: 'Close',
    cancel: 'Cancel',
    assign: 'Assign',
    contactsN: '{count} contacts',
    assignedResult: '{count} contacts were assigned to the sequence',
    sendingSoon: 'Messages will start sending in the next few minutes (according to the sequence schedule).',
    failedSuffix: ' ({failed} failed)',
    label: 'Label',
    selectLabelPlaceholder: 'Select label…',
    selectLabelAria: 'Select label',
    loadingLabels: 'Loading labels…',
    labelHint: 'All conversations with this label will be added to the sequence.',
    targetSeq: 'Target sequence',
    selectSeqPlaceholder: 'Select sequence…',
    selectSeqAria: 'Select sequence',
    noActiveSeqs: 'No active sequences — enable a sequence first in the "Sequences" tab.',
    bulkWarnContacts: 'contacts with the label',
    bulkWarnReceive: 'will receive the sequence',
    bulkWarnSend: 'This will start sending them WhatsApp messages.',
  },
};

export default function BulkEnrollModal({ open, onClose, accountId, sequences, onDone }) {
  const t = useT(M);
  const [labels, setLabels] = useState([]);
  const [label, setLabel] = useState('');
  const [seqKey, setSeqKey] = useState('');
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // טעינת התוויות בכל פתיחה (איפוס מצב)
  useEffect(() => {
    if (!open || accountId == null) return;
    setLoadingLabels(true);
    setError('');
    setResult(null);
    setLabel('');
    setSeqKey('');
    listLabels(accountId)
      .then(setLabels)
      .catch((e) => setError(e.message || translate(M, 'errLoadLabels')))
      .finally(() => setLoadingLabels(false));
  }, [open, accountId]);

  const enabledSeqs = useMemo(() => (sequences || []).filter((s) => s.enabled), [sequences]);
  const selectedLabel = labels.find((l) => l.label === label);
  const selectedSeq = enabledSeqs.find((s) => s.key === seqKey);
  const count = selectedLabel?.count || 0;

  const run = async () => {
    if (!label || !seqKey) return;
    setRunning(true);
    setError('');
    try {
      const res = await bulkEnroll(label, seqKey, accountId);
      setResult(res);
      onDone?.();
    } catch (e) {
      setError(e.message || translate(M, 'errAssign'));
    } finally {
      setRunning(false);
    }
  };

  const labelOptions = [
    { value: '', label: t('selectLabelOption') },
    ...labels.map((l) => ({ value: l.label, label: `${l.label} (${l.count})` })),
  ];
  const seqOptions = [
    { value: '', label: t('selectSeqOption') },
    ...enabledSeqs.map((s) => ({ value: s.key, label: s.name || s.key })),
  ];

  const footer = result ? (
    <Button variant="solid" color="blue" onClick={onClose}>{t('close')}</Button>
  ) : (
    <>
      <Button variant="ghost" color="slate" onClick={onClose} disabled={running}>
        {t('cancel')}
      </Button>
      <Button
        variant="solid"
        color="blue"
        icon={Send}
        onClick={run}
        loading={running}
        disabled={!label || !seqKey || count === 0}
      >
        {t('assign')} {count > 0 ? t('contactsN', { count }) : ''}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      variant="center"
      size="md"
      footer={footer}
    >
      {result ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-teal-3 text-n-teal-11">
            <Users size={24} aria-hidden="true" />
          </span>
          <p className="text-base font-medium text-n-slate-12">
            {t('assignedResult', { count: result.count })}
          </p>
          <p className="text-sm text-n-slate-11">
            {t('sendingSoon')}
            {result.total > result.count ? t('failedSuffix', { failed: result.total - result.count }) : ''}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-n-ruby-7 bg-n-ruby-3 px-3 py-2 text-sm text-n-ruby-11">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
              <Tag size={14} className="text-n-slate-10" aria-hidden="true" /> {t('label')}
            </p>
            <Dropdown
              value={label}
              onChange={setLabel}
              options={labelOptions}
              disabled={loadingLabels}
              placeholder={t('selectLabelPlaceholder')}
              ariaLabel={t('selectLabelAria')}
            />
            <p className="mt-1 text-xs text-n-slate-11">
              {loadingLabels ? t('loadingLabels') : t('labelHint')}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-n-slate-12">{t('targetSeq')}</p>
            <Dropdown
              value={seqKey}
              onChange={setSeqKey}
              options={seqOptions}
              placeholder={t('selectSeqPlaceholder')}
              ariaLabel={t('selectSeqAria')}
            />
            {enabledSeqs.length === 0 ? (
              <p className="mt-1 text-xs text-n-amber-11">
                {t('noActiveSeqs')}
              </p>
            ) : null}
          </div>

          {label && seqKey && count > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-n-amber-7 bg-n-amber-3 px-3 py-2.5 text-sm text-n-amber-12">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-n-amber-11" aria-hidden="true" />
              <span>
                <strong>{count}</strong> {t('bulkWarnContacts')} "{label}" {t('bulkWarnReceive')} "
                {selectedSeq?.name}". {t('bulkWarnSend')}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
