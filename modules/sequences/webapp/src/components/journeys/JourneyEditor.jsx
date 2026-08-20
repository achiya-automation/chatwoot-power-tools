import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Save,
  Play,
  Pause,
  Route,
} from 'lucide-react';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import { useToast } from '../ui/Toast.jsx';
import Inspector from './Inspector.jsx';
import JourneyColumn from './JourneyColumn.jsx';
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
  moveStepTo,
  outlineLayout,
  outlineToEdges,
  replaceStepType,
  removeStep,
  setBranchEnds,
  stepFor,
  stepIds,
  toOutline,
} from '../../lib/journeyOutline.js';
import useT, { useLocale } from '../../useT.js';
import { translate } from '../../i18n.js';

/*
 * JourneyEditor — one macro-style builder, matching Chatwoot's native macro
 * editor. The saved runtime format remains a graph, but users edit a vertical
 * action list: ordinary flows branch inline; legacy free-form graphs expose
 * explicit route selectors inside the same cards. No canvas or map view exists.
 */

const M = {
  he: {
    back: 'חזרה',
    save: 'שמירה',
    saved: 'הפלואו נשמר',
    activate: 'הפעלה',
    activated: 'הפלואו הופעל',
    pause: 'השהיה',
    paused: 'הפלואו הושהה',
    dirty: 'שינויים שלא נשמרו',
    editorTitle: 'עריכת פלואו',
    freeRoutesTitle: 'חיבורים חופשיים',
    freeRoutesHint: 'הפלואו הזה נבנה בעבר עם חיבורים מורכבים. כל היכולות נשמרו, והיעד של כל מסלול מופיע עכשיו בתוך הכרטיס שלו.',
    confirmTypeChange: 'שינוי סוג הצעד יאפס את התוכן שהוזן בו. להמשיך?',
    confirmTypeBranchChange: 'שינוי סוג הצעד יאפס את התוכן וימחק את הצעדים שנמצאים במסלולים שלו. להמשיך?',
    confirmTypeRouteChange: 'שינוי סוג הצעד יאפס את התוכן ואת החיבורים שיוצאים ממנו. צמתי היעד עצמם יישארו. להמשיך?',
    confirmOptionBranchDelete: 'האפשרות הזו כוללת צעדים במסלול משלה. מחיקתה תמחק גם אותם. להמשיך?',
    confirmForkDelete: 'מחיקת הצומת תמחק גם את כל הצעדים במסלולים שיוצאים ממנו. להמשיך?',
    errSave: 'השמירה נכשלה',
    errStatus: 'עדכון הסטטוס נכשל',
    errorsTitle: 'הפלואו לא מוכן להפעלה:',
    err_name: 'חסר שם לפלואו',
    err_no_start: 'לא נבחר צעד ראשון לפלואו',
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
    save: 'Save',
    saved: 'Flow saved',
    activate: 'Activate',
    activated: 'Flow activated',
    pause: 'Pause',
    paused: 'Flow paused',
    dirty: 'Unsaved changes',
    editorTitle: 'Edit flow',
    freeRoutesTitle: 'Free-form routes',
    freeRoutesHint: 'This flow was previously built with complex connections. Every capability is preserved, and each path target is now edited inside its action card.',
    confirmTypeChange: 'Changing the step type will reset its contents. Continue?',
    confirmTypeBranchChange: 'Changing the step type will reset its contents and delete the steps inside its paths. Continue?',
    confirmTypeRouteChange: 'Changing the step type will reset its contents and outgoing routes. Destination steps will remain. Continue?',
    confirmOptionBranchDelete: 'This option has steps on its own path. Deleting it also deletes those steps. Continue?',
    confirmForkDelete: 'Deleting this node also deletes every step on its outgoing paths. Continue?',
    errSave: 'Save failed',
    errStatus: 'Status update failed',
    errorsTitle: 'The flow is not ready to activate:',
    err_name: 'The flow needs a name',
    err_no_start: 'Choose a first step for the flow',
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

export default function JourneyEditor({ accountId, journey, onBack }) {
  const t = useT(M);
  const locale = useLocale();
  const { toast } = useToast();
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

  const applyOutline = useCallback((nextSteps, nextNodes) => {
    const positions = outlineLayout(nextSteps, { triggerId });
    setNodes(nextNodes.map((node) => ({
      ...node,
      ...(positions[String(node.id)] ? { position: positions[String(node.id)] } : {}),
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
    if (outline.ok && current.type === 'buttons' && 'options' in patch) {
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
        applyOutline(reconciled.steps, nextNodes);
        return;
      }
    }

    // A legacy free-form graph keeps its topology explicit. When a button
    // option is removed, only that option's route disappears; the destination
    // node is preserved because another route may still use it.
    if (!outline.ok && current.type === 'buttons' && 'options' in patch) {
      const liveHandles = new Set((stepFor(updated).branches || []).map((branch) => branch.handle));
      setEdges((currentEdges) => currentEdges.filter((edge) =>
        String(edge.source) !== String(id)
          || edge.sourceHandle == null
          || liveHandles.has(String(edge.sourceHandle))
      ));
    }

    setNodes((ns) => ns.map((node) => (String(node.id) === String(id) ? updated : node)));
    markDirty();
  }, [applyOutline, markDirty, nodes, outline, t]);

  const insertColumnNode = useCallback((location, type) => {
    if (!outline.ok) return;
    const id = newNodeId(nodes);
    const node = {
      id,
      type,
      data: defaultDataFor(type),
      position: { x: 0, y: 0 },
    };
    const nextSteps = insertStep(outline.steps, location, stepFor(node));
    applyOutline(nextSteps, [...nodes, node]);
  }, [applyOutline, nodes, outline]);

  const deleteColumnNode = useCallback((id) => {
    if (!outline.ok) return;
    const step = findOutlineStep(outline.steps, id);
    const hasNestedSteps = (step?.branches || []).some((branch) => branch.steps.length);
    if (hasNestedSteps && !window.confirm(t('confirmForkDelete'))) return;
    const nextSteps = removeStep(outline.steps, String(id));
    const keep = new Set([String(triggerId), ...stepIds(nextSteps)]);
    const nextNodes = nodes.filter((node) => keep.has(String(node.id)));
    applyOutline(nextSteps, nextNodes);
  }, [applyOutline, nodes, outline, t, triggerId]);

  const moveColumnNode = useCallback((id, delta) => {
    if (!outline.ok) return;
    const nextSteps = moveStep(outline.steps, String(id), delta);
    applyOutline(nextSteps, nodes);
  }, [applyOutline, nodes, outline]);

  const moveColumnNodeTo = useCallback((id, targetIndex) => {
    if (!outline.ok) return;
    const nextSteps = moveStepTo(outline.steps, String(id), targetIndex);
    applyOutline(nextSteps, nodes);
  }, [applyOutline, nodes, outline]);

  // The original macro editor changes an action type from the select inside
  // each card. Do the same here, while explicitly guarding the extra data that
  // a journey step can own (nested paths and graph routes).
  const changeNodeType = useCallback((id, type) => {
    if (!ADDABLE_TYPES.includes(type)) return;
    const current = nodes.find((node) => String(node.id) === String(id));
    if (!current || current.type === type) return;
    const updated = { ...current, type, data: defaultDataFor(type) };

    if (outline.ok) {
      const changed = replaceStepType(outline.steps, String(id), stepFor(updated));
      const message = changed.removedIds.length ? t('confirmTypeBranchChange') : t('confirmTypeChange');
      if (!window.confirm(message)) return;
      const removed = new Set(changed.removedIds.map(String));
      const nextNodes = nodes
        .filter((node) => !removed.has(String(node.id)))
        .map((node) => (String(node.id) === String(id) ? updated : node));
      applyOutline(changed.steps, nextNodes);
      return;
    }

    const outgoing = edges.filter((edge) => String(edge.source) === String(id));
    if (!window.confirm(outgoing.length ? t('confirmTypeRouteChange') : t('confirmTypeChange'))) return;
    const continuation = outgoing.find((edge) => edge.sourceHandle == null)?.target || outgoing[0]?.target || null;
    setNodes((currentNodes) => currentNodes.map((node) => (String(node.id) === String(id) ? updated : node)));
    setEdges((currentEdges) => {
      const kept = currentEdges.filter((edge) => String(edge.source) !== String(id));
      if (!continuation || type === 'handoff') return kept;
      const edgeFor = (handle) => ({
        id: `e_${id}_${handle || 'out'}_${continuation}`,
        source: String(id),
        target: String(continuation),
        sourceHandle: handle,
      });
      if (type === 'condition') return [...kept, edgeFor('yes'), edgeFor('no')];
      return [...kept, edgeFor(null)];
    });
    markDirty();
  }, [applyOutline, edges, markDirty, nodes, outline, t]);

  const setColumnBranchEnds = useCallback((nodeId, handle, ends) => {
    if (!outline.ok) return;
    applyOutline(setBranchEnds(outline.steps, String(nodeId), handle, ends), nodes);
  }, [applyOutline, nodes, outline]);

  // Free-form compatibility: old graphs remain fully editable as macro cards.
  // Reordering changes display order only; route selectors own execution order.
  const insertRawNode = useCallback((type) => {
    setNodes((current) => {
      const id = newNodeId(current);
      return [...current, {
        id,
        type,
        data: defaultDataFor(type),
        position: { x: 0, y: current.length * 130 },
      }];
    });
    markDirty();
  }, [markDirty]);

  const deleteRawNode = useCallback((id) => {
    const hasOutgoing = edges.some((edge) => String(edge.source) === String(id));
    if (hasOutgoing && !window.confirm(t('confirmForkDelete'))) return;
    setNodes((current) => current.filter((node) => String(node.id) !== String(id)));
    setEdges((current) => current.filter(
      (edge) => String(edge.source) !== String(id) && String(edge.target) !== String(id)
    ));
    markDirty();
  }, [edges, markDirty, t]);

  const moveRawNode = useCallback((id, targetIndex) => {
    setNodes((current) => {
      const triggerNodes = current.filter((node) => node.type === 'trigger');
      const raw = current.filter((node) => node.type !== 'trigger');
      const from = raw.findIndex((node) => String(node.id) === String(id));
      if (from < 0) return current;
      const to = Math.max(0, Math.min(Number(targetIndex) || 0, raw.length - 1));
      if (from === to) return current;
      const [node] = raw.splice(from, 1);
      raw.splice(to, 0, node);
      return [...triggerNodes, ...raw.map((item, index) => ({
        ...item,
        position: { x: item.position?.x || 0, y: (index + 1) * 130 },
      }))];
    });
    markDirty();
  }, [markDirty]);

  const routeNode = useCallback(({ source, sourceHandle, edgeId, target }) => {
    setEdges((current) => {
      if (edgeId) {
        if (target == null) return current.filter((edge) => String(edge.id) !== String(edgeId));
        return current.map((edge) => String(edge.id) === String(edgeId)
          ? { ...edge, target: String(target) }
          : edge);
      }
      if (target == null) return current;
      return [...current, {
        id: `e_${source}_${sourceHandle || 'out'}_${target}`,
        source: String(source),
        target: String(target),
        sourceHandle: sourceHandle ?? null,
      }];
    });
    markDirty();
  }, [markDirty]);

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
    const card = document.getElementById(`journey-node-${e.nodeId}`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requestAnimationFrame(() => card?.querySelector('input, textarea, select, button')?.focus());
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

  const triggerNode = nodes.find((node) => node.type === 'trigger') || null;
  const errorIds = new Set(errors.map((error) => String(error.nodeId || '')).filter(Boolean));

  return (
    <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-4 pb-8">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Button variant="ghost" color="slate" size="sm" icon={BackIcon} onClick={handleBack}>
          {t('back')}
        </Button>
        <h2 className="m-0 text-base font-semibold text-n-slate-12">{name.trim() || t('editorTitle')}</h2>
        <Badge color={STATUS_COLOR[status] || 'slate'}>{t(`status_${status}`)}</Badge>
        {dirty ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-n-amber-11">
            <span className="h-1.5 w-1.5 rounded-full bg-n-amber-9" aria-hidden="true" />
            {t('dirty')}
          </span>
        ) : null}
      </div>

      {/* API error */}
      {apiError ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{apiError}</span>
        </div>
      ) : null}

      {/* Validation errors — click focuses the offending node */}
      {errors.length ? (
        <div role="alert" aria-live="polite" className="rounded-xl border border-n-amber-7 bg-n-amber-3 px-4 py-3 text-sm text-n-amber-11">
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

      {/* Same two-column composition as Chatwoot's MacroForm.vue. */}
      <div className="flex min-h-[620px] w-full flex-col lg:min-h-[calc(100vh-230px)] lg:flex-row">
        <main className="min-w-0 flex-1 overflow-y-auto bg-[radial-gradient(#ebf0f5_1.2px,transparent_0)] px-6 py-4 [background-size:1rem_1rem] dark:bg-[radial-gradient(#293f51_1.2px,transparent_0)] ltr:pl-12 ltr:pr-6 rtl:pl-6 rtl:pr-12">
          {!outline.ok ? (
            <div className="mb-5 flex max-w-[800px] items-start gap-2 rounded-md bg-n-alpha-1 p-2 text-sm text-n-slate-11 dark:bg-n-solid-3">
              <Route size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <strong className="font-medium text-n-slate-12">{t('freeRoutesTitle')}:</strong>{' '}
                {t('freeRoutesHint')}
              </span>
            </div>
          ) : null}
          <JourneyColumn
            steps={outline.ok ? outline.steps : null}
            nodes={nodes}
            edges={edges}
            errorIds={errorIds}
            onInsert={insertColumnNode}
            onDelete={deleteColumnNode}
            onMove={moveColumnNode}
            onMoveTo={moveColumnNodeTo}
            onRawInsert={insertRawNode}
            onRawDelete={deleteRawNode}
            onRawMove={moveRawNode}
            onRoute={routeNode}
            onChangeType={changeNodeType}
            onSetBranchEnds={setColumnBranchEnds}
            patchNode={patchNode}
            meta={meta}
            fieldSuggestions={fieldSuggestions}
            vars={vars}
            accountId={accountId}
          />
        </main>

        <aside className="w-full shrink-0 pb-4 lg:w-1/3">
          <div className="flex h-full flex-col rounded-lg border border-n-weak bg-n-solid-2 p-4 shadow-sm">
            <Inspector
              node={triggerNode}
              name={name}
              onName={(value) => {
                setName(value);
                markDirty();
              }}
              trigger={trigger}
              onTrigger={(value) => {
                setTrigger(value);
                markDirty();
              }}
              patchNode={patchNode}
              removeNode={() => {}}
              meta={meta}
              fieldSuggestions={fieldSuggestions}
              vars={vars}
              accountId={accountId}
            />
            <div className="mt-4 flex flex-col gap-2 border-t border-n-weak pt-4">
              <Button className="w-full" variant="solid" color="blue" size="md" icon={Save} loading={saving} onClick={doSave}>
                {t('save')}
              </Button>
              {status === 'active' ? (
                <Button className="w-full" variant="faded" color="amber" size="md" icon={Pause} loading={statusBusy} onClick={doPause}>
                  {t('pause')}
                </Button>
              ) : (
                <Button className="w-full" variant="solid" color="teal" size="md" icon={Play} loading={statusBusy} disabled={saving} onClick={doActivate}>
                  {t('activate')}
                </Button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
