import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDABLE_TYPES,
  NODE_TYPES,
  defaultDataFor,
  emptyGraph,
  fromGraph,
  toGraph,
  normalizeData,
  validateGraph,
  newNodeId,
  newOptionId,
  startNodeOf,
  collectAttributeKeys,
} from '../src/components/journeys/graphModel.js';

// ---------------------------------------------------------------------------
// node types — must match the engine runtime's switch (engine/src/journeys.js)
// ---------------------------------------------------------------------------

test('node type set matches the engine runtime', () => {
  assert.deepEqual(NODE_TYPES, [
    'trigger', 'message', 'private_reply', 'template', 'question', 'buttons', 'condition', 'delay', 'action', 'webhook', 'handoff',
  ]);
  assert.ok(!ADDABLE_TYPES.includes('trigger')); // exactly one trigger, not addable
});

test('defaultDataFor covers every addable type with engine-shaped fields', () => {
  assert.deepEqual(defaultDataFor('message'), { text: '', mediaUrl: '' });
  assert.deepEqual(defaultDataFor('template'), {
    name: '', language: '', category: '', params: [], mediaUrl: '',
    waitForReply: false,
    saveTo: { scope: 'contact', key: '' },
    validation: 'text',
    retryMessage: '',
  });
  assert.equal(defaultDataFor('question').saveTo.scope, 'contact');
  assert.equal(defaultDataFor('question').validation, 'text');
  assert.equal(defaultDataFor('buttons').options.length, 1);
  assert.equal(defaultDataFor('buttons').options[0].id, 'o1'); // id מלידה — ה-handle פר-אפשרות תלוי בו
  assert.deepEqual(defaultDataFor('condition'), { field: '', op: 'eq', value: '' });
  assert.deepEqual(defaultDataFor('delay'), { minutes: 0, hours: 1, days: 0 });
  assert.deepEqual(defaultDataFor('webhook'), { url: '', saveResponseTo: '' });
  assert.equal(defaultDataFor('handoff').assigneeId, null);
  assert.deepEqual(defaultDataFor('trigger'), {});
});

// ---------------------------------------------------------------------------
// toGraph — serialization the runtime executes
// ---------------------------------------------------------------------------

test('toGraph: single-source edges keep sourceHandle null; condition edges keep yes/no', () => {
  const nodes = [
    { id: 'trigger', type: 'trigger', data: {}, position: { x: 0, y: 0 } },
    { id: 'n1', type: 'condition', data: { field: 'k', op: 'eq', value: 'v' }, position: { x: 0, y: 100 } },
    { id: 'n2', type: 'message', data: { text: 'hi' }, position: { x: 0, y: 200 } },
  ];
  const edges = [
    { id: 'e1', source: 'trigger', target: 'n1' }, // React Flow: no sourceHandle at all
    { id: 'e2', source: 'n1', target: 'n2', sourceHandle: 'yes' },
    { id: 'e3', source: 'n1', target: 'trigger', sourceHandle: 'no' },
  ];
  const g = toGraph(nodes, edges);
  assert.equal(g.edges[0].sourceHandle, null); // null, not undefined — explicit for the engine
  assert.equal(g.edges[1].sourceHandle, 'yes');
  assert.equal(g.edges[2].sourceHandle, 'no');
});

test('toGraph: keeps node position (rounded) — the editor needs it, the runtime ignores it', () => {
  const g = toGraph(
    [{ id: 'n1', type: 'message', data: { text: 'x' }, position: { x: 10.6, y: -3.2 } }],
    []
  );
  assert.deepEqual(g.nodes[0].position, { x: 11, y: -3 });
});

test('toGraph: generates an edge id when the editor did not provide one', () => {
  const g = toGraph([], [{ source: 'a', target: 'b', sourceHandle: 'yes' }]);
  assert.ok(g.edges[0].id.length > 0);
});

// ---------------------------------------------------------------------------
// normalizeData — engine-contract coercions
// ---------------------------------------------------------------------------

test('normalizeData buttons: empty option value is OMITTED (engine falls back o.value ?? o.title)', () => {
  const d = normalizeData('buttons', {
    text: 'pick',
    options: [{ title: 'A', value: '' }, { title: 'B', value: ' b1 ' }],
  });
  assert.ok(!('value' in d.options[0])); // '' would beat the ?? fallback — must be absent
  assert.equal(d.options[1].value, 'b1');
});

test('normalizeData delay: string inputs from <input type=number> become numbers', () => {
  assert.deepEqual(normalizeData('delay', { minutes: '15', hours: '', days: '2' }), {
    minutes: 15, hours: 0, days: 2,
  });
});

