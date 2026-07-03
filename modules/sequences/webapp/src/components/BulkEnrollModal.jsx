import { useEffect, useMemo, useState } from 'react';
import { Tag, AlertCircle, Users, Send } from 'lucide-react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import Dropdown from './ui/Dropdown.jsx';
import { listLabels, bulkEnroll } from '../api/sequencesApi.js';

/*
 * BulkEnrollModal — שיוך המוני: כל השיחות עם תווית מסוימת → רצף נבחר.
 * ה-engine כותב את מאפיין `sequence` לכל שיחה; ה-reconciler משייך ושולח בטיק הבא.
 * ⚠️ פעולה ששולחת הודעות להרבה אנשים — אישור מפורש עם ספירה לפני הפעלה.
 */

export default function BulkEnrollModal({ open, onClose, accountId, sequences, onDone }) {
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
      .catch((e) => setError(e.message || 'שגיאה בטעינת התוויות'))
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
      setError(e.message || 'השיוך נכשל');
    } finally {
      setRunning(false);
    }
  };

  const labelOptions = [
    { value: '', label: '— בחרו תווית —' },
    ...labels.map((l) => ({ value: l.label, label: `${l.label} (${l.count})` })),
  ];
  const seqOptions = [
    { value: '', label: '— בחרו רצף —' },
    ...enabledSeqs.map((s) => ({ value: s.key, label: s.name || s.key })),
  ];

  const footer = result ? (
    <Button variant="solid" color="blue" onClick={onClose}>סגירה</Button>
  ) : (
    <>
      <Button variant="ghost" color="slate" onClick={onClose} disabled={running}>
        ביטול
      </Button>
      <Button
        variant="solid"
        color="blue"
        icon={Send}
        onClick={run}
        loading={running}
        disabled={!label || !seqKey || count === 0}
      >
        שייך {count > 0 ? `${count} אנשי קשר` : ''}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="שיוך המוני לפי תווית"
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
            {result.count} אנשי קשר שויכו לרצף
          </p>
          <p className="text-sm text-n-slate-11">
            ההודעות יתחילו להישלח בדקות הקרובות (לפי תזמון הרצף).
            {result.total > result.count ? ` (${result.total - result.count} נכשלו)` : ''}
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
              <Tag size={14} className="text-n-slate-10" aria-hidden="true" /> תווית
            </p>
            <Dropdown
              value={label}
              onChange={setLabel}
              options={labelOptions}
              disabled={loadingLabels}
              placeholder="בחרו תווית…"
              ariaLabel="בחירת תווית"
            />
            <p className="mt-1 text-xs text-n-slate-11">
              {loadingLabels ? 'טוען תוויות…' : 'כל השיחות עם התווית הזו יתווספו לרצף.'}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-medium text-n-slate-12">רצף יעד</p>
            <Dropdown
              value={seqKey}
              onChange={setSeqKey}
              options={seqOptions}
              placeholder="בחרו רצף…"
              ariaLabel="בחירת רצף"
            />
            {enabledSeqs.length === 0 ? (
              <p className="mt-1 text-xs text-n-amber-11">
                אין רצפים פעילים — הפעילו רצף קודם בלשונית "רצפים".
              </p>
            ) : null}
          </div>

          {label && seqKey && count > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-n-amber-7 bg-n-amber-3 px-3 py-2.5 text-sm text-n-amber-12">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-n-amber-11" aria-hidden="true" />
              <span>
                <strong>{count}</strong> אנשי קשר עם התווית "{label}" יקבלו את הרצף "
                {selectedSeq?.name}". הפעולה תתחיל לשלוח להם הודעות WhatsApp.
              </span>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
