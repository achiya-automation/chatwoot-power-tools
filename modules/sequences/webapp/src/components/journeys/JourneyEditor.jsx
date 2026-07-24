import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, ArrowRight, AlertCircle, Save, Play, Pause, Plus } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import { useToast } from '../ui/Toast.jsx';
import Inspector from './Inspector.jsx';
import { nodeTypes, NODE_META } from './JourneyNodes.jsx';
import {
  ADDABLE_TYPES,
  defaultDataFor,
  emptyGraph,
  fromGraph,
  toGraph,
  validateGraph,
  newNodeId,
  collectAttributeKeys,
} from './graphModel.js';
import {
  saveJourney,
  setJourneyStatus,
  getJourneyMeta,
  fetchChatwootMeta,
  ensureAttributeDefinition,
} from '../../api/journeysApi.js';
import useT, { useLocale } from '../../useT.js';
import { translate } from '../../i18n.js';

/*
 * JourneyEditor — the visual flow canvas. Loaded lazily (React.lazy in
 * JourneysScreen) so @xyflow/react stays out of the main bundle.
 *
 * RTL note: React Flow requires LTR coordinates, so the canvas wrapper is
 * dir="ltr" while node content (JourneyNodes) renders dir="rtl". The inspector
 * sits at the start side — visually right in RTL.
 */

const M = {
  he: {
    back: 'חזרה',
    namePh: 'שם הפלואו…',
    save: 'שמירה',
    saved: 'הפלואו נשמר',
    activate: 'הפעלה',
    activated: 'הפלואו הופעל',
    pause: 'השהיה',
    paused: 'הפלואו הושהה',
    dirty: 'שינויים שלא נשמרו',
    addNode: 'הוספת צומת:',
    errSave: 'השמירה נכשלה',
    errStatus: 'עדכון הסטטוס נכשל',
    errorsTitle: 'הפלואו לא מוכן להפעלה:',
    err_name: 'חסר שם לפלואו',
    err_no_start: 'הטריגר לא מחובר לצומת ראשון — גררו קו מהטריגר',
    err_q_text: '{node}: חסר טקסט לשאלה',
    err_q_key: '{node}: חסר שם שדה לשמירת התשובה',
    err_btn_options: '{node}: נדרשות 1-10 אפשרויות עם כיתוב',
    status_draft: 'טיוטה',
    status_active: 'פעיל',
    status_paused: 'מושהה',
    node_trigger: 'טריגר',
    node_message: 'הודעה',
    node_question: 'שאלה',
    node_buttons: 'כפתורים',
    node_condition: 'תנאי',
    node_delay: 'השהיה',
    node_action: 'פעולות',
    node_webhook: 'Webhook',
    node_handoff: 'העברה לנציג',
  },
  en: {
    back: 'Back',
    namePh: 'Flow name…',
    save: 'Save',
    saved: 'Flow saved',
    activate: 'Activate',
    activated: 'Flow activated',
    pause: 'Pause',
    paused: 'Flow paused',
    dirty: 'Unsaved changes',
    addNode: 'Add node:',
    errSave: 'Save failed',
    errStatus: 'Status update failed',
    errorsTitle: 'The flow is not ready to activate:',
    err_name: 'The flow needs a name',
    err_no_start: 'The trigger is not connected to a first node — drag a line from it',
    err_q_text: '{node}: question text is missing',
    err_q_key: '{node}: the answer needs a field key',
    err_btn_options: '{node}: 1-10 options with labels are required',
    status_draft: 'Draft',
    status_active: 'Active',
    status_paused: 'Paused',
    node_trigger: 'Trigger',
    node_message: 'Message',
    node_question: 'Question',
    node_buttons: 'Buttons',
    node_condition: 'Condition',
    node_delay: 'Delay',
    node_action: 'Actions',
    node_webhook: 'Webhook',
    node_handoff: 'Handoff',
  },
};

const STATUS_COLOR = { draft: 'slate', active: 'teal', paused: 'amber' };

// Palette button classes per node color — static strings for Tailwind's scanner.
const PALETTE_CLS = {
  teal: 'bg-n-teal-3 text-n-teal-11 hover:bg-n-teal-4',
  blue: 'bg-n-brand/10 text-n-blue-11 hover:bg-n-brand/20',
  violet: 'bg-n-violet-3 text-n-violet-11 hover:bg-n-violet-4',
  amber: 'bg-n-amber-3 text-n-amber-11 hover:bg-n-amber-4',
  iris: 'bg-n-iris-3 text-n-iris-11 hover:bg-n-iris-4',
  ruby: 'bg-n-ruby-3 text-n-ruby-11 hover:bg-n-ruby-4',
  slate: 'bg-n-alpha-2 text-n-slate-11 hover:bg-n-alpha-3',
};

