import { test } from 'node:test';
import assert from 'node:assert/strict';
// ה-nextNodeId/startNodeOf האמיתיים של המנוע — לא העתק. בדיקת ה-round-trip
// חייבת להימדד מול מי שבאמת מריץ את הפלואו, אחרת היא נסחפת ממנו בשקט.
import { nextNodeId, startNodeOf } from '../../engine/src/journeys.js';
import {
  toOutline,
  outlineToEdges,
  insertStep,
  removeStep,
  moveStep,
  moveStepTo,
  replaceStepType,
  setBranchEnds,
  stepIds,
  forkHandlesOf,
  outlineLayout,
} from '../src/lib/journeyOutline.js';

// ---------------------------------------------------------------------------
// עזרים
// ---------------------------------------------------------------------------

const N = (id, type = 'message', data = {}) => ({ id, type, data });
const E = (source, target, sourceHandle = null) => ({ source, target, sourceHandle });
const G = (nodes, edges) => ({ nodes, edges });

const BTN = (id, ...optIds) => N(id, 'buttons', { options: optIds.map((o) => ({ title: o, id: o })) });

/*
 * ה-handles שהמנוע באמת יכול לבקש עבור צומת (ראו journeys.js):
 *   condition → 'yes' / 'no'         (executeFrom: nextNodeId(g, id, pass ? 'yes' : 'no'))
 *   buttons   → opt:<id> או null     (feedAnswer: handle = matchedOption ? `opt:<id>` : null)
 *   כל השאר   → null
 * הסמנטיקה של הגרף = מה ש-nextNodeId מחזיר לכל צירוף כזה. סדר הקשתות לא נחשב.
 */
function askableHandles(node) {
  if (node.type === 'condition') return ['yes', 'no'];
  if (node.type === 'buttons') return [...(node.data?.options || []).map((o) => `opt:${o.id}`), null];
  return [null];
}

function semantics(graph) {
  const out = { start: startNodeOf(graph) };
  for (const n of graph.nodes) {
    for (const h of askableHandles(n)) out[`${n.id}|${h ?? 'default'}`] = nextNodeId(graph, n.id, h);
  }
  return out;
}

/** גרף → טור → גרף, ומשווים את מה שהמנוע פותר בפועל. */
function roundTrip(graph) {
  const o = toOutline(graph);
  assert.equal(o.ok, true, `expected a representable graph, got ${o.reason}`);
  const rebuilt = { nodes: graph.nodes, edges: outlineToEdges(o.steps, { triggerId: o.triggerId }) };
  assert.deepEqual(semantics(rebuilt), semantics(graph));
  return o;
}

// ---------------------------------------------------------------------------
// גזירה — שרשרת ליניארית
// ---------------------------------------------------------------------------

test('linear chain → flat list, order preserved', () => {
  const g = G(
    [N('trigger', 'trigger'), N('n1'), N('n2', 'delay'), N('n3', 'handoff')],
    [E('trigger', 'n1'), E('n1', 'n2'), E('n2', 'n3')]
  );
  const o = toOutline(g);
  assert.equal(o.ok, true);
  assert.equal(o.triggerId, 'trigger');
  assert.deepEqual(o.steps.map((s) => s.id), ['n1', 'n2', 'n3']);
  assert.deepEqual(o.steps.map((s) => s.branches), [null, null, null]);
  roundTrip(g);
});

test('a node with no outgoing edge ends the flow (no trailing edge is invented)', () => {
  const g = G([N('trigger', 'trigger'), N('n1')], [E('trigger', 'n1')]);
  const o = roundTrip(g);
  assert.deepEqual(o.steps.map((s) => s.id), ['n1']);
  assert.equal(nextNodeId({ edges: outlineToEdges(o.steps) }, 'n1'), null);
});

test('an empty flow (trigger not connected) is a valid empty column', () => {
  const g = G([N('trigger', 'trigger')], []);
  const o = toOutline(g);
  assert.equal(o.ok, true);
  assert.deepEqual(o.steps, []);
  assert.deepEqual(outlineToEdges(o.steps, { triggerId: 'trigger' }), []);
});