test('normalizeData action: select string ids become numbers, empty becomes null', () => {
  const d = normalizeData('action', { assigneeId: '7', teamId: '', labels: [' vip ', ''], status: 'open' });
  assert.equal(d.assigneeId, 7);
  assert.equal(d.teamId, null);
  assert.deepEqual(d.labels, ['vip']);
  assert.equal(d.status, 'open');
});

test('normalizeData question: followUp numbers coerced, null stays null', () => {
  const on = normalizeData('question', {
    text: 'q', followUp: { afterMinutes: '30', message: 'ping', maxRetries: '2', onGiveUp: 'stop' },
  });
  assert.deepEqual(on.followUp, { afterMinutes: 30, message: 'ping', maxRetries: 2, onGiveUp: 'stop' });
  const off = normalizeData('question', { text: 'q', followUp: null });
  assert.equal(off.followUp, null);
});

test('normalizeData question: unknown validation/scope fall back to safe defaults', () => {
  const d = normalizeData('question', { text: 'q', validation: 'zip', saveTo: { scope: 'weird', key: ' k ' } });
  assert.equal(d.validation, 'text');
  assert.deepEqual(d.saveTo, { scope: 'contact', key: 'k' });
});

// ---------------------------------------------------------------------------
// fromGraph / round-trip
// ---------------------------------------------------------------------------

test('fromGraph → toGraph round-trip preserves the runtime graph', () => {
  const saved = {
    nodes: [
      { id: 'trigger', type: 'trigger', data: {}, position: { x: 260, y: 40 } },
      {
        id: 'n1',
        type: 'question',
        data: {
          text: 'שם?', validation: 'text',
          saveTo: { scope: 'contact', key: 'full_name' },
          retryMessage: '', followUp: null,
        },
        position: { x: 220, y: 210 },
      },
      { id: 'n2', type: 'condition', data: { field: 'full_name', op: 'exists', value: '' }, position: { x: 220, y: 380 } },
      { id: 'n3', type: 'handoff', data: { message: '', assigneeId: null, teamId: null }, position: { x: 100, y: 550 } },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'n1', sourceHandle: null },
      { id: 'e2', source: 'n1', target: 'n2', sourceHandle: null },
      { id: 'e3', source: 'n2', target: 'n3', sourceHandle: 'yes' },
    ],
  };
  const rf = fromGraph(saved);
  assert.equal(rf.nodes.find((n) => n.type === 'trigger').deletable, false);
  assert.ok(!('sourceHandle' in rf.edges[0])); // null handle omitted for React Flow
  assert.equal(rf.edges[2].sourceHandle, 'yes');
  const back = toGraph(rf.nodes, rf.edges);
  assert.deepEqual(back, saved);
});

test('fromGraph: nodes without position get a grid fallback', () => {
  const rf = fromGraph({ nodes: [{ id: 'a', type: 'message', data: {} }], edges: [] });
  assert.ok(Number.isFinite(rf.nodes[0].position.x));
  assert.ok(Number.isFinite(rf.nodes[0].position.y));
});

// ---------------------------------------------------------------------------
// startNodeOf — mirror of the engine's resolution
// ---------------------------------------------------------------------------

test('startNodeOf: trigger with an outgoing edge → its target; without → null', () => {
  const g = emptyGraph();
  assert.equal(startNodeOf(g), null);
  g.nodes.push({ id: 'n1', type: 'message', data: { text: 'hi' }, position: { x: 0, y: 0 } });
  g.edges.push({ id: 'e1', source: 'trigger', target: 'n1', sourceHandle: null });
  assert.equal(startNodeOf(g), 'n1');
});

test('startNodeOf: no trigger → first node without incoming edges', () => {
  const g = {
    nodes: [
      { id: 'a', type: 'message', data: {} },
      { id: 'b', type: 'message', data: {} },
    ],
    edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: null }],
  };
  assert.equal(startNodeOf(g), 'a');
});

// ---------------------------------------------------------------------------
// validateGraph
// ---------------------------------------------------------------------------

const connectedGraph = (extraNodes = [], extraEdges = []) => ({
  nodes: [
    { id: 'trigger', type: 'trigger', data: {}, position: { x: 0, y: 0 } },
    { id: 'n1', type: 'message', data: { text: 'hi' }, position: { x: 0, y: 100 } },
    ...extraNodes,
  ],
  edges: [{ id: 'e1', source: 'trigger', target: 'n1', sourceHandle: null }, ...extraEdges],
});

test('validateGraph: unconnected trigger → no_start', () => {
  const errs = validateGraph(emptyGraph());
  assert.deepEqual(errs, [{ code: 'no_start' }]);
});

