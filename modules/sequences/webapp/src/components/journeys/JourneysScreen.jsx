import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Play,
  Pause,
  Activity,
  AlertCircle,
  Copy,
  ShieldAlert,
  Workflow,
  RefreshCw,
} from 'lucide-react';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import ConfirmDialog from '../ui/ConfirmDialog.jsx';
import Skeleton, { SkeletonRows } from '../ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table.jsx';
import { useToast } from '../ui/Toast.jsx';
import RunsModal from './RunsModal.jsx';
import { validateGraph } from './graphModel.js';
import { listJourneys, getJourney, deleteJourney, setJourneyStatus, saveJourney } from '../../api/journeysApi.js';
import useT from '../../useT.js';
import { translate } from '../../i18n.js';

/*
 * JourneysScreen — the "בונה פלואו" tab: list ↔ editor toggle (same pattern as
 * TemplatesScreen in App.jsx). The visual editor (React Flow) is heavy, so it
 * is lazy-loaded — the main bundle stays lean until someone actually edits.
 */

const JourneyEditor = lazy(() => import('./JourneyEditor.jsx'));

const M = {
  he: {
    title: 'בונה פלואו',
    newJourney: 'פלואו חדש',
    refresh: 'רענון',
    forbiddenTitle: 'העמוד זמין למנהלי חשבון בלבד',
    forbiddenBody: 'רק מנהלי חשבון, ונציגים שמנהל/ת הרשה/תה להם, יכולים לנהל פלואו.',
    errLoad: 'שגיאה בטעינת הפלואו',
    retry: 'נסה שוב',
    errStatus: 'עדכון הסטטוס נכשל',
    errDelete: 'המחיקה נכשלה',
    errOpen: 'טעינת הפלואו נכשלה',
    notReady: 'הפלואו לא מוכן להפעלה ({n} שגיאות) — פתחו אותו לעריכה לפרטים',
    activated: 'הפלואו הופעל',
    pausedToast: 'הפלואו הושהה',
    colName: 'שם',
    colStatus: 'סטטוס',
    colNodes: 'צמתים',
    colRuns: 'ריצות',
    colActions: 'פעולות',
    liveRuns: '{n} פעילות',
    doneRuns: '{n} הושלמו',
    status_draft: 'טיוטה',
    status_active: 'פעיל',
    status_paused: 'מושהה',
    editAria: 'עריכת {name}',
    activateAria: 'הפעלת {name}',
    pauseAria: 'השהיית {name}',
    runsAria: 'ריצות של {name}',
    deleteAria: 'מחיקת {name}',
    duplicateAria: 'שכפול {name}',
    duplicated: 'הפלואו שוכפל כטיוטה',
    errDuplicate: 'השכפול נכשל',
    copySuffix: '— עותק',
    deleteTitle: 'מחיקת פלואו',
    deleteBody: 'למחוק את "{name}"? הריצות וההיסטוריה שלו יימחקו. פעולה זו אינה ניתנת לשחזור.',
    delete: 'מחיקה',
    pauseTitle: 'השהיית פלואו',
    pauseBody: 'לפלואו "{name}" יש {n} ריצות פעילות — ההשהיה תעצור אותן. להמשיך?',
    pauseConfirm: 'השהיה',
    emptyTitle: 'אין עדיין פלואו',
    emptyBody:
      'פלואו הוא בוט ויזואלי: טריגר (שיחה חדשה / מילת מפתח) מפעיל גרף של הודעות, שאלות ותנאים — התשובות נשמרות לשדות של איש הקשר, ובסוף אפשר להעביר לנציג.',
  },
  en: {
    title: 'Flow Builder',
    newJourney: 'New flow',
    refresh: 'Refresh',
    forbiddenTitle: 'This page is available to account administrators only',
    forbiddenBody: 'Only account administrators, and agents an administrator granted access to, can manage flows.',
    errLoad: 'Failed to load flows',
    retry: 'Retry',
    errStatus: 'Failed to update status',
    errDelete: 'Delete failed',
    errOpen: 'Failed to open the flow',
    notReady: 'The flow is not ready to activate ({n} issues) — open it in the editor for details',
    activated: 'Flow activated',
    pausedToast: 'Flow paused',
    colName: 'Name',
    colStatus: 'Status',
    colNodes: 'Nodes',
    colRuns: 'Runs',
    colActions: 'Actions',
    liveRuns: '{n} live',
    doneRuns: '{n} done',
    status_draft: 'Draft',
    status_active: 'Active',
    status_paused: 'Paused',
    editAria: 'Edit {name}',
    activateAria: 'Activate {name}',
    pauseAria: 'Pause {name}',
    runsAria: 'Runs of {name}',
    deleteAria: 'Delete {name}',
    duplicateAria: 'Duplicate {name}',
    duplicated: 'Flow duplicated as a draft',
    errDuplicate: 'Duplicate failed',
    copySuffix: '— copy',
    deleteTitle: 'Delete flow',
    deleteBody: 'Delete "{name}"? Its runs and history will be removed. This cannot be undone.',
    delete: 'Delete',
    pauseTitle: 'Pause flow',
    pauseBody: '"{name}" has {n} live runs — pausing will stop them. Continue?',
    pauseConfirm: 'Pause',
    emptyTitle: 'No flows yet',
    emptyBody:
      'A flow is a visual bot: a trigger (new conversation / keyword) starts a graph of messages, questions and conditions — answers are saved to contact fields, and the flow can hand off to an agent.',
  },
};