// ---------------------------------------------------------------------------
// גזירה — תנאי
// ---------------------------------------------------------------------------

test('condition → yes/no branch lists taken from the real sourceHandle values', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no')]
  );
  const o = roundTrip(g);
  assert.equal(o.steps.length, 1);
  const [cond] = o.steps;
  assert.deepEqual(cond.branches.map((b) => b.handle), ['yes', 'no']);
  assert.deepEqual(cond.branches[0].steps.map((s) => s.id), ['a']);
  assert.deepEqual(cond.branches[1].steps.map((s) => s.id), ['b']);
});

test('condition branches are yes-then-no even when the edges are stored in the other order', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b')],
    [E('trigger', 'c'), E('c', 'b', 'no'), E('c', 'a', 'yes')]
  );
  const o = roundTrip(g);
  assert.deepEqual(o.steps[0].branches.map((b) => b.handle), ['yes', 'no']);
  assert.deepEqual(o.steps[0].branches[0].steps.map((s) => s.id), ['a']);
});

test('an unwired condition branch is an empty list, and write-back does not invent a target', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a')],
    [E('trigger', 'c'), E('c', 'a', 'yes')]
  );
  const o = roundTrip(g);
  assert.deepEqual(o.steps[0].branches[1].steps, []);
  const edges = outlineToEdges(o.steps, { triggerId: 'trigger' });
  assert.equal(nextNodeId({ edges }, 'c', 'no'), null); // סוף הפלואו, לא ניתוב שגוי ל-'a'
});

test('a legacy condition with a default (null-handle) edge keeps the engine-resolved target', () => {
  // 'no' לא מחווט: המנוע נופל לקשת ברירת המחדל. אחרי כתיבה חזרה תהיה קשת 'no'
  // מפורשת לאותו יעד — סדר הקשתות שונה, מה שהמנוע פותר זהה.
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('x')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'x'), E('a', 'x')]
  );
  const o = toOutline(g);
  assert.equal(o.ok, true);
  assert.deepEqual(o.steps.map((s) => s.id), ['c', 'x']); // x הוא הזנב המשותף
  assert.deepEqual(o.steps[0].branches[0].steps.map((s) => s.id), ['a']);
  assert.deepEqual(o.steps[0].branches[1].steps, []);
  const edges = outlineToEdges(o.steps, { triggerId: 'trigger' });
  assert.equal(nextNodeId({ edges }, 'c', 'no'), nextNodeId(g, 'c', 'no'));
  assert.equal(nextNodeId({ edges }, 'c', 'yes'), 'a');
});

// ---------------------------------------------------------------------------
// גזירה — התכנסות (rejoin)
// ---------------------------------------------------------------------------

test('branches that rejoin: the shared tail is rendered once, after the branch block', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b'), N('x'), N('y')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no'), E('a', 'x'), E('b', 'x'), E('x', 'y')]
  );
  const o = roundTrip(g);
  assert.deepEqual(o.steps.map((s) => s.id), ['c', 'x', 'y']);
  assert.deepEqual(o.steps[0].branches[0].steps.map((s) => s.id), ['a']);
  assert.deepEqual(o.steps[0].branches[1].steps.map((s) => s.id), ['b']);
  // הזנב מופיע פעם אחת בלבד — לא משוכפל לתוך שני הענפים.
  assert.deepEqual(stepIds(o.steps), ['c', 'a', 'b', 'x', 'y']);
});

test('both branches pointing at the same node: two empty branches + the shared tail', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('x')],
    [E('trigger', 'c'), E('c', 'x', 'yes'), E('c', 'x', 'no')]
  );
  const o = roundTrip(g);
  assert.deepEqual(o.steps.map((s) => s.id), ['c', 'x']);
  assert.deepEqual(o.steps[0].branches.map((b) => b.steps.length), [0, 0]);
});

