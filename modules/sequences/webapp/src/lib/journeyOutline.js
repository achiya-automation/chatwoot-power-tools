/*
 * journeyOutline — הגרף של הפלואו כטור כרטיסים, וחזרה.
 *
 * הצד השמור נשאר גרף ({nodes, edges}) כי המנוע (engine/src/journeys.js) קורא
 * קשתות ולא רשימות. הטור הוא *נגזרת* של הגרף, וכל עריכה בטור נכתבת בחזרה
 * לקשתות שה-nextNodeId של המנוע פותר בדיוק אותו הדבר.
 *
 *   toOutline(graph)          → { ok: true, triggerId, steps } | { ok: false, reason, nodeId? }
 *   outlineToEdges(steps, …)  → edges[]   (רשימת הקשתות המלאה — נבנית מחדש כל פעם)
 *   insertStep / removeStep / moveStep — עריכות טהורות על עץ הצעדים
 *   outlineLayout(steps)      → { id: {x,y} }  מיקומי מטא-דאטה עקביים לגרף השמור
 *
 * Step = { id, type, branches: null | [{ handle, steps: Step[], ends: boolean }] }
 * ends=true — הענף מסיים את הפלואו ואינו ממשיך אל הזנב המשותף שמתחת להסתעפות.
 *
 * הסתעפויות (fork):
 *   condition — תמיד שני ענפים, 'yes' ו-'no' (אלה ערכי ה-sourceHandle האמיתיים).
 *   buttons   — ענף לכל אפשרות, handle = `opt:<id>`; הקשת חסרת-ה-handle היא
 *               "ברירת המחדל" וממשיכה את הטור *מתחת* להסתעפות.
 *
 * התכנסות (rejoin): כששני ענפים נפגשים באותו צומת, הזנב המשותף מרונדר פעם אחת
 * בלבד — אחרי בלוק ההסתעפות, בהזחה של האב. הצומת המשותף מזוהה כצאצא המשותף
 * המוקדם ביותר של הענפים. אם יש יותר ממועמד אחד (התכנסות לא-מובנית), או שצומת
 * היה מרונדר פעמיים — הטור לא יכול לייצג את הגרף נאמנה ומחזירים ok:false.
 *
 * מבנים חופשיים שהעץ לא מייצג (לולאה, צמתים מנותקים או התכנסות לא-מובנית)
 * נשארים כגרף ונערכים ברשימת המאקרו דרך בוררי "המשך אל" — בלי קנבס נפרד.
 *
 * ⚠️ נורמליזציה יחידה: צומת כפתורים שיציאת ברירת המחדל שלו לא מחווטת מקבל אותה
 * בכתיבה חזרה, מחוברת לזנב המשותף. במנוע, יציאה כזו נופלת ל"קשת הראשונה במערך" —
 * תוצאה של סדר אחסון, לא של כוונה. אחרי מעבר בטור, תשובה שלא תואמת אף אפשרות
 * ממשיכה במסלול המשותף שמתחת להסתעפות. זו ההתנהגות היחידה שאפשר להסביר למשתמש.
 */

const outsOf = (graph, id) => (graph?.edges || []).filter((e) => String(e.source) === String(id));
const hOf = (e) => (e.sourceHandle == null ? null : String(e.sourceHandle));

/** ה-handles שצומת מסתעף אליהם, או null אם הוא צומת רגיל (יציאה אחת). */
export function forkHandlesOf(node) {
  if (node?.type === 'condition') return ['yes', 'no'];
  if (node?.type === 'buttons') {
    const opts = (node.data?.options || []).filter((o) => o && o.id != null && String(o.id).trim());
    return opts.length ? opts.map((o) => `opt:${String(o.id)}`) : null;
  }
  return null;
}

// ponytail: reachability פר-הסתעפות, O(n²) בגרף שלם — פלואו הוא עשרות צמתים.
function reachableFrom(graph, start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop();
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    for (const e of outsOf(graph, id)) stack.push(String(e.target));
  }
  return seen;
}

