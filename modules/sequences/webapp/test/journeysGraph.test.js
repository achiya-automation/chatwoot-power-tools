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
  startNodeOf,
  collectAttributeKeys,
} from '../src/components/journeys/graphModel.js';

// ---------------------------------------------------------------------------
// node types — must match the engine runtime's switch (engine/src/journeys.js)
// ---------------------------------------------------------------------------

test('node type set matches the engine runtime', () => {
  assert.deepEqual(NODE_TYPES, [
    'trigger', 'message', 'question', 'buttons', 'condition', 'delay', 'action', 'webhook', 'handoff',
  ]);
  assert.ok(!ADDABLE_TYPES.includes('trigger')); // exactly one trigger, not addable
});

test('defaultDataFor covers every addable type with engine-shaped fields', () => {
  assert.deepEqual(defaultDataFor('message'), { text: '', mediaUrl: '' });
  assert.equal(defaultDataFor('question').saveTo.scope, 'contact');
  assert.equal(defaultDataFor('question').validation, 'text');
  assert.equal(defaultDataFor('buttons').options.length, 1);
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

test('toGraph: generates an edge id when React Flow did not provide one', () => {
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

test('validateGraph: condition needs BOTH yes and no edges (else runtime misroutes)', () => {
  const cond = { id: 'c', type: 'condition', data: { field: 'x', op: 'eq', value: '1' } };
  const end = { id: 'e', type: 'handoff', data: {} };
  // only "yes" wired → cond_branch
  const onlyYes = connectedGraph([cond, end], [
    { id: 'e2', source: 'n1', target: 'c', sourceHandle: null },
    { id: 'e3', source: 'c', target: 'e', sourceHandle: 'yes' },
  ]);
  assert.deepEqual(validateGraph(onlyYes), [{ code: 'cond_branch', nodeId: 'c' }]);
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
    ],
    edges: [],
  };
  assert.deepEqual(collectAttributeKeys(g), [
    { key: 'budget', scope: 'contact' },
    { key: 'budget', scope: 'conversation' },
  ]);
});