test('nested conditions: the inner branch rejoins inside the outer one', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c1', 'condition'), N('c2', 'condition'), N('a'), N('b'), N('m'), N('n'), N('end')],
    [
      E('trigger', 'c1'),
      E('c1', 'c2', 'yes'), E('c1', 'n', 'no'),
      E('c2', 'a', 'yes'), E('c2', 'b', 'no'),
      E('a', 'm'), E('b', 'm'), E('m', 'end'), E('n', 'end'),
    ]
  );
  const o = roundTrip(g);
  assert.deepEqual(o.steps.map((s) => s.id), ['c1', 'end']);
  const yes = o.steps[0].branches[0].steps;
  assert.deepEqual(yes.map((s) => s.id), ['c2', 'm']);
  assert.deepEqual(yes[0].branches[0].steps.map((s) => s.id), ['a']);
  assert.deepEqual(yes[0].branches[1].steps.map((s) => s.id), ['b']);
  assert.deepEqual(o.steps[0].branches[1].steps.map((s) => s.id), ['n']);
});

test('an uneven rejoin (one branch is empty-through) still places the tail once', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('x')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'x', 'no'), E('a', 'x')]
  );
  const o = roundTrip(g);
  assert.deepEqual(o.steps.map((s) => s.id), ['c', 'x']);
  assert.deepEqual(o.steps[0].branches[0].steps.map((s) => s.id), ['a']);
  assert.deepEqual(o.steps[0].branches[1].steps, []);
});

// ---------------------------------------------------------------------------
// גזירה — כפתורים (הסתעפות פר-אפשרות + ברירת מחדל)
// ---------------------------------------------------------------------------

test('buttons: every option is a branch, the null-handle edge is the column below', () => {
  const g = G(
    [N('trigger', 'trigger'), BTN('b', 'o1', 'o2'), N('a'), N('x')],
    [E('trigger', 'b'), E('b', 'a', 'opt:o1'), E('b', 'x'), E('a', 'x')]
  );
  const o = roundTrip(g);
  assert.deepEqual(o.steps.map((s) => s.id), ['b', 'x']);
  assert.deepEqual(o.steps[0].branches.map((br) => br.handle), ['opt:o1', 'opt:o2']);
  assert.deepEqual(o.steps[0].branches[0].steps.map((s) => s.id), ['a']);
  assert.deepEqual(o.steps[0].branches[1].steps, []); // אפשרות בלי קשת = נופלת לברירת המחדל
});

test('a branch that dead-ends is NOT stitched onto the shared tail', () => {
  // opt:o1 מוביל ל-a שאין לו יציאה: הפלואו נגמר שם. הזנב המשותף (x) שייך רק
  // לברירת המחדל — חיווט a→x היה משנה את התנהגות המנוע בשקט.
  const g = G(
    [N('trigger', 'trigger'), BTN('b', 'o1', 'o2'), N('a', 'handoff'), N('x')],
    [E('trigger', 'b'), E('b', 'a', 'opt:o1'), E('b', 'x')]
  );
  const o = roundTrip(g);
  assert.equal(o.steps[0].branches[0].ends, true);
  assert.equal(o.steps[0].branches[1].ends, false); // ריק + יש ברירת מחדל → ממשיך למטה
  const edges = outlineToEdges(o.steps, { triggerId: 'trigger' });
  assert.equal(nextNodeId({ edges }, 'a'), null);
});

test('a condition branch that dead-ends keeps the other branch tail intact', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('h', 'handoff'), N('a'), N('x')],
    [E('trigger', 'c'), E('c', 'h', 'yes'), E('c', 'a', 'no'), E('a', 'x')]
  );
  const o = roundTrip(g);
  // אין זנב משותף: 'כן' מסתיים, ולכן כל מה שאחרי ההסתעפות שייך לענף 'לא'.
  assert.deepEqual(o.steps.map((s) => s.id), ['c']);
  assert.equal(o.steps[0].branches[0].ends, true);
  assert.deepEqual(o.steps[0].branches[1].steps.map((s) => s.id), ['a', 'x']);
});