test('validateGraph: connected message-only flow is valid', () => {
  assert.deepEqual(validateGraph(connectedGraph()), []);
});

test('validateGraph: question needs text and saveTo.key', () => {
  const g = connectedGraph([
    { id: 'n2', type: 'question', data: { text: '  ', saveTo: { scope: 'contact', key: '' } } },
  ]);
  const codes = validateGraph(g).map((e) => `${e.code}:${e.nodeId}`).sort();
  assert.deepEqual(codes, ['q_key:n2', 'q_text:n2']);
});

test('validateGraph: buttons need 1-10 non-empty options', () => {
  const mk = (options) =>
    connectedGraph([{ id: 'n2', type: 'buttons', data: { text: 'pick', saveTo: { key: 'k' }, options } }]);
  assert.deepEqual(validateGraph(mk([])), [{ code: 'btn_options', nodeId: 'n2' }]);
  assert.deepEqual(validateGraph(mk([{ title: '  ' }])), [{ code: 'btn_options', nodeId: 'n2' }]);
  assert.deepEqual(
    validateGraph(mk(Array.from({ length: 11 }, (_, i) => ({ title: `o${i}` })))),
    [{ code: 'btn_options', nodeId: 'n2' }]
  );
  assert.deepEqual(validateGraph(mk([{ title: 'yes' }, { title: 'no' }])), []);
});

test('validateGraph: an unconnected condition branch is a valid terminal path', () => {
  const cond = { id: 'c', type: 'condition', data: { field: 'x', op: 'eq', value: '1' } };
  const end = { id: 'e', type: 'handoff', data: {} };
  // Only "yes" is wired; "no" intentionally ends the flow.
  const onlyYes = connectedGraph([cond, end], [
    { id: 'e2', source: 'n1', target: 'c', sourceHandle: null },
    { id: 'e3', source: 'c', target: 'e', sourceHandle: 'yes' },
  ]);
  assert.deepEqual(validateGraph(onlyYes), []);
  // both wired → valid
  const both = connectedGraph([cond, end], [
    { id: 'e2', source: 'n1', target: 'c', sourceHandle: null },
    { id: 'e3', source: 'c', target: 'e', sourceHandle: 'yes' },
    { id: 'e4', source: 'c', target: 'n1', sourceHandle: 'no' },
  ]);
  assert.deepEqual(validateGraph(both), []);
});

test('validateGraph: webhook needs a valid http(s) URL', () => {
  const mk = (url) => connectedGraph(
    [{ id: 'w', type: 'webhook', data: { url } }],
    [{ id: 'e2', source: 'n1', target: 'w', sourceHandle: null }]
  );
  assert.deepEqual(validateGraph(mk('')), [{ code: 'wh_url', nodeId: 'w' }]);
  assert.deepEqual(validateGraph(mk('not a url')), [{ code: 'wh_url', nodeId: 'w' }]);
  assert.deepEqual(validateGraph(mk('https://n8n.example/hook')), []);
});

// ---------------------------------------------------------------------------
// ids + attribute keys
// ---------------------------------------------------------------------------

test('newNodeId: increments past the highest existing n<N> id', () => {
  assert.equal(newNodeId([]), 'n1');
  assert.equal(newNodeId([{ id: 'trigger' }, { id: 'n2' }, { id: 'n7' }]), 'n8');
});

test('collectAttributeKeys: dedupes by scope+key, skips empties', () => {
  const g = {
    nodes: [
      { id: 'a', type: 'question', data: { saveTo: { scope: 'contact', key: 'budget' } } },
      { id: 'b', type: 'buttons', data: { saveTo: { scope: 'contact', key: 'budget' } } },
      { id: 'c', type: 'question', data: { saveTo: { scope: 'conversation', key: 'budget' } } },
      { id: 'd', type: 'question', data: { saveTo: { scope: 'contact', key: ' ' } } },
      { id: 'e', type: 'webhook', data: { saveResponseTo: 'crm_id' } }, // answers-only, not an attribute
      { id: 'f', type: 'template', data: {
        waitForReply: true, saveTo: { scope: 'contact', key: 'callback_window' },
      } },
      { id: 'g', type: 'template', data: {
        waitForReply: false, saveTo: { scope: 'contact', key: 'ignored_template_key' },
      } },
    ],
    edges: [],
  };
  assert.deepEqual(collectAttributeKeys(g), [
    { key: 'budget', scope: 'contact' },
    { key: 'budget', scope: 'conversation' },
    { key: 'callback_window', scope: 'contact' },
  ]);
});

