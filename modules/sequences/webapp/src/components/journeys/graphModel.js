/*
 * graphModel — pure graph helpers for the Flow Builder (journeys) editor.
 *
 * React-Flow-free on purpose: node --test imports this directly (no DOM, no
 * canvas). Everything the editor serializes MUST match what the engine runtime
 * executes (modules/sequences/engine/src/journeys.js):
 *
 *   graph = { nodes: [{id, type, data, position}], edges: [{id, source, target, sourceHandle}] }
 *   node types: trigger | message | question | buttons | condition | delay |
 *               action | webhook | handoff
 *   condition edges carry sourceHandle 'yes'/'no'; every other edge keeps
 *   sourceHandle null (the engine's nextNodeId falls back to the null-handle edge).
 *
 * `position` is kept in the saved graph for the editor only — the runtime ignores it.
 */

export const NODE_TYPES = [
  'trigger', 'message', 'private_reply', 'template', 'question', 'buttons', 'condition', 'delay', 'action', 'webhook', 'handoff',
];

// Types the palette can add (exactly one trigger exists, created by emptyGraph).
export const ADDABLE_TYPES = NODE_TYPES.filter((t) => t !== 'trigger');

export const VALIDATIONS = ['text', 'number', 'email', 'phone'];
export const CONDITION_OPS = ['eq', 'contains', 'exists'];
export const GIVEUP_MODES = ['continue', 'stop', 'handoff'];
export const MAX_BUTTON_OPTIONS = 10;