test('buttons with no default output: the shared tail becomes the default on write-back', () => {
  // הנורמליזציה היחידה שהטור עושה. במנוע, יציאה לא-מחווטת נופלת ל"קשת הראשונה
  // במערך" (כאן: מסלול o1) — תוצאה של סדר אחסון. אחרי הטור היא מובילה למסלול
  // המשותף, וזו ההתנהגות היחידה שאפשר להראות למשתמש.
  const g = G(
    [N('trigger', 'trigger'), BTN('b', 'o1', 'o2'), N('a'), N('c'), N('x')],
    [E('trigger', 'b'), E('b', 'a', 'opt:o1'), E('b', 'c', 'opt:o2'), E('a', 'x'), E('c', 'x')]
  );
  assert.equal(nextNodeId(g, 'b', null), 'a'); // לפני: מסלול האפשרות הראשונה
  const o = toOutline(g);
  assert.equal(o.ok, true);
  assert.deepEqual(o.steps.map((s) => s.id), ['b', 'x']);
  const edges = outlineToEdges(o.steps, { triggerId: 'trigger' });
  assert.equal(nextNodeId({ edges }, 'b', null), 'x'); // אחרי: המסלול המשותף
  assert.equal(nextNodeId({ edges }, 'b', 'opt:o1'), 'a'); // האפשרויות עצמן לא זזו
  assert.equal(nextNodeId({ edges }, 'b', 'opt:o2'), 'c');
});

test('buttons with no branching edges stays a plain card in the column', () => {
  const g = G([N('trigger', 'trigger'), BTN('b', 'o1'), N('x')], [E('trigger', 'b'), E('b', 'x')]);
  const o = roundTrip(g);
  assert.deepEqual(o.steps.map((s) => s.id), ['b', 'x']);
  assert.deepEqual(o.steps[0].branches.map((br) => br.steps.length), [0]);
});

test('forkHandlesOf reports the handles the runtime actually uses', () => {
  assert.deepEqual(forkHandlesOf(N('c', 'condition')), ['yes', 'no']);
  assert.deepEqual(forkHandlesOf(BTN('b', 'o1', 'o3')), ['opt:o1', 'opt:o3']);
  assert.equal(forkHandlesOf(N('m')), null);
  assert.equal(forkHandlesOf(N('b', 'buttons', { options: [] })), null);
});

// ---------------------------------------------------------------------------
// round-trip על מגוון צורות
// ---------------------------------------------------------------------------

test('round-trip is semantically identical for every representable shape', () => {
  const shapes = [
    G([N('trigger', 'trigger')], []),
    G([N('trigger', 'trigger'), N('n1')], [E('trigger', 'n1')]),
    G([N('trigger', 'trigger'), N('n1'), N('n2'), N('n3')], [E('trigger', 'n1'), E('n1', 'n2'), E('n2', 'n3')]),
    G(
      [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b'), N('x')],
      [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no'), E('a', 'x'), E('b', 'x')]
    ),
    G(
      [N('trigger', 'trigger'), N('c', 'condition'), N('a', 'handoff'), N('b', 'handoff')],
      [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no')]
    ),
    G(
      [N('trigger', 'trigger'), BTN('b', 'o1', 'o2'), N('a'), N('x'), N('y')],
      [E('trigger', 'b'), E('b', 'a', 'opt:o1'), E('b', 'y', 'opt:o2'), E('b', 'x'), E('a', 'x'), E('y', 'x')]
    ),
    G(
      [N('trigger', 'trigger'), N('q', 'question'), N('c', 'condition'), N('d', 'delay'), N('h', 'handoff')],
      [E('trigger', 'q'), E('q', 'c'), E('c', 'd', 'yes'), E('c', 'h', 'no'), E('d', 'h')]
    ),
  ];
  for (const g of shapes) roundTrip(g);
});

test('round-trip twice is a fixed point (the second pass changes nothing)', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b'), N('x')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no'), E('a', 'x'), E('b', 'x')]
  );
  const first = { nodes: g.nodes, edges: outlineToEdges(toOutline(g).steps, { triggerId: 'trigger' }) };
  const second = { nodes: g.nodes, edges: outlineToEdges(toOutline(first).steps, { triggerId: 'trigger' }) };
  assert.deepEqual(second.edges, first.edges);
});

// ---------------------------------------------------------------------------
// עריכות — הוספה / מחיקה / סידור מחדש
// ---------------------------------------------------------------------------

const LINEAR = () =>
  G([N('trigger', 'trigger'), N('n1'), N('n2'), N('n3')], [E('trigger', 'n1'), E('n1', 'n2'), E('n2', 'n3')]);