function hasCycle(graph) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map((graph?.nodes || []).map((n) => [String(n.id), WHITE]));
  const visit = (id) => {
    if (color.get(id) === GREY) return true;
    if (color.get(id) === BLACK) return false;
    color.set(id, GREY);
    for (const e of outsOf(graph, id)) {
      if (color.has(String(e.target)) && visit(String(e.target))) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const id of color.keys()) if (visit(id)) return true;
  return false;
}

/*
 * הצומת שבו ההסתעפות מתאחדת, או null אם אין כזה (אז לכל ענף יש זנב משלו).
 * קשת ברירת מחדל (בלי handle) גוברת: זה בדיוק מה שהמנוע עושה כשה-handle לא מחווט.
 */
function joinOf(graph, outs, handles) {
  const def = outs.find((e) => hOf(e) === null);
  if (def) return { join: String(def.target) };

  const targets = handles.map((h) => outs.find((e) => hOf(e) === h)?.target);
  // ענף לא מחווט = סוף הפלואו באותו מסלול, ולכן אין זנב משותף אחרי ההסתעפות.
  if (targets.some((t) => t == null)) return { join: null };

  let common = null;
  for (const t of targets) {
    const r = reachableFrom(graph, String(t));
    common = common == null ? r : new Set([...common].filter((x) => r.has(x)));
  }
  if (!common || !common.size) return { join: null };

  const members = [...common];
  const reach = new Map(members.map((m) => [m, reachableFrom(graph, m)]));
  const earliest = members.filter((m) => !members.some((o) => o !== m && reach.get(o).has(m)));
  if (earliest.length !== 1) return { fail: 'converge' };
  return { join: earliest[0] };
}

/** גרף → טור. מחזיר ok:false עם reason כשהטור לא יכול לייצג אותו נאמנה. */
export function toOutline(graph) {
  const nodes = graph?.nodes || [];
  const byId = new Map(nodes.map((n) => [String(n.id), n]));
  const triggerId = nodes.find((n) => n.type === 'trigger')?.id ?? null;

  if (hasCycle(graph)) return { ok: false, reason: 'cycle' };

  // שפיות הקשתות: כל צומת — יציאה אחת לכל handle, ורק handles ששייכים לו.
  for (const n of nodes) {
    const outs = outsOf(graph, n.id);
    const handles = forkHandlesOf(n);
    const allowed = new Set([null, ...(handles || [])]);
    const seen = new Set();
    for (const e of outs) {
      const h = hOf(e);
      if (!allowed.has(h) || seen.has(h)) return { ok: false, reason: 'unsupported', nodeId: String(n.id) };
      seen.add(h);
    }
    if (!handles && outs.length > 1) return { ok: false, reason: 'unsupported', nodeId: String(n.id) };
  }

  const emitted = new Set();
  let fail = null;

  // מחזיר גם ends: הטור נגמר (אין יציאה) ולא נעצר בצומת מפגש. ההבדל קריטי בכתיבה
  // חזרה — ענף שנגמר אסור שיחובר לזנב המשותף.
  const column = (startId, stop) => {
    const list = [];
    let id = startId == null ? null : String(startId);
    while (id != null && !stop.has(id)) {
      const node = byId.get(id);
      if (!node) { fail = fail || { reason: 'unsupported', nodeId: id }; return { list, ends: true }; }
      if (emitted.has(id)) { fail = fail || { reason: 'converge', nodeId: id }; return { list, ends: true }; }
      emitted.add(id);

      const outs = outsOf(graph, id);
      const handles = forkHandlesOf(node);
      if (handles) {
        const res = joinOf(graph, outs, handles);
        if (res.fail) { fail = fail || { reason: res.fail, nodeId: id }; return { list, ends: true }; }
        const join = res.join;
        const inner = join == null ? stop : new Set([...stop, join]);
        const hasDefault = outs.some((x) => hOf(x) === null);
        const branches = handles.map((h) => {
          const e = outs.find((x) => hOf(x) === h);
          // handle לא מחווט: המנוע נופל לקשת ברירת המחדל אם קיימת, אחרת עוצר.
          if (!e) return { handle: h, steps: [], ends: !hasDefault };
          const c = column(String(e.target), inner);
          return { handle: h, steps: c.list, ends: c.ends };
        });
        list.push({ id, type: node.type, branches });
        id = join;
      } else {
        list.push({ id, type: node.type, branches: null });
        const e = outs.find((x) => hOf(x) === null);
        id = e ? String(e.target) : null;
      }
    }
    return { list, ends: id == null };
  };

  const startEdge = triggerId == null ? null : outsOf(graph, triggerId).find((e) => hOf(e) === null);
  const steps = startEdge ? column(String(startEdge.target), new Set()).list : [];
  if (fail) return { ok: false, ...fail };

  const orphan = nodes.find((n) => String(n.id) !== String(triggerId) && !emitted.has(String(n.id)));
  if (orphan) return { ok: false, reason: 'orphan', nodeId: String(orphan.id) };

  return { ok: true, triggerId: triggerId == null ? null : String(triggerId), steps };
}

