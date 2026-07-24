import { useCallback, useEffect, useState } from 'react';
import { OctagonX, AlertCircle } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import Badge from '../ui/Badge.jsx';
import Button from '../ui/Button.jsx';
import { SkeletonRows } from '../ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table.jsx';
import { listJourneyRuns, stopJourneyRun } from '../../api/journeysApi.js';
import useT, { useLocale } from '../../useT.js';

/*
 * RunsModal — the latest runs of one journey: conversation, run status, the
 * collected answers (pretty JSON) and last update. Live runs can be stopped.
 */

const M = {
  he: {
    title: 'ריצות — {name}',
    colConv: 'שיחה',
    colStatus: 'סטטוס',
    colAnswers: 'תשובות',
    colUpdated: 'עדכון אחרון',
    colActions: '',
    empty: 'אין עדיין ריצות לפלואו הזה.',
    stop: 'עצירת הריצה',
    errLoad: 'שגיאה בטעינת הריצות',
    errStop: 'עצירת הריצה נכשלה',
    st_active: 'פעילה',
    st_waiting_answer: 'ממתינה לתשובה',
    st_waiting_delay: 'בהשהיה',
    st_done: 'הושלמה',
    st_stopped: 'נעצרה',
    st_human_handled: 'נציג השתלט',
    st_failed: 'נכשלה',
  },
  en: {
    title: 'Runs — {name}',
    colConv: 'Conversation',
    colStatus: 'Status',
    colAnswers: 'Answers',
    colUpdated: 'Last update',
    colActions: '',
    empty: 'No runs for this flow yet.',
    stop: 'Stop run',
    errLoad: 'Failed to load runs',
    errStop: 'Failed to stop the run',
    st_active: 'Active',
    st_waiting_answer: 'Waiting for answer',
    st_waiting_delay: 'Delayed',
    st_done: 'Done',
    st_stopped: 'Stopped',
    st_human_handled: 'Agent took over',
    st_failed: 'Failed',
  },
};

const LIVE = new Set(['active', 'waiting_answer', 'waiting_delay']);
const STATUS_COLOR = {
  active: 'blue',
  waiting_answer: 'amber',
  waiting_delay: 'slate',
  done: 'teal',
  stopped: 'slate',
  human_handled: 'slate',
  failed: 'ruby',
};

export default function RunsModal({ open, onClose, journey, accountId }) {
  const t = useT(M);
  const locale = useLocale();
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState('');
  const [stoppingId, setStoppingId] = useState(null);

  const fmt = (iso) =>
    iso ? new Date(iso).toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB') : '—';

  const load = useCallback(() => {
    if (!open || !journey) return;
    setRuns(null);
    setError('');
    listJourneyRuns(accountId, journey.id)
      .then((rows) => setRuns(rows || []))
      .catch((e) => {
        setError(e.message || t('errLoad'));
        setRuns([]);
      });
  }, [open, journey, accountId]); // t is stable enough for error copy — not a dep

  useEffect(() => {
    load();
  }, [load]);

  const stop = async (run) => {
    setStoppingId(run.id);
    setError('');
    try {
      await stopJourneyRun(accountId, run.id);
      setRuns((rs) => (rs || []).map((r) => (r.id === run.id ? { ...r, status: 'stopped' } : r)));
    } catch (e) {
      setError(e.message || t('errStop'));
    } finally {
      setStoppingId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('title', { name: journey?.name || '' })} size="lg">
      {error ? (
        <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {runs === null ? (
        <SkeletonRows rows={4} cols={4} />
      ) : runs.length === 0 ? (
        <p className="py-8 text-center text-sm text-n-slate-11">{t('empty')}</p>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>{t('colConv')}</TH>
              <TH>{t('colStatus')}</TH>
              <TH>{t('colAnswers')}</TH>
              <TH>{t('colUpdated')}</TH>
              <TH align="end">{t('colActions')}</TH>
            </TR>
          </THead>
          <TBody>
            {runs.map((run) => {
              const answers = run.answers && Object.keys(run.answers).length ? run.answers : null;
              return (
                <TR key={run.id}>
                  <TD>
                    <span className="font-mono text-xs text-n-slate-12">#{run.display_id}</span>
                  </TD>
                  <TD>
                    <div className="flex flex-col gap-1">
                      <Badge color={STATUS_COLOR[run.status] || 'slate'}>
                        {t(`st_${run.status}`) === `st_${run.status}` ? run.status : t(`st_${run.status}`)}
                      </Badge>
                      {run.last_error ? (
                        <span className="text-[10px] text-n-ruby-11">{run.last_error}</span>
                      ) : null}
                    </div>
                  </TD>
                  <TD>
                    {answers ? (
                      <pre
                        dir="ltr"
                        className="m-0 max-h-28 max-w-xs overflow-auto whitespace-pre-wrap rounded-lg bg-n-alpha-2 p-2 font-mono text-[11px] leading-snug text-n-slate-11"
                      >
                        {JSON.stringify(answers, null, 1)}
                      </pre>
                    ) : (
                      <span className="text-xs text-n-slate-10">—</span>
                    )}
                  </TD>
                  <TD>
                    <span className="text-xs text-n-slate-11">{fmt(run.updated_at)}</span>
                  </TD>
                  <TD align="end">
                    {LIVE.has(run.status) ? (
                      <Button
                        variant="ghost"
                        color="ruby"
                        size="sm"
                        iconOnly
                        icon={OctagonX}
                        loading={stoppingId === run.id}
                        aria-label={t('stop')}
                        title={t('stop')}
                        onClick={() => stop(run)}
                      />
                    ) : null}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Modal>
  );
}