test('insert in the middle re-wires both neighbours', () => {
  const o = toOutline(LINEAR());
  const steps = insertStep(o.steps, { path: [], index: 1 }, { id: 'nX', type: 'message', branches: null });
  const edges = outlineToEdges(steps, { triggerId: 'trigger' });
  const g2 = { edges };
  assert.equal(nextNodeId(g2, 'n1'), 'nX');
  assert.equal(nextNodeId(g2, 'nX'), 'n2');
  assert.equal(nextNodeId(g2, 'n2'), 'n3');
  assert.equal(nextNodeId(g2, 'trigger'), 'n1');
});

test('insert at the head re-points the trigger', () => {
  const o = toOutline(LINEAR());
  const steps = insertStep(o.steps, { path: [], index: 0 }, { id: 'nX', type: 'message', branches: null });
  const g2 = { nodes: [], edges: outlineToEdges(steps, { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(g2, 'trigger'), 'nX');
  assert.equal(nextNodeId(g2, 'nX'), 'n1');
});

test('insert at the end leaves the last node without an outgoing edge', () => {
  const o = toOutline(LINEAR());
  const steps = insertStep(o.steps, { path: [], index: 3 }, { id: 'nX', type: 'handoff', branches: null });
  const g2 = { edges: outlineToEdges(steps, { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(g2, 'n3'), 'nX');
  assert.equal(nextNodeId(g2, 'nX'), null);
});

test('insert into a condition branch wires the handle and keeps the shared tail', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('x')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'x', 'no'), E('a', 'x')]
  );
  const o = toOutline(g);
  const steps = insertStep(o.steps, { path: [{ id: 'c', handle: 'no' }], index: 0 }, { id: 'nY', type: 'message', branches: null });
  const g2 = { edges: outlineToEdges(steps, { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(g2, 'c', 'no'), 'nY');
  assert.equal(nextNodeId(g2, 'nY'), 'x'); // ממשיך אל הזנב המשותף
  assert.equal(nextNodeId(g2, 'c', 'yes'), 'a');
  assert.equal(nextNodeId(g2, 'a'), 'x');
});

test('delete stitches the neighbours together', () => {
  const o = toOutline(LINEAR());
  const g2 = { edges: outlineToEdges(removeStep(o.steps, 'n2'), { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(g2, 'n1'), 'n3');
  assert.equal(nextNodeId(g2, 'n3'), null);
});

test('delete the first step re-points the trigger to the second', () => {
  const o = toOutline(LINEAR());
  const g2 = { edges: outlineToEdges(removeStep(o.steps, 'n1'), { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(g2, 'trigger'), 'n2');
});

test('delete a condition drops its branch steps with it and keeps the tail', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b'), N('x')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no'), E('a', 'x'), E('b', 'x')]
  );
  const steps = removeStep(toOutline(g).steps, 'c');
  assert.deepEqual(stepIds(steps), ['x']);
  const g2 = { edges: outlineToEdges(steps, { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(g2, 'trigger'), 'x');
});

test('delete inside a branch keeps the branch wired to the tail', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b'), N('x')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no'), E('a', 'x'), E('b', 'x')]
  );
  const g2 = { edges: outlineToEdges(removeStep(toOutline(g).steps, 'a'), { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(g2, 'c', 'yes'), 'x'); // ענף ריק → קשת ישירה אל הזנב
  assert.equal(nextNodeId(g2, 'c', 'no'), 'b');
});

test('reorder swaps two neighbours and rewires around them', () => {
  const o = toOutline(LINEAR());
  const g2 = { edges: outlineToEdges(moveStep(o.steps, 'n3', -1), { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(g2, 'trigger'), 'n1');
  assert.equal(nextNodeId(g2, 'n1'), 'n3');
  assert.equal(nextNodeId(g2, 'n3'), 'n2');
  assert.equal(nextNodeId(g2, 'n2'), null);
});

test('drag reorder moves a step to an exact index inside its own path', () => {
  const o = toOutline(LINEAR());
  const steps = moveStepTo(o.steps, 'n1', 2);
  assert.deepEqual(stepIds(steps), ['n2', 'n3', 'n1']);
  const g2 = { edges: outlineToEdges(steps, { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(g2, 'trigger'), 'n2');
  assert.equal(nextNodeId(g2, 'n3'), 'n1');
});

test('changing a fork step type preserves its position and reports removed branch nodes', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b'), N('x')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no'), E('a', 'x'), E('b', 'x')]
  );
  const changed = replaceStepType(
    toOutline(g).steps,
    'c',
    { id: 'c', type: 'message', branches: null }
  );
  assert.deepEqual(changed.removedIds.sort(), ['a', 'b']);
  assert.deepEqual(stepIds(changed.steps), ['c', 'x']);
  const rewired = { edges: outlineToEdges(changed.steps, { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(rewired, 'trigger'), 'c');
  assert.equal(nextNodeId(rewired, 'c'), 'x');
});

test('a branch can explicitly end instead of rejoining the shared continuation', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b'), N('x')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no'), E('a', 'x'), E('b', 'x')]
  );
  const changed = setBranchEnds(toOutline(g).steps, 'c', 'yes', true);
  const rewired = { edges: outlineToEdges(changed, { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(rewired, 'a'), null);
  assert.equal(nextNodeId(rewired, 'b'), 'x');
});

test('reorder past the edge of the list is a no-op', () => {
  const o = toOutline(LINEAR());
  assert.deepEqual(stepIds(moveStep(o.steps, 'n1', -1)), ['n1', 'n2', 'n3']);
  assert.deepEqual(stepIds(moveStep(o.steps, 'n3', 1)), ['n1', 'n2', 'n3']);
});

test('reorder is scoped to its own list — a branch step never escapes its branch', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a1'), N('a2'), N('b'), N('x')],
    [E('trigger', 'c'), E('c', 'a1', 'yes'), E('c', 'b', 'no'), E('a1', 'a2'), E('a2', 'x'), E('b', 'x')]
  );
  const steps = moveStep(toOutline(g).steps, 'a2', -1);
  assert.deepEqual(steps[0].branches[0].steps.map((s) => s.id), ['a2', 'a1']);
  const g2 = { edges: outlineToEdges(steps, { triggerId: 'trigger' }) };
  assert.equal(nextNodeId(g2, 'c', 'yes'), 'a2');
  assert.equal(nextNodeId(g2, 'a2'), 'a1');
  assert.equal(nextNodeId(g2, 'a1'), 'x');
});