/*
 * טור → קשתות. כל הקשתות נבנות מחדש — אין מיזוג עם קשתות ישנות.
 *   צעד רגיל       → קשת בלי handle אל הצעד הבא (או אל ההמשך שירש מהאב).
 *   condition      → קשת פר-ענף; ענף ריק מקבל קשת ישירה אל ההמשך, כדי ש-validateGraph
 *                    יראה גם 'yes' וגם 'no' מחוברים (סמנטית זהה לנפילה לברירת מחדל).
 *   buttons        → קשת ברירת מחדל אל ההמשך + קשת opt:<id> רק לענף לא-ריק, בדיוק
 *                    כמו שהמנוע פותר: אפשרות בלי קשת נופלת לברירת המחדל.
 */
export function outlineToEdges(steps, { triggerId = 'trigger' } = {}) {
  const edges = [];
  const push = (source, target, handle) => {
    if (target == null) return;
    edges.push({
      id: `e_${source}_${handle || 'out'}_${target}`,
      source: String(source),
      target: String(target),
      sourceHandle: handle ?? null,
    });
  };
  const walk = (list, after) => {
    list.forEach((s, i) => {
      const next = i + 1 < list.length ? list[i + 1].id : after;
      if (!s.branches) {
        push(s.id, next, null);
        return;
      }
      const buttons = s.type === 'buttons';
      if (buttons) push(s.id, next, null);
      for (const b of s.branches) {
        const cont = b.ends ? null : next; // ענף שנגמר לא מתחבר לזנב המשותף
        if (b.steps.length) {
          push(s.id, b.steps[0].id, b.handle);
          walk(b.steps, cont);
        } else if (!buttons) {
          push(s.id, cont, b.handle);
        }
      }
    });
  };
  if (steps.length && triggerId != null) push(triggerId, steps[0].id, null);
  walk(steps, null);
  return edges;
}

// ── עריכות על העץ (טהורות — מחזירות עץ חדש) ─────────────────────────────────

/** צעד חדש לטור מתוך צומת גרף. ענף ריק של צעד חדש ממשיך אל מה שמתחתיו. */
export function stepFor(node) {
  const handles = forkHandlesOf(node);
  return {
    id: String(node.id),
    type: node.type,
    branches: handles ? handles.map((h) => ({ handle: h, steps: [], ends: false })) : null,
  };
}

const cloneList = (list) =>
  list.map((s) => (s.branches ? { ...s, branches: s.branches.map((b) => ({ ...b, steps: cloneList(b.steps) })) } : { ...s }));

/** הרשימה שבתוכה יושב הנתיב path ([] = הרשימה הראשית). מחזיר null אם הנתיב לא קיים. */
function listAt(steps, path) {
  let list = steps;
  for (const hop of path || []) {
    const s = list.find((x) => x.id === hop.id);
    const b = s?.branches?.find((x) => x.handle === hop.handle);
    if (!b) return null;
    list = b.steps;
  }
  return list;
}

/** הוספת צעד ב-{path, index}. path = [{id, handle}, …] מהרשימה הראשית פנימה. */
export function insertStep(steps, { path = [], index = 0 } = {}, step) {
  const next = cloneList(steps);
  const list = listAt(next, path);
  if (!list) return steps;
  list.splice(Math.max(0, Math.min(index, list.length)), 0, step);
  return next;
}