/** Editor defaults for a freshly added node — field names mirror executeFrom/feedAnswer. */
export function defaultDataFor(type) {
  switch (type) {
    case 'message':
      return { text: '', mediaUrl: '' };
    // Private Reply — הודעה פרטית למי שהגיב על פוסט. אין mediaUrl: Meta מתירה
    // הודעה אחת בלבד לכל תגובה, ומדיה מצריכה קריאה שנייה.
    case 'private_reply':
      return { text: '' };
    case 'template':
      // WhatsApp template message — the only first message allowed outside the 24h window.
      return {
        name: '',
        language: '',
        category: '',
        params: [],
        mediaUrl: '',
        waitForReply: false,
        saveTo: { scope: 'contact', key: '' },
        validation: 'text',
        retryMessage: '',
      };
    case 'question':
      return {
        text: '',
        validation: 'text',
        saveTo: { scope: 'contact', key: '' },
        retryMessage: '',
        followUp: null,
      };
    case 'buttons':
      // id from birth — ButtonsNode renders a per-option branching handle only for
      // options that have one, and nothing normalizes editor state before save.
      return {
        text: '',
        options: [{ title: '', id: 'o1' }],
        saveTo: { scope: 'contact', key: '' },
        retryMessage: '',
        followUp: null,
      };
    case 'condition':
      return { field: '', op: 'eq', value: '' };
    case 'delay':
      return { minutes: 0, hours: 1, days: 0 };
    case 'action':
      return { labels: [], assigneeId: null, teamId: null, status: '', webhookUrl: '' };
    case 'webhook':
      return { url: '', saveResponseTo: '' };
    case 'handoff':
      return { message: '', assigneeId: null, teamId: null };
    default:
      return {}; // trigger — its config lives on journey.trigger, not node data
  }
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// Chatwoot ids come back from <select> as strings — the engine expects numbers or null.
const idOrNull = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const normSaveTo = (s) => ({
  scope: s?.scope === 'conversation' ? 'conversation' : 'contact',
  key: String(s?.key || '').trim(),
});

const normFollowUp = (f) => {
  if (!f) return null;
  return {
    afterMinutes: num(f.afterMinutes),
    message: String(f.message || ''),
    maxRetries: num(f.maxRetries) || 1,
    onGiveUp: GIVEUP_MODES.includes(f.onGiveUp) ? f.onGiveUp : 'continue',
  };
};

// Empty-string `value` must be OMITTED: the engine resolves `o.value ?? o.title`,
// and '' is not nullish — it would win over the title and save an empty answer.
// `id` is the option's stable identity for per-option branching (sourceHandle `opt:<id>`)
// — it must survive normalization or every saved graph would orphan its option edges.
const normOption = (o) => {
  const out = { title: String(o?.title || '').trim() };
  const v = String(o?.value ?? '').trim();
  if (v) out.value = v;
  if (o?.id != null && String(o.id).trim()) out.id = String(o.id).trim();
  return out;
};

/** Next free option id (o1, o2, …) within one buttons node — stable across delete/re-add. */
export function newOptionId(options) {
  let max = 0;
  for (const o of options || []) {
    const m = /^o(\d+)$/.exec(String(o?.id || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `o${max + 1}`;
}

// Legacy graphs have options without ids — backfill so per-option handles can be wired.
const withOptionIds = (options) => {
  const out = (Array.isArray(options) ? options : []).map((o) => ({ ...o }));
  for (const o of out) {
    if (o.id == null || !String(o.id).trim()) o.id = newOptionId(out);
  }
  return out;
};

/** Coerce editor state into the exact shapes the runtime reads. */
export function normalizeData(type, d = {}) {
  switch (type) {
    case 'message':
      return { text: String(d.text || ''), mediaUrl: String(d.mediaUrl || '').trim() };
    case 'private_reply':
      return { text: String(d.text || '') };
    case 'template':
      return {
        name: String(d.name || '').trim(),
        language: String(d.language || '').trim(),
        category: String(d.category || '').trim(),
        params: (Array.isArray(d.params) ? d.params : []).map((p) => String(p ?? '')),
        mediaUrl: String(d.mediaUrl || '').trim(),
        waitForReply: !!d.waitForReply,
        saveTo: normSaveTo(d.saveTo),
        validation: VALIDATIONS.includes(d.validation) ? d.validation : 'text',
        retryMessage: String(d.retryMessage || ''),
      };
    case 'question':
      return {
        text: String(d.text || ''),
        validation: VALIDATIONS.includes(d.validation) ? d.validation : 'text',
        saveTo: normSaveTo(d.saveTo),
        retryMessage: String(d.retryMessage || ''),
        followUp: normFollowUp(d.followUp),
      };
    case 'buttons':
      return {
        text: String(d.text || ''),
        options: withOptionIds((Array.isArray(d.options) ? d.options : []).map(normOption)),
        saveTo: normSaveTo(d.saveTo),
        retryMessage: String(d.retryMessage || ''),
        followUp: normFollowUp(d.followUp),
      };
    case 'condition':
      return {
        field: String(d.field || '').trim(),
        op: CONDITION_OPS.includes(d.op) ? d.op : 'eq',
        value: String(d.value ?? ''),
      };
    case 'delay':
      return { minutes: num(d.minutes), hours: num(d.hours), days: num(d.days) };
    case 'action':
      return {
        labels: (Array.isArray(d.labels) ? d.labels : []).map((s) => String(s).trim()).filter(Boolean),
        assigneeId: idOrNull(d.assigneeId),
        teamId: idOrNull(d.teamId),
        status: String(d.status || ''),
        webhookUrl: String(d.webhookUrl || '').trim(),
      };
    case 'webhook':
      return { url: String(d.url || '').trim(), saveResponseTo: String(d.saveResponseTo || '').trim() };
    case 'handoff':
      return { message: String(d.message || ''), assigneeId: idOrNull(d.assigneeId), teamId: idOrNull(d.teamId) };
    default:
      return {};
  }
}

/** Serialize editor state → the graph jsonb the engine executes. */
export function toGraph(rfNodes, rfEdges) {
  const nodes = (rfNodes || []).map((n) => ({
    id: String(n.id),
    type: n.type,
    data: normalizeData(n.type, n.data),
    position: { x: Math.round(n.position?.x || 0), y: Math.round(n.position?.y || 0) },
  }));
  // Option handles that no longer exist (option deleted/renumbered) must not survive:
  // the runtime falls back on stray edges and would route the flow the wrong way.
  const optionIds = new Map(
    nodes.filter((n) => n.type === 'buttons')
      .map((n) => [n.id, new Set((n.data.options || []).map((o) => `opt:${o.id}`))])
  );
  const edges = (rfEdges || [])
    .filter((e) => {
      const h = e.sourceHandle ?? null;
      if (h == null || !String(h).startsWith('opt:')) return true;
      const live = optionIds.get(String(e.source));
      return !!live && live.has(String(h));
    })
    .map((e) => ({
      id: String(e.id || `e_${e.source}_${e.sourceHandle || 'out'}_${e.target}`),
      source: String(e.source),
      target: String(e.target),
      sourceHandle: e.sourceHandle ?? null,
    }));
  return { nodes, edges };
}

// Grid fallback for graphs saved without positions (e.g. seeded manually).
const autoPos = (i) => ({ x: 120 + (i % 3) * 300, y: 60 + Math.floor(i / 3) * 200 });

/** Deserialize a saved graph → editor nodes/edges. */
export function fromGraph(graph) {
  const nodes = (graph?.nodes || []).map((n, i) => ({
    id: String(n.id),
    type: n.type,
    // buttons: legacy options get ids at load so per-option handles render and connect.
    data: n.type === 'buttons'
      ? { ...(n.data || {}), options: withOptionIds(n.data?.options) }
      : (n.data || {}),
    position:
      n.position && Number.isFinite(Number(n.position.x)) && Number.isFinite(Number(n.position.y))
        ? { x: Number(n.position.x), y: Number(n.position.y) }
        : autoPos(i),
    // Exactly one trigger per journey — it anchors startNodeOf, so it can't be deleted.
    ...(n.type === 'trigger' ? { deletable: false } : {}),
  }));
  const edges = (graph?.edges || []).map((e, i) => ({
    id: String(e.id || `e${i}`),
    source: String(e.source),
    target: String(e.target),
    // Keep null handles absent in editor state; toGraph restores an explicit
    // null and round-trips stay clean.
    ...(e.sourceHandle != null ? { sourceHandle: String(e.sourceHandle) } : {}),
  }));
  return { nodes, edges };
}

/** A brand-new journey graph: just the trigger anchor. */
export function emptyGraph() {
  return {
    nodes: [{ id: 'trigger', type: 'trigger', data: {}, position: { x: 260, y: 40 } }],
    edges: [],
  };
}

/** Next free node id (n1, n2, …) — stable across delete/re-add. */
export function newNodeId(nodes) {
  let max = 0;
  for (const n of nodes || []) {
    const m = /^n(\d+)$/.exec(String(n.id));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n${max + 1}`;
}

/**
 * Mirror of the engine's startNodeOf (journeys.js) — kept in sync by the
 * round-trip test. Used only for validation ("does the flow have a reachable start?").
 */
export function startNodeOf(graph) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const trigger = nodes.find((n) => n.type === 'trigger');
  if (trigger) {
    const e = edges.find((x) => x.source === trigger.id);
    return e ? e.target : null;
  }
  const hasIncoming = new Set(edges.map((e) => e.target));
  return nodes.find((n) => !hasIncoming.has(n.id))?.id || nodes[0]?.id || null;
}

/**
 * Pre-activation validation. Returns [{code, nodeId?}] — empty array = ready.
 * Codes (translated to Hebrew/English by the editor):
 *   no_start    — no trigger-reachable start node
 *   q_text      — question/buttons node with empty prompt text
 *   q_key       — question/buttons node without saveTo.key
 *   btn_options — buttons node without 1-10 non-empty options
 *   wh_url      — webhook node with an empty/invalid URL
 *   tpl_name    — template node without a chosen template
 *   tpl_key     — reply-waiting template node without saveTo.key
 */
export function validateGraph(graph) {
  const errors = [];
  if (!startNodeOf(graph)) errors.push({ code: 'no_start' });
  for (const n of graph?.nodes || []) {
    const d = n.data || {};
    if (n.type === 'question' || n.type === 'buttons') {
      if (!String(d.text || '').trim()) errors.push({ code: 'q_text', nodeId: n.id });
      if (!String(d.saveTo?.key || '').trim()) errors.push({ code: 'q_key', nodeId: n.id });
    }
    if (n.type === 'buttons') {
      const opts = Array.isArray(d.options) ? d.options : [];
      const bad = opts.length < 1 || opts.length > MAX_BUTTON_OPTIONS
        || opts.some((o) => !String(o?.title || '').trim());
      if (bad) errors.push({ code: 'btn_options', nodeId: n.id });
    }
    // An unconnected condition branch is an intentional terminal path in the
    // macro editor. nextNodeId only falls back to an explicit default edge, so
    // a missing yes/no edge now ends safely instead of leaking into the other path.
    // The webhook node calls its URL unconditionally per contact — an empty URL
    // throws on every run. Require a real http(s) URL.
    if (n.type === 'webhook') {
      if (!/^https?:\/\/\S+/i.test(String(d.url || '').trim())) errors.push({ code: 'wh_url', nodeId: n.id });
    }
    // A template node without a chosen template fails on every send.
    if (n.type === 'template') {
      if (!String(d.name || '').trim()) errors.push({ code: 'tpl_name', nodeId: n.id });
      if (d.waitForReply && !String(d.saveTo?.key || '').trim()) {
        errors.push({ code: 'tpl_key', nodeId: n.id });
      }
    }
  }
  return errors;
}

/**
 * All custom-attribute keys the flow saves answers into, deduped —
 * [{key, scope}] for best-effort definition creation on save.
 */
export function collectAttributeKeys(graph) {
  const seen = new Set();
  const out = [];
  for (const n of graph?.nodes || []) {
    const savesAnswer = n.type === 'question'
      || n.type === 'buttons'
      || (n.type === 'template' && !!n.data?.waitForReply);
    if (!savesAnswer) continue;
    const key = String(n.data?.saveTo?.key || '').trim();
    if (!key) continue;
    const scope = n.data?.saveTo?.scope === 'conversation' ? 'conversation' : 'contact';
    const sig = `${scope}:${key}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push({ key, scope });
  }
  return out;
}