test('edits do not mutate the outline they were given', () => {
  const o = toOutline(LINEAR());
  const before = stepIds(o.steps);
  removeStep(o.steps, 'n2');
  moveStep(o.steps, 'n1', 1);
  insertStep(o.steps, { path: [], index: 0 }, { id: 'nZ', type: 'message', branches: null });
  assert.deepEqual(stepIds(o.steps), before);
});

test('an edited outline is still representable — derive → edit → derive is stable', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b'), N('x')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no'), E('a', 'x'), E('b', 'x')]
  );
  const steps = insertStep(toOutline(g).steps, { path: [{ id: 'c', handle: 'no' }], index: 1 }, { id: 'nY', type: 'delay', branches: null });
  const g2 = { nodes: [...g.nodes, N('nY', 'delay')], edges: outlineToEdges(steps, { triggerId: 'trigger' }) };
  const o2 = toOutline(g2);
  assert.equal(o2.ok, true);
  assert.deepEqual(stepIds(o2.steps), ['c', 'a', 'b', 'nY', 'x']);
});

// ---------------------------------------------------------------------------
// גרפים שהעץ לא יכול לייצג — נשארים לעריכת ניתוב מפורשת, בלי לעוות בשקט
// ---------------------------------------------------------------------------

test('a cycle falls back instead of looping forever', () => {
  const g = G(
    [N('trigger', 'trigger'), N('n1'), N('n2')],
    [E('trigger', 'n1'), E('n1', 'n2'), E('n2', 'n1')]
  );
  assert.deepEqual(toOutline(g), { ok: false, reason: 'cycle' });
});

test('a self-loop is a cycle too', () => {
  const g = G([N('trigger', 'trigger'), N('n1')], [E('trigger', 'n1'), E('n1', 'n1')]);
  assert.equal(toOutline(g).reason, 'cycle');
});

