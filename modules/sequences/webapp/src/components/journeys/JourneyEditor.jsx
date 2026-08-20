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
import {
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Save,
  Play,
  Pause,
  Plus,
  ListTree,
  Workflow,
} from 'lucide-react';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import { useToast } from '../ui/Toast.jsx';
import Inspector from './Inspector.jsx';
import JourneyColumn from './JourneyColumn.jsx';
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
import { listTemplates } from '../../api/sequencesApi.js';
import {
  insertStep,
  moveStep,
  outlineLayout,
  outlineToEdges,
  removeStep,
  stepFor,
  stepIds,
  toOutline,
} from '../../lib/journeyOutline.js';
import useT, { useLocale } from '../../useT.js';
import { translate } from '../../i18n.js';

/*
 * JourneyEditor — a canvas-first flow editor with the macro-style list retained
 * as an optional accessibility and compact-reading view. Loaded lazily so
 * @xyflow/react stays out of the main bundle.
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
    viewSelector: 'בחירת תצוגת הפלואו',
    columnView: 'רשימה',
    mapView: 'קנבס',
    columnViewAria: 'תצוגת רשימה קומפקטית בסגנון המאקרו',
    mapViewAria: 'תצוגת קנבס חזותית עם צמתים וחיבורים',
    columnUnavailable: 'הפלואו הזה כולל מבנה שניתן לערוך רק במפה.',
    columnUnavailable_cycle: 'יש בפלואו לולאה, ולכן הוא מוצג במפה.',
    columnUnavailable_orphan: 'יש בפלואו צומת מנותק, ולכן הוא מוצג במפה.',
    columnUnavailable_converge: 'יש בפלואו חיבור מסלולים מורכב, ולכן הוא מוצג במפה.',
    columnUnavailable_unsupported: 'יש בפלואו חיבור שאינו מתאים לתצוגת טור, ולכן הוא מוצג במפה.',
    confirmOptionBranchDelete: 'האפשרות הזו כוללת צעדים במסלול משלה. מחיקתה תמחק גם אותם. להמשיך?',
    confirmForkDelete: 'מחיקת הצומת תמחק גם את כל הצעדים במסלולים שיוצאים ממנו. להמשיך?',
    errSave: 'השמירה נכשלה',
    errStatus: 'עדכון הסטטוס נכשל',
    errorsTitle: 'הפלואו לא מוכן להפעלה:',
    err_name: 'חסר שם לפלואו',
    err_no_start: 'הטריגר לא מחובר לצומת ראשון — גררו קו מהטריגר',
    err_q_text: '{node}: חסר טקסט לשאלה',
    err_q_key: '{node}: חסר שם שדה לשמירת התשובה',
    err_btn_options: '{node}: נדרשות 1-10 אפשרויות עם כיתוב',
    err_cond_branch: '{node}: חברו גם את "כן" וגם את "לא" ליעד',
    err_wh_url: '{node}: חסרה כתובת URL תקינה (https://…)',
    err_tpl_name: '{node}: לא נבחרה תבנית',
    err_tpl_key: '{node}: חסר שם שדה לשמירת התגובה לתבנית',
    confirmLeave: 'יש שינויים שלא נשמרו. לצאת בלי לשמור?',
    status_draft: 'טיוטה',
    status_active: 'פעיל',
    status_paused: 'מושהה',
    node_trigger: 'טריגר',
    node_message: 'הודעה',
    node_private_reply: 'הודעה פרטית למגיב',
    node_template: 'תבנית וואטסאפ',
    node_question: 'שאלה',
    node_buttons: 'כפתורים',
    node_condition: 'תנאי',
    node_delay: 'השהיה',
    node_action: 'פעולות',
    node_webhook: 'Webhook',
    node_handoff: 'העברה לנציג',
    var_name: 'שם איש הקשר',
    var_phone: 'טלפון',
    var_email: 'מייל',
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
    viewSelector: 'Flow view selector',
    columnView: 'List',
    mapView: 'Canvas',
    columnViewAria: 'Compact macro-style list view',
    mapViewAria: 'Visual canvas with nodes and connections',
    columnUnavailable: 'This flow has a structure that can only be edited on the map.',
    columnUnavailable_cycle: 'This flow contains a loop, so it is shown on the map.',
    columnUnavailable_orphan: 'This flow contains a disconnected node, so it is shown on the map.',
    columnUnavailable_converge: 'This flow has a complex path merge, so it is shown on the map.',
    columnUnavailable_unsupported: 'This flow contains a connection that cannot be represented in a column.',
    confirmOptionBranchDelete: 'This option has steps on its own path. Deleting it also deletes those steps. Continue?',
    confirmForkDelete: 'Deleting this node also deletes every step on its outgoing paths. Continue?',
    errSave: 'Save failed',
    errStatus: 'Status update failed',
    errorsTitle: 'The flow is not ready to activate:',
    err_name: 'The flow needs a name',
    err_no_start: 'The trigger is not connected to a first node — drag a line from it',
    err_q_text: '{node}: question text is missing',
    err_q_key: '{node}: the answer needs a field key',
    err_btn_options: '{node}: 1-10 options with labels are required',
    err_cond_branch: '{node}: connect both the "yes" and "no" outputs',
    err_wh_url: '{node}: a valid URL is required (https://…)',
    err_tpl_name: '{node}: no template selected',
    err_tpl_key: '{node}: the template reply needs a field key',
    confirmLeave: 'You have unsaved changes. Leave without saving?',
    status_draft: 'Draft',
    status_active: 'Active',
    status_paused: 'Paused',
    node_trigger: 'Trigger',
    node_message: 'Message',
    node_private_reply: 'Private reply to commenter',
    node_template: 'WhatsApp template',
    node_question: 'Question',
    node_buttons: 'Buttons',
    node_condition: 'Condition',
    node_delay: 'Delay',
    node_action: 'Actions',
    node_webhook: 'Webhook',
    node_handoff: 'Handoff',
    var_name: 'Contact name',
    var_phone: 'Phone',
    var_email: 'Email',
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

// Keep the branch contents that still have a matching option handle. When an
// option is removed, its nested steps become unreachable and are returned so
// the caller can remove those graph nodes together with the option.
function reconcileForkBranches(steps, nodeId, handles) {
  let changed = false;
  let removedIds = [];
  const wanted = new Set(handles || []);
  const walk = (list) => list.map((step) => {
    if (!step.branches) return step;
    if (String(step.id) === String(nodeId)) {
      const byHandle = new Map(step.branches.map((branch) => [branch.handle, branch]));
      const removed = step.branches.filter((branch) => !wanted.has(branch.handle));
      removedIds = removedIds.concat(removed.flatMap((branch) => stepIds(branch.steps)));
      changed = true;
      return {
        ...step,
        branches: handles.map((handle) =>
          byHandle.get(handle) || { handle, steps: [], ends: false }
        ),
      };
    }
    const branches = step.branches.map((branch) => ({
      ...branch,
      steps: walk(branch.steps),
    }));
    return changed ? { ...step, branches } : step;
  });
  const next = walk(steps);
  return { steps: changed ? next : steps, removedIds };
}

function findOutlineStep(steps, nodeId) {
  for (const step of steps || []) {
    if (String(step.id) === String(nodeId)) return step;
    for (const branch of step.branches || []) {
      const found = findOutlineStep(branch.steps, nodeId);
      if (found) return found;
    }
  }
  return null;
}

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

  const initial = useMemo(() => {
    const g = fromGraph(journey?.graph || emptyGraph());
    // גרף שנשמר בלי טריגר (למשל דרך API) — משחזרים את העוגן; בלעדיו אין לאן לחבר התחלה.
    if (!g.nodes.some((n) => n.type === 'trigger')) {
      g.nodes.unshift({ id: 'trigger', type: 'trigger', data: {}, position: { x: 260, y: 40 }, deletable: false });
    }
    return g;
  }, [journey]);
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [viewMode, setViewMode] = useState('map');
  const [jid, setJid] = useState(journey?.id || null);
  const [name, setName] = useState(journey?.name || '');
  // פלואו חדש נולד עם הפעלה-ידנית דלוקה — אחרת אין לו שום טריגר פעיל.
  const [trigger, setTrigger] = useState(journey?.trigger || { manual: true });
  const [status, setStatus] = useState(journey?.status || 'draft');
  const [dirty, setDirty] = useState(!journey?.id); // a brand-new flow starts unsaved
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [errors, setErrors] = useState([]); // [{code, nodeId?}] from validateGraph
  const [apiError, setApiError] = useState('');
  const [meta, setMeta] = useState({ inboxes: [], agents: [], teams: [], labels: [], attrDefs: [], templates: [] });

  // Every real edit bumps this. doSave captures it at start and only clears `dirty`
  // if nothing changed while the request was in flight — so an edit made mid-save
  // isn't mistaken for "saved". markDirty is stable, safe to omit from deps.
  const editVersion = useRef(0);
  const markDirty = useCallback(() => {
    editVersion.current += 1;
    setDirty(true);
  }, []);

  const outline = useMemo(() => toOutline({ nodes, edges }), [nodes, edges]);
  const triggerId = outline.ok
    ? outline.triggerId
    : String(nodes.find((node) => node.type === 'trigger')?.id || 'trigger');

  // Engine meta (inboxes + WhatsApp templates) + Chatwoot session meta (agents/teams/
  // labels/attr definitions) — all best-effort: the editor works with empty pickers.
  useEffect(() => {
    if (accountId == null) return;
    getJourneyMeta(accountId)
      .then((m) => setMeta((prev) => ({ ...prev, inboxes: m?.inboxes || [] })))
      .catch(() => {});
    fetchChatwootMeta(accountId).then((m) => setMeta((prev) => ({ ...prev, ...m }))).catch(() => {});
    listTemplates(accountId)
      .then((tpls) => setMeta((prev) => ({ ...prev, templates: tpls || [] })))
      .catch(() => {});
  }, [accountId]);

  // Native safety net for a browser tab close/refresh with unsaved changes
  // (in-app "back" is guarded separately by handleBack).
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // 'select' is navigation and 'dimensions' is React Flow measuring nodes on
  // mount — neither is a user edit, so neither may trip the dirty flag.
  const isRealChange = (c) => c.type !== 'select' && c.type !== 'dimensions';

  const onNodesChange = useCallback((changes) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (changes.some(isRealChange)) markDirty();
  }, [markDirty]);

  const onEdgesChange = useCallback((changes) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some(isRealChange)) markDirty();
  }, [markDirty]);

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
    markDirty();
  }, [markDirty]);

  const selectedNode = useMemo(() => nodes.find((n) => n.selected) || null, [nodes]);

  const selectNode = useCallback((id) => {
    setNodes((ns) => ns.map((node) => ({
      ...node,
      selected: String(node.id) === String(id),
    })));
  }, []);

  const applyOutline = useCallback((nextSteps, nextNodes, selectedId) => {
    const positions = outlineLayout(nextSteps, { triggerId });
    setNodes(nextNodes.map((node) => ({
      ...node,
      ...(positions[String(node.id)] ? { position: positions[String(node.id)] } : {}),
      selected: selectedId != null && String(node.id) === String(selectedId),
    })));
    setEdges(outlineToEdges(nextSteps, { triggerId }));
    markDirty();
  }, [markDirty, triggerId]);

  const patchNode = useCallback((id, patch) => {
    const current = nodes.find((node) => String(node.id) === String(id));
    if (!current) return;
    const updated = { ...current, data: { ...current.data, ...patch } };

    // Adding/removing a button option also adds/removes its visual branch. Keep
    // the graph and macro-style outline in lockstep so no stray edge silently
    // sends a reply down the wrong path.
    if (viewMode === 'column' && outline.ok && current.type === 'buttons' && 'options' in patch) {
      const currentStep = findOutlineStep(outline.steps, id);
      const currentHandles = (currentStep?.branches || []).map((branch) => branch.handle);
      const nextHandles = (stepFor(updated).branches || []).map((branch) => branch.handle);
      const handlesChanged = currentHandles.length !== nextHandles.length
        || currentHandles.some((handle, index) => handle !== nextHandles[index]);
      if (handlesChanged) {
        const reconciled = reconcileForkBranches(outline.steps, id, nextHandles);
        if (reconciled.removedIds.length && !window.confirm(t('confirmOptionBranchDelete'))) return;
        const removed = new Set(reconciled.removedIds.map(String));
        const nextNodes = nodes
          .filter((node) => !removed.has(String(node.id)))
          .map((node) => (String(node.id) === String(id) ? updated : node));
        applyOutline(reconciled.steps, nextNodes, id);
        return;
      }
    }

    setNodes((ns) => ns.map((node) => (String(node.id) === String(id) ? updated : node)));
    markDirty();
  }, [applyOutline, markDirty, nodes, outline, t, viewMode]);

  const removeNode = useCallback((id) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    markDirty();
  }, [markDirty]);

  const insertColumnNode = useCallback((location, type) => {
    if (!outline.ok) return;
    const id = newNodeId(nodes);
    const node = {
      id,
      type,
      data: defaultDataFor(type),
      position: { x: 0, y: 0 },
      selected: true,
    };
    const nextSteps = insertStep(outline.steps, location, stepFor(node));
    applyOutline(nextSteps, [...nodes, node], id);
  }, [applyOutline, nodes, outline]);

  const deleteColumnNode = useCallback((id) => {
    if (!outline.ok) return;
    const step = findOutlineStep(outline.steps, id);
    const hasNestedSteps = (step?.branches || []).some((branch) => branch.steps.length);
    if (hasNestedSteps && !window.confirm(t('confirmForkDelete'))) return;
    const nextSteps = removeStep(outline.steps, String(id));
    const keep = new Set([String(triggerId), ...stepIds(nextSteps)]);
    const nextNodes = nodes.filter((node) => keep.has(String(node.id)));
    applyOutline(nextSteps, nextNodes, triggerId);
  }, [applyOutline, nodes, outline, t, triggerId]);

  const moveColumnNode = useCallback((id, delta) => {
    if (!outline.ok) return;
    const nextSteps = moveStep(outline.steps, String(id), delta);
    applyOutline(nextSteps, nodes, selectedNode?.id || triggerId);
  }, [applyOutline, nodes, outline, selectedNode?.id, triggerId]);

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
    markDirty();
  };

  // Field suggestions for condition nodes: saved answer keys + webhook targets +
  // contact basics + the account's custom-attribute definitions.
  const fieldSuggestions = useMemo(() => {
    const keys = new Set(['name', 'phone', 'email']);
    for (const n of nodes) {
      const k = n.data?.saveTo?.key;
      if (k) keys.add(String(k).trim());
      if (n.type === 'webhook' && n.data?.saveResponseTo) keys.add(String(n.data.saveResponseTo).trim());
    }
    for (const def of meta.attrDefs || []) {
      if (def?.attribute_key) keys.add(String(def.attribute_key).trim());
    }
    return [...keys].filter(Boolean);
  }, [nodes, meta.attrDefs]);

  // בורר המשתנים: בסיס (שם/טלפון/מייל) → שדות מותאמים של איש הקשר (מההגדרות של
  // Chatwoot, עם השם היפה שלהם) → תשובות שהפלואו הזה אוסף.
  const vars = useMemo(() => {
    const out = [
      { key: 'שם', label: t('var_name') },
      { key: 'טלפון', label: t('var_phone') },
      { key: 'מייל', label: t('var_email') },
    ];
    const seen = new Set(out.map((v) => v.key));
    const push = (key, label) => {
      const k = String(key || '').trim();
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push({ key: k, label: label || '' });
    };
    for (const def of meta.attrDefs || []) {
      if (def?.attribute_model === 'contact_attribute') push(def.attribute_key, def.attribute_display_name);
    }
    for (const n of nodes) {
      push(n.data?.saveTo?.key);
      if (n.type === 'webhook') push(n.data?.saveResponseTo);
    }
    return out;
  }, [nodes, meta.attrDefs, t]);

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
    const versionAtSave = editVersion.current;
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
      // Only clear the dirty flag if nothing was edited while the save was in flight.
      if (editVersion.current === versionAtSave) setDirty(false);
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

  // Back guards unsaved work — the one exit point where edits could be silently lost.
  const handleBack = () => {
    if (dirty && !window.confirm(t('confirmLeave'))) return;
    onBack();
  };

  const columnUnavailableText = outline.ok
    ? ''
    : t(`columnUnavailable_${outline.reason || 'unsupported'}`) || t('columnUnavailable');

  const viewButtonClass = (active) => [
    'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium outline-none transition-colors',
    'focus-visible:outline-2 focus-visible:outline-n-brand focus-visible:outline-offset-1 motion-reduce:transition-none',
    active
      ? 'bg-n-background text-n-slate-12 shadow-sm dark:bg-n-solid-1'
      : 'text-n-slate-11 hover:bg-n-alpha-2 hover:text-n-slate-12',
  ].join(' ');

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" color="slate" size="sm" icon={BackIcon} onClick={handleBack}>
          {t('back')}
        </Button>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            markDirty();
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
        <div
          role="group"
          aria-label={t('viewSelector')}
          className="inline-flex rounded-lg border border-n-weak bg-n-solid-2 p-0.5"
        >
          <button
            type="button"
            aria-pressed={viewMode === 'column'}
            aria-label={t('columnViewAria')}
            title={columnUnavailableText || t('columnViewAria')}
            disabled={!outline.ok}
            onClick={() => setViewMode('column')}
            className={`${viewButtonClass(viewMode === 'column')} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <ListTree size={14} aria-hidden="true" />
            {t('columnView')}
          </button>
          <button
            type="button"
            aria-pressed={viewMode === 'map'}
            aria-label={t('mapViewAria')}
            onClick={() => setViewMode('map')}
            className={viewButtonClass(viewMode === 'map')}
          >
            <Workflow size={14} aria-hidden="true" />
            {t('mapView')}
          </button>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="faded" color="slate" size="sm" icon={Save} loading={saving} onClick={doSave}>
            {t('save')}
          </Button>
          {status === 'active' ? (
            <Button variant="faded" color="amber" size="sm" icon={Pause} loading={statusBusy} onClick={doPause}>
              {t('pause')}
            </Button>
          ) : (
            <Button variant="solid" color="teal" size="sm" icon={Play} loading={statusBusy} disabled={saving} onClick={doActivate}>
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

      {/* The primary canvas keeps a free-position palette; the list inserts steps in place. */}
      {viewMode === 'map' ? (
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
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-n-brand focus-visible:outline-offset-1 motion-reduce:transition-none ${PALETTE_CLS[meta_.color]}`}
              >
                <Plus size={11} aria-hidden="true" />
                <Icon size={13} aria-hidden="true" />
                {t(`node_${type}`)}
              </button>
            );
          })}
        </div>
      ) : null}

      {!outline.ok ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-n-blue-7 bg-n-blue-3 px-4 py-3 text-sm text-n-blue-11">
          <Workflow size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{columnUnavailableText}</span>
        </div>
      ) : null}

      {/* Canvas-first flow surface + fixed properties panel. */}
      <div className="flex min-h-[560px] flex-col overflow-hidden rounded-xl border border-n-weak bg-n-solid-1 shadow-sm lg:h-[calc(100vh-300px)] lg:flex-row">
        <aside className="order-2 max-h-[46vh] w-full shrink-0 overflow-y-auto border-t border-n-weak bg-n-solid-2 p-4 lg:order-1 lg:max-h-none lg:w-[22rem] lg:border-e lg:border-t-0">
          <Inspector
            node={selectedNode}
            name={name}
            onName={(v) => {
              setName(v);
              markDirty();
            }}
            trigger={trigger}
            onTrigger={(v) => {
              setTrigger(v);
              markDirty();
            }}
            patchNode={patchNode}
            removeNode={viewMode === 'column' ? deleteColumnNode : removeNode}
            meta={meta}
            fieldSuggestions={fieldSuggestions}
            vars={vars}
            accountId={accountId}
          />
        </aside>
        {viewMode === 'column' && outline.ok ? (
          <div className="order-1 min-h-[34rem] min-w-0 grow overflow-y-auto bg-[radial-gradient(#ebf0f5_1.2px,transparent_0)] px-4 py-6 [background-size:1rem_1rem] dark:bg-[radial-gradient(#293f51_1.2px,transparent_0)] md:px-8 lg:order-2 lg:min-h-0 lg:px-10">
            <JourneyColumn
              steps={outline.steps}
              nodes={nodes}
              selectedId={selectedNode?.id || triggerId}
              startId={triggerId}
              errorIds={new Set(errors.map((error) => String(error.nodeId || '')).filter(Boolean))}
              onSelect={selectNode}
              onSelectStart={() => selectNode(triggerId)}
              onInsert={insertColumnNode}
              onDelete={deleteColumnNode}
              onMove={moveColumnNode}
            />
          </div>
        ) : (
          /* React Flow needs LTR coordinates — content inside nodes is RTL. */
          <div dir="ltr" className="order-1 h-[34rem] min-w-0 grow overflow-hidden bg-n-solid-1 lg:order-2 lg:h-auto">
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
              deleteKeyCode={['Backspace', 'Delete']}
              proOptions={{ hideAttribution: false }}
            >
              <Background gap={16} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        )}
      </div>
    </div>
  );
}