/** מחיקת צעד לפי id. צעד מסתעף נמחק עם כל תת-הענפים שלו (רק דרכו הם נגישים). */
export function removeStep(steps, id) {
  const next = cloneList(steps);
  const drop = (list) => {
    const i = list.findIndex((s) => s.id === id);
    if (i >= 0) { list.splice(i, 1); return true; }
    return list.some((s) => (s.branches || []).some((b) => drop(b.steps)));
  };
  return drop(next) ? next : steps;
}

/** הזזת צעד למעלה/למטה בתוך הרשימה שלו בלבד (delta = -1 / +1). */
export function moveStep(steps, id, delta) {
  const next = cloneList(steps);
  const move = (list) => {
    const i = list.findIndex((s) => s.id === id);
    if (i >= 0) {
      const j = i + delta;
      if (j < 0 || j >= list.length) return true; // קצה הרשימה — לא זזים
      [list[i], list[j]] = [list[j], list[i]];
      return true;
    }
    return list.some((s) => (s.branches || []).some((b) => move(b.steps)));
  };
  return move(next) ? next : steps;
}

/** גרירה למיקום מדויק בתוך אותה רשימה; צעד לעולם אינו בורח מהמסלול שלו. */
export function moveStepTo(steps, id, targetIndex) {
  const next = cloneList(steps);
  const move = (list) => {
    const from = list.findIndex((step) => step.id === id);
    if (from >= 0) {
      const to = Math.max(0, Math.min(Number(targetIndex) || 0, list.length - 1));
      if (from === to) return true;
      const [step] = list.splice(from, 1);
      list.splice(to, 0, step);
      return true;
    }
    return list.some((step) => (step.branches || []).some((branch) => move(branch.steps)));
  };
  return move(next) ? next : steps;
}

/**
 * החלפת סוג של צעד בלי להזיז אותו ברשימה. תוכן של מסלולים ישנים מוחזר למתקשר
 * כדי שיוכל להסיר מהגרף השמור צמתים שאינם נגישים עוד.
 */
export function replaceStepType(steps, id, replacement) {
  const next = cloneList(steps);
  let removedIds = [];
  const replace = (list) => {
    const index = list.findIndex((step) => step.id === id);
    if (index >= 0) {
      removedIds = (list[index].branches || []).flatMap((branch) => stepIds(branch.steps));
      list[index] = replacement;
      return true;
    }
    return list.some((step) => (step.branches || []).some((branch) => replace(branch.steps)));
  };
  return replace(next) ? { steps: next, removedIds } : { steps, removedIds: [] };
}

/** בחירה אם ענף חוזר להמשך המשותף או מסיים את הפלואו במקום. */
export function setBranchEnds(steps, nodeId, handle, ends) {
  const next = cloneList(steps);
  const change = (list) => {
    for (const step of list) {
      if (step.id === nodeId) {
        const branch = (step.branches || []).find((item) => item.handle === handle);
        if (!branch) return false;
        branch.ends = !!ends;
        return true;
      }
      if ((step.branches || []).some((branch) => change(branch.steps))) return true;
    }
    return false;
  };
  return change(next) ? next : steps;
}

/** כל המזהים בטור, לפי סדר התצוגה. */
export function stepIds(steps) {
  const out = [];
  const walk = (list) => {
    for (const s of list) {
      out.push(s.id);
      for (const b of s.branches || []) walk(b.steps);
    }
  };
  walk(steps);
  return out;
}

/*
 * מיקומי מטא-דאטה לגרף השמור: הטור יורד למטה וכל ענף מוזח צעד נוסף הצידה.
 * המנוע מתעלם מהמיקומים, אבל ערכים עקביים מקלים על ייצוא ועל תאימות לאחור.
 */
export function outlineLayout(steps, { triggerId = 'trigger', x0 = 260, y0 = 40, dx = 260, dy = 130 } = {}) {
  const pos = {};
  if (triggerId != null) pos[triggerId] = { x: x0, y: y0 };
  let row = 0;
  const walk = (list, depth) => {
    for (const s of list) {
      row += 1;
      pos[s.id] = { x: x0 + depth * dx, y: y0 + row * dy };
      (s.branches || []).forEach((b, i) => walk(b.steps, depth + i + 1));
    }
  };
  walk(steps, 0);
  return pos;
}