test('a node that is not reachable from the trigger falls back with its id', () => {
  const g = G([N('trigger', 'trigger'), N('n1'), N('loose')], [E('trigger', 'n1')]);
  assert.deepEqual(toOutline(g), { ok: false, reason: 'orphan', nodeId: 'loose' });
});

test('a second parent that is a clean rejoin is still representable', () => {
  // n2 נכנס גם מ-'כן' וגם מ-n1 שבענף 'לא' — אבל הוא עדיין הצומת המשותף המוקדם,
  // ולכן מקומו בטור חד-משמעי: אחרי בלוק ההסתעפות.
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('n1'), N('n2')],
    [E('trigger', 'c'), E('c', 'n2', 'yes'), E('c', 'n1', 'no'), E('n1', 'n2')]
  );
  const o = roundTrip(g);
  assert.deepEqual(o.steps.map((s) => s.id), ['c', 'n2']);
  assert.deepEqual(o.steps[0].branches[0].steps, []); // 'כן' קופץ ישר לזנב
  assert.deepEqual(o.steps[0].branches[1].steps.map((s) => s.id), ['n1']);
});

test('a cross edge into the middle of another branch falls back', () => {
  // b (בענף 'לא' של c1) קופץ אל p, שיושב בתוך ענף 'כן' של c2. לצומת אין מקום
  // יחיד בטור — הוא היה מרונדר פעמיים.
  const g = G(
    [N('trigger', 'trigger'), N('c1', 'condition'), N('c2', 'condition'), N('a'), N('b'), N('p'), N('q'), N('z')],
    [
      E('trigger', 'c1'),
      E('c1', 'a', 'yes'), E('c1', 'b', 'no'),
      E('a', 'c2'), E('b', 'p'),
      E('c2', 'p', 'yes'), E('c2', 'q', 'no'),
      E('p', 'z'), E('q', 'z'),
    ]
  );
  const o = toOutline(g);
  assert.equal(o.ok, false);
  assert.equal(o.reason, 'converge');
});

test('a handle that does not belong to the node falls back as unsupported', () => {
  const g = G([N('trigger', 'trigger'), N('n1'), N('n2')], [E('trigger', 'n1'), E('n1', 'n2', 'yes')]);
  assert.deepEqual(toOutline(g), { ok: false, reason: 'unsupported', nodeId: 'n1' });
});

test('two default edges out of one node fall back as unsupported', () => {
  const g = G(
    [N('trigger', 'trigger'), N('n1'), N('a'), N('b')],
    [E('trigger', 'n1'), E('n1', 'a'), E('n1', 'b')]
  );
  assert.deepEqual(toOutline(g), { ok: false, reason: 'unsupported', nodeId: 'n1' });
});

test('a fallback never returns steps — the caller cannot half-render a bad graph', () => {
  for (const g of [
    G([N('trigger', 'trigger'), N('n1')], [E('trigger', 'n1'), E('n1', 'n1')]),
    G([N('trigger', 'trigger'), N('n1'), N('loose')], [E('trigger', 'n1')]),
  ]) {
    assert.equal(toOutline(g).steps, undefined);
  }
});

// ---------------------------------------------------------------------------
// פריסת המפה
// ---------------------------------------------------------------------------

test('outlineLayout gives every step a distinct row and indents branches', () => {
  const g = G(
    [N('trigger', 'trigger'), N('c', 'condition'), N('a'), N('b'), N('x')],
    [E('trigger', 'c'), E('c', 'a', 'yes'), E('c', 'b', 'no'), E('a', 'x'), E('b', 'x')]
  );
  const pos = outlineLayout(toOutline(g).steps, { triggerId: 'trigger' });
  assert.deepEqual(Object.keys(pos).sort(), ['a', 'b', 'c', 'trigger', 'x']);
  const ys = Object.values(pos).map((p) => p.y);
  assert.equal(new Set(ys).size, ys.length); // אין שני צמתים באותה שורה
  assert.ok(pos.a.x > pos.c.x && pos.b.x > pos.a.x); // ענפים מוזחים, כל אחד לעמודה משלו
});