// Chatwoot's theme is the html.dark class (synced live by main.jsx) — follow it.
function useDarkMode() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark'))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export default function JourneyEditor({ accountId, journey, onBack }) {
  const t = useT(M);
  const locale = useLocale();
  const { toast } = useToast();
  const dark = useDarkMode();
  const BackIcon = locale === 'he' ? ArrowRight : ArrowLeft;

  const initial = useMemo(() => fromGraph(journey?.graph || emptyGraph()), [journey]);
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [jid, setJid] = useState(journey?.id || null);
  const [name, setName] = useState(journey?.name || '');
  const [trigger, setTrigger] = useState(journey?.trigger || {});
  const [status, setStatus] = useState(journey?.status || 'draft');
  const [dirty, setDirty] = useState(!journey?.id); // a brand-new flow starts unsaved
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [errors, setErrors] = useState([]); // [{code, nodeId?}] from validateGraph
  const [apiError, setApiError] = useState('');
  const [meta, setMeta] = useState({ inboxes: [], agents: [], teams: [], labels: [] });

  // Engine meta (inboxes) + Chatwoot session meta (agents/teams/labels) — both best-effort.
  useEffect(() => {
    if (accountId == null) return;
    getJourneyMeta(accountId)
      .then((m) => setMeta((prev) => ({ ...prev, inboxes: m?.inboxes || [] })))
      .catch(() => {});
    fetchChatwootMeta(accountId).then((m) => setMeta((prev) => ({ ...prev, ...m }))).catch(() => {});
  }, [accountId]);

  // 'select' is navigation and 'dimensions' is React Flow measuring nodes on
  // mount — neither is a user edit, so neither may trip the dirty flag.
  const isRealChange = (c) => c.type !== 'select' && c.type !== 'dimensions';

  const onNodesChange = useCallback((changes) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (changes.some(isRealChange)) setDirty(true);
  }, []);

  const onEdgesChange = useCallback((changes) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some(isRealChange)) setDirty(true);
  }, []);

  // One outgoing edge per source handle — the runtime follows exactly one path,
  // so a new connection replaces the previous one. Self-loops are blocked.
  const onConnect = useCallback((conn) => {
    if (conn.source === conn.target) return;
    setEdges((es) =>
      addEdge(
        conn,
        es.filter(
          (e) => !(e.source === conn.source && (e.sourceHandle ?? null) === (conn.sourceHandle ?? null))
        )
      )
    );
    setDirty(true);
  }, []);

  const selectedNode = useMemo(() => nodes.find((n) => n.selected) || null, [nodes]);

  const patchNode = useCallback((id, patch) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    setDirty(true);
  }, []);

  const removeNode = useCallback((id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setDirty(true);
  }, []);

  // New nodes land below the lowest node — predictable in a vertical flow —
  // and the viewport pans there so the node is never added out of sight.
  const rfInstance = useRef(null);
  const addNode = (type) => {
    setNodes((ns) => {
      const maxY = ns.reduce((m, n) => Math.max(m, n.position?.y || 0), 0);
      const position = { x: 220, y: maxY + 170 };
      rfInstance.current?.setCenter(position.x + 110, position.y + 40, {
        zoom: rfInstance.current.getZoom(),
        duration: 250,
      });
      return [
        ...ns.map((n) => ({ ...n, selected: false })),
        {
          id: newNodeId(ns),
          type,
          data: defaultDataFor(type),
          position,
          selected: true,
        },
      ];
    });
    setDirty(true);
  };

  // Field suggestions for condition nodes: saved answer keys + webhook targets + contact basics.
  const fieldSuggestions = useMemo(() => {
    const keys = new Set(['name', 'phone', 'email']);
    for (const n of nodes) {
      const k = n.data?.saveTo?.key;
      if (k) keys.add(String(k).trim());
      if (n.type === 'webhook' && n.data?.saveResponseTo) keys.add(String(n.data.saveResponseTo).trim());
    }
    return [...keys].filter(Boolean);
  }, [nodes]);

  const errorText = (e) => {
    if (e.code === 'name') return t('err_name');
    if (e.code === 'no_start') return t('err_no_start');
    const node = nodes.find((n) => n.id === e.nodeId);
    const label = node ? t(`node_${node.type}`) : e.nodeId;
    return t(`err_${e.code}`, { node: label });
  };

  const focusError = (e) => {
    if (!e.nodeId) return;
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === e.nodeId })));
  };

  const doSave = async () => {
    if (!name.trim()) {
      setErrors([{ code: 'name' }]);
      return null;
    }
    setSaving(true);
    setApiError('');
    try {
      const graph = toGraph(nodes, edges);
      const saved = await saveJourney(accountId, {
        ...(jid ? { id: jid } : {}),
        name: name.trim(),
        trigger,
        graph,
      });
      setJid(saved.id);
      setStatus(saved.status);
      setDirty(false);
      // Best-effort: create the custom attribute definitions behind saveTo keys
      // (admin session; failures are silent — see ensureAttributeDefinition).
      await Promise.all(
        collectAttributeKeys(graph).map(({ key, scope }) => ensureAttributeDefinition(accountId, key, scope))
      );
      toast({ message: t('saved'), variant: 'success' });
      return saved;
    } catch (e) {
      setApiError(e.message || translate(M, 'errSave'));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const doActivate = async () => {
    const errs = validateGraph(toGraph(nodes, edges));
    if (!name.trim()) errs.unshift({ code: 'name' });
    setErrors(errs);
    if (errs.length) return;
    const saved = dirty || !jid ? await doSave() : { id: jid };
    if (!saved) return;
    setStatusBusy(true);
    setApiError('');
    try {
      const j = await setJourneyStatus(accountId, saved.id, 'active');
      setStatus(j.status);
      toast({ message: t('activated'), variant: 'success' });
    } catch (e) {
      setApiError(e.message || translate(M, 'errStatus'));
    } finally {
      setStatusBusy(false);
    }
  };

  const doPause = async () => {
    if (!jid) return;
    setStatusBusy(true);
    setApiError('');
    try {
      const j = await setJourneyStatus(accountId, jid, 'paused');
      setStatus(j.status);
      toast({ message: t('paused'), variant: 'success' });
    } catch (e) {
      setApiError(e.message || translate(M, 'errStatus'));
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" color="slate" size="sm" icon={BackIcon} onClick={() => onBack(true)}>
          {t('back')}
        </Button>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setDirty(true);
          }}
          placeholder={t('namePh')}
          aria-label={t('namePh')}
          className="h-8 grow min-w-40 max-w-xs rounded-lg border border-transparent bg-transparent px-2 text-base font-medium text-n-slate-12 outline-none transition-colors placeholder:text-n-slate-10 hover:border-n-weak focus:border-n-brand"
        />
        <Badge color={STATUS_COLOR[status] || 'slate'}>{t(`status_${status}`)}</Badge>
        {dirty ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-n-amber-11">
            <span className="h-1.5 w-1.5 rounded-full bg-n-amber-9" aria-hidden="true" />
            {t('dirty')}
          </span>
        ) : null}
        <div className="ms-auto flex items-center gap-2">
          <Button variant="faded" color="slate" size="sm" icon={Save} loading={saving} onClick={doSave}>
            {t('save')}
          </Button>
          {status === 'active' ? (
            <Button variant="faded" color="amber" size="sm" icon={Pause} loading={statusBusy} onClick={doPause}>
              {t('pause')}
            </Button>
          ) : (
            <Button variant="solid" color="teal" size="sm" icon={Play} loading={statusBusy} onClick={doActivate}>
              {t('activate')}
            </Button>
          )}
        </div>
      </div>

      {/* API error */}
      {apiError ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{apiError}</span>
        </div>
      ) : null}

      {/* Validation errors — click focuses the offending node */}
      {errors.length ? (
        <div className="rounded-xl border border-n-amber-7 bg-n-amber-3 px-4 py-3 text-sm text-n-amber-11">
          <p className="m-0 mb-1 font-medium">{t('errorsTitle')}</p>
          <ul className="m-0 list-disc ps-5">
            {errors.map((e, i) => (
              <li key={`${e.code}-${e.nodeId || i}`}>
                {e.nodeId ? (
                  <button type="button" className="underline hover:no-underline" onClick={() => focusError(e)}>
                    {errorText(e)}
                  </button>
                ) : (
                  errorText(e)
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Node palette */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-n-slate-11">{t('addNode')}</span>
        {ADDABLE_TYPES.map((type) => {
          const meta_ = NODE_META[type];
          const Icon = meta_.icon;
          return (
            <button
              key={type}
              type="button"
              onClick={() => addNode(type)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${PALETTE_CLS[meta_.color]}`}
            >
              <Plus size={11} aria-hidden="true" />
              <Icon size={13} aria-hidden="true" />
              {t(`node_${type}`)}
            </button>
          );
        })}
      </div>

      {/* Inspector (start side — right in RTL) + canvas */}
      <div className="flex gap-3 h-[calc(100vh-330px)] min-h-[460px]">
        <aside className="w-80 shrink-0 overflow-y-auto rounded-xl border border-n-weak bg-n-solid-2 p-4 shadow-sm">
          <Inspector
            node={selectedNode}
            name={name}
            onName={(v) => {
              setName(v);
              setDirty(true);
            }}
            trigger={trigger}
            onTrigger={(v) => {
              setTrigger(v);
              setDirty(true);
            }}
            patchNode={patchNode}
            removeNode={removeNode}
            meta={meta}
            fieldSuggestions={fieldSuggestions}
          />
        </aside>
        {/* React Flow needs LTR coordinates — content inside nodes is RTL */}
        <div dir="ltr" className="grow overflow-hidden rounded-xl border border-n-weak bg-n-solid-1 shadow-sm">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onInit={(inst) => { rfInstance.current = inst; }}
            colorMode={dark ? 'dark' : 'light'}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
    </div>
  );
}