const STATUS_COLOR = { draft: 'slate', active: 'teal', paused: 'amber' };

function EditorFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-9 w-full max-w-sm rounded-lg" />
      <Skeleton className="h-[460px] w-full rounded-xl" />
    </div>
  );
}

export default function JourneysScreen({ accountId }) {
  const t = useT(M); // also subscribes the screen to live locale switches
  const { toast } = useToast();

  const [rows, setRows] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [screen, setScreen] = useState({ mode: 'list' }); // {mode:'editor', journey:null|{...}}
  const [busyId, setBusyId] = useState(null); // row with an in-flight action
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [pauseTarget, setPauseTarget] = useState(null);
  const [runsTarget, setRunsTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    if (accountId == null) return;
    setRows(null);
    setError('');
    setForbidden(false);
    listJourneys(accountId)
      .then((list) => setRows(list || []))
      .catch((e) => {
        if (e.forbidden) setForbidden(true);
        else setError(e.message || translate(M, 'errLoad'));
        setRows([]);
      });
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  const mergeRow = (j, extra = {}) =>
    setRows((rs) => (rs || []).map((r) => (r.id === j.id ? { ...r, ...j, ...extra } : r)));

  const openNew = () => setScreen({ mode: 'editor', journey: null });

  // List rows come without the graph — fetch the full journey before editing.
  const openEdit = async (row) => {
    setBusyId(row.id);
    setError('');
    try {
      const full = await getJourney(accountId, row.id);
      setScreen({ mode: 'editor', journey: full });
    } catch (e) {
      setError(e.message || translate(M, 'errOpen'));
    } finally {
      setBusyId(null);
    }
  };

  // Activation from the list still validates the graph (same rules as the editor).
  const activate = async (row) => {
    setBusyId(row.id);
    setError('');
    try {
      const full = await getJourney(accountId, row.id);
      const errs = validateGraph(full.graph);
      if (errs.length) {
        toast({ message: t('notReady', { n: errs.length }), variant: 'error' });
        return;
      }
      const j = await setJourneyStatus(accountId, row.id, 'active');
      mergeRow({ id: row.id, status: j.status });
      toast({ message: t('activated'), variant: 'success' });
    } catch (e) {
      setError(e.message || translate(M, 'errStatus'));
    } finally {
      setBusyId(null);
    }
  };

  const pause = async (row) => {
    setPauseTarget(null);
    setBusyId(row.id);
    setError('');
    try {
      const j = await setJourneyStatus(accountId, row.id, 'paused');
      // Pausing stops live runs engine-side — reflect it without a reload.
      mergeRow({ id: row.id, status: j.status }, { live_runs: 0 });
      toast({ message: t('pausedToast'), variant: 'success' });
    } catch (e) {
      setError(e.message || translate(M, 'errStatus'));
    } finally {
      setBusyId(null);
    }
  };

  // שכפול: טוענים את הפלואו המלא ושומרים עותק חדש כטיוטה (בלי id — save יוצר).
  const duplicate = async (row) => {
    setBusyId(row.id);
    setError('');
    try {
      const full = await getJourney(accountId, row.id);
      await saveJourney(accountId, {
        name: `${row.name} ${t('copySuffix')}`,
        trigger: full.trigger || {},
        graph: full.graph,
      });
      toast({ message: t('duplicated'), variant: 'success' });
      load();
    } catch (e) {
      setError(e.message || translate(M, 'errDuplicate'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    try {
      await deleteJourney(accountId, deleteTarget.id);
      setRows((rs) => (rs || []).filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e.message || translate(M, 'errDelete'));
    } finally {
      setDeleting(false);
    }
  };

  // ── Editor screen ──
  if (screen.mode === 'editor') {
    return (
      <Suspense fallback={<EditorFallback />}>
        <JourneyEditor
          accountId={accountId}
          journey={screen.journey}
          onBack={() => {
            setScreen({ mode: 'list' });
            load();
          }}
        />
      </Suspense>
    );
  }

  // ── List screen ──
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

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <Workflow size={15} className="text-n-blue-11" aria-hidden="true" />
          {t('title')}
        </h2>
        <div className="flex items-center gap-2">
          <Button variant="ghost" color="slate" size="sm" icon={RefreshCw} onClick={load}>
            {t('refresh')}
          </Button>
          <Button variant="solid" color="blue" size="sm" icon={Plus} onClick={openNew}>
            {t('newJourney')}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
          <span className="flex items-start gap-2.5">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <Button variant="faded" color="ruby" size="sm" onClick={load}>
            {t('retry')}
          </Button>
        </div>
      ) : null}

      {rows === null ? (
        <SkeletonRows rows={4} cols={5} />
      ) : rows.length === 0 && !error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-16 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-brand/10 text-n-blue-11">
            <Workflow size={24} aria-hidden="true" />
          </span>
          <div>
            <p className="text-base font-medium text-n-slate-12">{t('emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-n-slate-11">{t('emptyBody')}</p>
          </div>
          <Button variant="solid" color="blue" icon={Plus} onClick={openNew}>
            {t('newJourney')}
          </Button>
        </div>
      ) : rows.length > 0 ? (
        <Table>
          <THead>
            <TR>
              <TH>{t('colName')}</TH>
              <TH>{t('colStatus')}</TH>
              <TH>{t('colNodes')}</TH>
              <TH>{t('colRuns')}</TH>
              <TH align="end">{t('colActions')}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD>
                  <span className="font-medium text-n-slate-12">{row.name}</span>
                </TD>
                <TD>
                  <Badge color={STATUS_COLOR[row.status] || 'slate'}>
                    {t(`status_${row.status}`) === `status_${row.status}` ? row.status : t(`status_${row.status}`)}
                  </Badge>
                </TD>
                <TD>
                  <Badge color="blue">{Number(row.node_count) || 0}</Badge>
                </TD>
                <TD>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {Number(row.live_runs) > 0 ? (
                      <Badge color="teal">{t('liveRuns', { n: Number(row.live_runs) })}</Badge>
                    ) : null}
                    <span className="text-xs text-n-slate-11">{t('doneRuns', { n: Number(row.done_runs) || 0 })}</span>
                  </div>
                </TD>
                <TD align="end">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      color="slate"
                      size="sm"
                      iconOnly
                      icon={Pencil}
                      loading={busyId === row.id}
                      aria-label={t('editAria', { name: row.name })}
                      title={t('editAria', { name: row.name })}
                      onClick={() => openEdit(row)}
                    />
                    {row.status === 'active' ? (
                      <Button
                        variant="ghost"
                        color="amber"
                        size="sm"
                        iconOnly
                        icon={Pause}
                        disabled={busyId === row.id}
                        aria-label={t('pauseAria', { name: row.name })}
                        title={t('pauseAria', { name: row.name })}
                        onClick={() => (Number(row.live_runs) > 0 ? setPauseTarget(row) : pause(row))}
                      />
                    ) : (
                      <Button
                        variant="ghost"
                        color="teal"
                        size="sm"
                        iconOnly
                        icon={Play}
                        disabled={busyId === row.id}
                        aria-label={t('activateAria', { name: row.name })}
                        title={t('activateAria', { name: row.name })}
                        onClick={() => activate(row)}
                      />
                    )}
                    <Button
                      variant="ghost"
                      color="slate"
                      size="sm"
                      iconOnly
                      icon={Copy}
                      disabled={busyId === row.id}
                      aria-label={t('duplicateAria', { name: row.name })}
                      title={t('duplicateAria', { name: row.name })}
                      onClick={() => duplicate(row)}
                    />
                    <Button
                      variant="ghost"
                      color="slate"
                      size="sm"
                      iconOnly
                      icon={Activity}
                      aria-label={t('runsAria', { name: row.name })}
                      title={t('runsAria', { name: row.name })}
                      onClick={() => setRunsTarget(row)}
                    />
                    <Button
                      variant="ghost"
                      color="ruby"
                      size="sm"
                      iconOnly
                      icon={Trash2}
                      aria-label={t('deleteAria', { name: row.name })}
                      title={t('deleteAria', { name: row.name })}
                      onClick={() => setDeleteTarget(row)}
                    />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        tone="danger"
        loading={deleting}
        title={t('deleteTitle')}
        description={t('deleteBody', { name: deleteTarget?.name || '' })}
        confirmLabel={t('delete')}
      />

      {/* Pause confirm — only when live runs would be stopped */}
      <ConfirmDialog
        open={!!pauseTarget}
        onClose={() => setPauseTarget(null)}
        onConfirm={() => pause(pauseTarget)}
        tone="warning"
        title={t('pauseTitle')}
        description={t('pauseBody', { name: pauseTarget?.name || '', n: Number(pauseTarget?.live_runs) || 0 })}
        confirmLabel={t('pauseConfirm')}
      />

      <RunsModal
        open={!!runsTarget}
        onClose={() => setRunsTarget(null)}
        journey={runsTarget}
        accountId={accountId}
      />
    </>
  );
}