// ---------------------------------------------------------------------------
// template node + per-option branching (new in the production-hardening pass)
// ---------------------------------------------------------------------------

test('normalizeData: template node coerces params to strings and trims ids', () => {
  const d = normalizeData('template', {
    name: ' welcome_lead ', language: 'he', category: 'MARKETING',
    params: ['{{שם}}', 7, null], mediaUrl: ' https://x/y.jpg ',
    waitForReply: true,
    saveTo: { scope: 'conversation', key: ' callback_window ' },
    validation: 'email',
    retryMessage: ' שוב ',
  });
  assert.deepEqual(d, {
    name: 'welcome_lead', language: 'he', category: 'MARKETING',
    params: ['{{שם}}', '7', ''], mediaUrl: 'https://x/y.jpg',
    waitForReply: true,
    saveTo: { scope: 'conversation', key: 'callback_window' },
    validation: 'email',
    retryMessage: ' שוב ',
  });
});

test('normalizeData: template reply settings use safe defaults', () => {
  const d = normalizeData('template', {
    name: 'initial_consultation', validation: 'unknown', saveTo: { scope: 'other', key: ' answer ' },
  });
  assert.equal(d.waitForReply, false);
  assert.deepEqual(d.saveTo, { scope: 'contact', key: 'answer' });
  assert.equal(d.validation, 'text');
  assert.equal(d.retryMessage, '');
});

test('validateGraph: template node requires a chosen template', () => {
  const g = {
    nodes: [
      { id: 'trigger', type: 'trigger', data: {} },
      { id: 'n1', type: 'template', data: { name: '', params: [] } },
    ],
    edges: [{ id: 'e1', source: 'trigger', target: 'n1' }],
  };
  const errs = validateGraph(g);
  assert.ok(errs.some((e) => e.code === 'tpl_name' && e.nodeId === 'n1'));
});

test('validateGraph: reply-waiting template requires saveTo.key', () => {
  const mk = (waitForReply, key) => ({
    nodes: [
      { id: 'trigger', type: 'trigger', data: {} },
      { id: 'n1', type: 'template', data: {
        name: 'initial_consultation', waitForReply, saveTo: { scope: 'contact', key },
      } },
    ],
    edges: [{ id: 'e1', source: 'trigger', target: 'n1' }],
  });
  assert.deepEqual(validateGraph(mk(true, '')), [{ code: 'tpl_key', nodeId: 'n1' }]);
  assert.deepEqual(validateGraph(mk(true, 'callback_window')), []);
  assert.deepEqual(validateGraph(mk(false, '')), []);
});

test('newOptionId is stable across delete/re-add', () => {
  assert.equal(newOptionId([]), 'o1');
  assert.equal(newOptionId([{ id: 'o1' }, { id: 'o3' }]), 'o4');
  assert.equal(newOptionId([{ title: 'בלי id' }]), 'o1');
});

test('normalizeData: buttons options keep/backfill stable ids', () => {
  const d = normalizeData('buttons', {
    text: 'בחרו',
    options: [{ title: 'א', id: 'o5' }, { title: 'ב' }],
    saveTo: { scope: 'contact', key: 'k' },
  });
  assert.equal(d.options[0].id, 'o5');       // קיים — נשמר
  assert.equal(d.options[1].id, 'o6');       // חסר — הושלם אחרי המקסימום
});

test('fromGraph backfills option ids on legacy buttons nodes', () => {
  const { nodes } = fromGraph({
    nodes: [{ id: 'b', type: 'buttons', data: { text: '', options: [{ title: 'ישן' }] } }],
    edges: [],
  });
  assert.equal(nodes[0].data.options[0].id, 'o1');
});

test('toGraph drops edges whose option handle no longer exists', () => {
  const rfNodes = [
    { id: 'b', type: 'buttons', position: { x: 0, y: 0 }, data: {
      text: 'x', options: [{ id: 'o1', title: 'א' }], saveTo: { scope: 'contact', key: 'k' },
    } },
    { id: 'm', type: 'message', position: { x: 0, y: 100 }, data: { text: 'י' } },
  ];
  const rfEdges = [
    { id: 'e1', source: 'b', target: 'm', sourceHandle: 'opt:o1' },  // חי
    { id: 'e2', source: 'b', target: 'm', sourceHandle: 'opt:o9' },  // אפשרות שנמחקה
    { id: 'e3', source: 'b', target: 'm' },                          // ברירת מחדל
  ];
  const g = toGraph(rfNodes, rfEdges);
  const handles = g.edges.map((e) => e.sourceHandle);
  assert.deepEqual(handles.sort(), ['opt:o1', null].sort());
});
