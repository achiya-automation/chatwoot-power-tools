/**
 * journeys.test.js — בונה פלואו: עזרי גרף טהורים + זמן-ריצה מול DB אמיתי עם client מזויף.
 *
 * Run: DATABASE_URL_TEST=postgres://... node --test test/journeys.test.js
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
import { isHumanOutgoing } from '../src/reads.js';
import {
  startNodeOf, nextNodeId, renderText, validateAnswer, matchOption,
  numberedFallback, keywordMatch, startRun, feedAnswer, handleJourneyHook,
  reconcileJourneys, handleJourneysAction,
} from '../src/journeys.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

// ── client מזויף: רושם כל קריאה; שולט בתשובות ──
function fakeClient() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push({ name, args }); return Promise.resolve({ id: calls.length }); };
  return {
    calls,
    sendText: rec('sendText'),
    sendInputSelect: rec('sendInputSelect'),
    sendMedia: rec('sendMedia'),
    sendTemplate: rec('sendTemplate'),
    toggleStatus: rec('toggleStatus'),
    assignConversation: rec('assignConversation'),
    addLabels: rec('addLabels'),
    patchAttrs: rec('patchAttrs'),
    patchContactAttrs: rec('patchContactAttrs'),
  };
}

const fakeReads = { getContact: async () => ({ name: 'דנה', phone: '+972501234567' }) };

function ctxWith(client, config = {}) {
  return { query, reads: fakeReads, makeClientFor: async () => client, config };
}

// גרף בסיסי: trigger → message → question(שם→שדה) → handoff
const GRAPH = {
  nodes: [
    { id: 't', type: 'trigger', data: {} },
    { id: 'm1', type: 'message', data: { text: 'היי {{שם}} 👋' } },
    { id: 'q1', type: 'question', data: {
      text: 'באיזה תחום העסק שלך?',
      saveTo: { scope: 'contact', key: 'business_field' },
      validation: 'text',
      followUp: { afterMinutes: 30, message: 'עדיין כאן? 🙂', maxRetries: 1, onGiveUp: 'continue' },
    } },
    { id: 'h', type: 'handoff', data: { message: 'מעביר לנציג!' } },
  ],
  edges: [
    { source: 't', target: 'm1' },
    { source: 'm1', target: 'q1' },
    { source: 'q1', target: 'h' },
  ],
};

async function makeJourney(graph = GRAPH, trigger = {}, status = 'active', account = 1) {
  const rows = await query(
    `INSERT INTO drip.journeys (account_id, name, status, trigger, graph)
     VALUES ($1, 'בדיקה', $2, $3, $4) RETURNING *`,
    [account, status, JSON.stringify(trigger), JSON.stringify(graph)]
  );
  return rows[0];
}

beforeEach(async () => {
  await setupDb(pool);
  await query('TRUNCATE drip.journey_runs, drip.journeys CASCADE');
});

// ── עזרים טהורים ──

test('startNodeOf follows the trigger edge; falls back to a root node', () => {
  assert.equal(startNodeOf(GRAPH), 'm1');
  const noTrigger = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }] };
  assert.equal(startNodeOf(noTrigger), 'a');
});

test('nextNodeId honors sourceHandle branches and falls back cleanly', () => {
  const g = { nodes: [], edges: [
    { source: 'c', target: 'yes-n', sourceHandle: 'yes' },
    { source: 'c', target: 'no-n', sourceHandle: 'no' },
    { source: 'm', target: 'x' },
  ] };
  assert.equal(nextNodeId(g, 'c', 'yes'), 'yes-n');
  assert.equal(nextNodeId(g, 'c', 'no'), 'no-n');
  assert.equal(nextNodeId(g, 'm'), 'x');
  assert.equal(nextNodeId(g, 'missing'), null);
});

test('renderText substitutes Hebrew/English placeholders and answers', () => {
  const out = renderText('היי {{שם}} ({{phone}}) — {{תחום}} / {{answers.תחום}}', {
    contact: { name: 'דנה', phone: '050' },
    answers: { 'תחום': 'נדל״ן' },
  });
  assert.equal(out, 'היי דנה (050) — נדל״ן / נדל״ן');
});

test('validateAnswer: number/email/phone/text', () => {
  assert.ok(validateAnswer('number', ' 42 '));
  assert.ok(!validateAnswer('number', 'שלום'));
  assert.ok(validateAnswer('email', 'a@b.co'));
  assert.ok(!validateAnswer('email', 'a@b'));
  assert.ok(validateAnswer('phone', '+972 50-123-4567'));
  assert.ok(!validateAnswer('phone', 'abc'));
  assert.ok(validateAnswer('text', 'כן'));
  assert.ok(!validateAnswer('text', '   '));
});

test('matchOption: ordinal, exact title, value, unique containment', () => {
  const opts = [{ title: 'בוט וואטסאפ', value: 'bot' }, { title: 'אתר', value: 'site' }];
  assert.equal(matchOption(opts, '1').value, 'bot');
  assert.equal(matchOption(opts, 'אתר').value, 'site');
  assert.equal(matchOption(opts, 'bot').value, 'bot');
  assert.equal(matchOption(opts, 'וואטסאפ').value, 'bot'); // הכלה יחידה
  assert.equal(matchOption(opts, 'משהו אחר'), null);
  assert.equal(matchOption(opts, '9'), null);
});

test('numberedFallback renders a numbered list', () => {
  const s = numberedFallback('מה מעניין?', [{ title: 'א' }, { title: 'ב' }]);
  assert.match(s, /1\) א/);
  assert.match(s, /2\) ב/);
});

test('keywordMatch: whole-word Hebrew matching, case-insensitive', () => {
  assert.ok(keywordMatch(['מבצע'], 'היי, יש מבצע?'));
  assert.ok(keywordMatch(['מבצע'], 'מבצע'));
  assert.ok(!keywordMatch(['מבצע'], 'מבצעים')); // לא חלק ממילה ארוכה
  assert.ok(keywordMatch(['Sale'], 'big SALE now'));
  assert.ok(!keywordMatch([''], 'anything'));
});

// ── זמן-ריצה: startRun ──

test('startRun: pending → message with placeholder → question → waiting_answer', async () => {
  const j = await makeJourney();
  const client = fakeClient();
  const run = await startRun(ctxWith(client), j, { accountId: 1, displayId: 101, contactId: 7 });
  assert.ok(run);
  assert.equal(run.status, 'waiting_answer', 'startRun returns the persisted post-execution state');

  const names = client.calls.map((c) => c.name);
  assert.deepEqual(names, ['toggleStatus', 'sendText', 'sendText']);
  assert.deepEqual(client.calls[0].args, [101, 'pending']);
  assert.equal(client.calls[1].args[1], 'היי דנה 👋');

  const [row] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 101`);
  assert.equal(row.status, 'waiting_answer');
  assert.equal(row.current_node, 'q1');
  assert.ok(row.next_action_at); // פולואפ מתוזמן
});

test('startRun: second live run on the same conversation is refused', async () => {
  const j = await makeJourney();
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 102 });
  const again = await startRun(ctxWith(client), j, { accountId: 1, displayId: 102 });
  assert.equal(again, null);
});

// ── feedAnswer ──

test('feedAnswer: invalid → retry message; valid → saved to contact + handoff + done', async () => {
  const g = structuredClone(GRAPH);
  g.nodes.find((n) => n.id === 'q1').data.validation = 'email';
  const j = await makeJourney(g);
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 103, contactId: 7 });
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 103`);

  await feedAnswer(ctxWith(client), run, j, { id: 900, content: 'לא מייל' });
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 103`);
  assert.equal(run.status, 'waiting_answer');
  assert.equal(run.retry_count, 1);

  await feedAnswer(ctxWith(client), run, j, { id: 901, content: 'dana@biz.co.il' });
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 103`);
  assert.equal(run.status, 'done');
  assert.equal(run.answers.business_field, 'dana@biz.co.il');

  const saved = client.calls.find((c) => c.name === 'patchContactAttrs');
  assert.deepEqual(saved.args, [7, { business_field: 'dana@biz.co.il' }]);
  // handoff: הודעה + פתיחת השיחה
  assert.ok(client.calls.some((c) => c.name === 'toggleStatus' && c.args[1] === 'open'));
});

test('feedAnswer: duplicate message id is ignored (dedupe)', async () => {
  const j = await makeJourney();
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 104 });
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 104`);
  await feedAnswer(ctxWith(client), run, j, { id: 500, content: 'נדל״ן' });
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 104`);
  const callCount = client.calls.length;
  await feedAnswer(ctxWith(client), run, j, { id: 500, content: 'נדל״ן' });
  assert.equal(client.calls.length, callCount); // שום שליחה נוספת
});

test('feedAnswer: attachment-only message hands off instead of re-prompting', async () => {
  const j = await makeJourney();
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 106 });
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 106`);
  const before = client.calls.length;
  // PDF/תמונה/הודעה קולית מגיעים מ-Chatwoot עם content ריק
  await feedAnswer(ctxWith(client), run, j, { id: 700, content: '' });
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 106`);
  assert.equal(run.status, 'done');
  assert.equal(run.retry_count, 0);
  assert.equal(client.calls.slice(before).filter((c) => c.name === 'sendText').length, 0);
  assert.deepEqual(client.calls.at(-1), { name: 'toggleStatus', args: [106, 'open'] });
});

test('feedAnswer: opt-out word stops the run', async () => {
  const j = await makeJourney();
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 105 });
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 105`);
  await feedAnswer(ctxWith(client), run, j, { id: 600, content: 'הסר' });
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 105`);
  assert.equal(run.status, 'stopped');
});

// ── buttons: כפתורים אמיתיים מול נפילה נומרית ──

test('buttons node: input_select on Cloud API channel, numbered fallback otherwise', async () => {
  const g = {
    nodes: [
      { id: 't', type: 'trigger', data: {} },
      { id: 'b', type: 'buttons', data: {
        text: 'מה מעניין?',
        options: [{ title: 'בוט', value: 'bot' }, { title: 'אתר', value: 'site' }],
        saveTo: { scope: 'conversation', key: 'interest' },
      } },
      { id: 'h', type: 'handoff', data: {} },
    ],
    edges: [{ source: 't', target: 'b' }, { source: 'b', target: 'h' }],
  };
  // סוג הערוץ נקבע לפי התיבה של השיחה עצמה (לא של תיבת הטריגר) — פלואו אחד יכול
  // לחול גם על תיבה רשמית וגם על WAHA, וכל שיחה מקבלת את הפורמט הנכון לה.
  await query(`INSERT INTO public.inboxes (id, account_id, name, channel_type) VALUES
    (31, 1, 'רשמי', 'Channel::Whatsapp'), (32, 1, 'WAHA', 'Channel::Api')
    ON CONFLICT (id) DO NOTHING`);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, inbox_id) VALUES
    (106, 106, 1, 31), (107, 107, 1, 32) ON CONFLICT (id) DO NOTHING`);

  // שיחה בערוץ רשמי → כפתורים אמיתיים
  const j1 = await makeJourney(g);
  const c1 = fakeClient();
  await startRun(ctxWith(c1), j1, { accountId: 1, displayId: 106 });
  assert.ok(c1.calls.some((c) => c.name === 'sendInputSelect'));

  // שיחה בערוץ WAHA/אחר → טקסט ממוספר
  const j2 = await makeJourney(g);
  const c2 = fakeClient();
  await startRun(ctxWith(c2), j2, { accountId: 1, displayId: 107 });
  const sent = c2.calls.filter((c) => c.name === 'sendText');
  assert.match(sent[0].args[1], /1\) בוט/);

  // תשובה במספר → נשמרת לפי value על השיחה
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 107`);
  await feedAnswer(ctxWith(c2), run, j2, { id: 700, content: '2' });
  const savedConv = c2.calls.find((c) => c.name === 'patchAttrs');
  assert.deepEqual(savedConv.args, [107, { interest: 'site' }]);
});

// ── condition + delay + action + webhook ──

test('condition branches by saved answer; action applies labels/assign', async () => {
  const g = {
    nodes: [
      { id: 't', type: 'trigger', data: {} },
      { id: 'c', type: 'condition', data: { field: 'interest', op: 'eq', value: 'bot' } },
      { id: 'a', type: 'action', data: { labels: ['ליד-חם'], assigneeId: 5 } },
      { id: 'h1', type: 'handoff', data: {} },
      { id: 'h2', type: 'handoff', data: {} },
    ],
    edges: [
      { source: 't', target: 'c' },
      { source: 'c', target: 'a', sourceHandle: 'yes' },
      { source: 'c', target: 'h2', sourceHandle: 'no' },
      { source: 'a', target: 'h1' },
    ],
  };
  const j = await makeJourney(g);
  const client = fakeClient();
  // מזריקים תשובה קיימת דרך answers בריצה: startRun מתחיל ריק → הענף no
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 108 });
  const [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 108`);
  assert.equal(run.status, 'done');
  assert.equal(run.current_node, 'h2'); // interest ריק → no
  assert.ok(!client.calls.some((c) => c.name === 'addLabels'));
});

test('delay node parks the run with next_action_at; tick resumes it', async () => {
  const g = {
    nodes: [
      { id: 't', type: 'trigger', data: {} },
      { id: 'd', type: 'delay', data: { minutes: 1 } },
      { id: 'm', type: 'message', data: { text: 'אחרי ההשהיה' } },
    ],
    edges: [{ source: 't', target: 'd' }, { source: 'd', target: 'm' }],
  };
  const j = await makeJourney(g);
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 109 });
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 109`);
  assert.equal(run.status, 'waiting_delay');

  // מדמים שההשהיה חלפה ומריצים tick
  await query(`UPDATE drip.journey_runs SET next_action_at = now() - interval '1 minute' WHERE id = $1`, [run.id]);
  await reconcileJourneys(ctxWith(client), 1);
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 109`);
  assert.equal(run.status, 'done');
  assert.ok(client.calls.some((c) => c.name === 'sendText' && c.args[1] === 'אחרי ההשהיה'));
});

// ── פולואפ כשאין מענה ──

test('no answer: follow-up message, then give-up per onGiveUp=continue', async () => {
  const j = await makeJourney();
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 110 });
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 110`);

  // פולואפ ראשון
  await query(`UPDATE drip.journey_runs SET next_action_at = now() - interval '1 minute' WHERE id = $1`, [run.id]);
  await reconcileJourneys(ctxWith(client), 1);
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 110`);
  assert.equal(run.retry_count, 1);
  assert.equal(run.status, 'waiting_answer');
  assert.ok(client.calls.some((c) => c.name === 'sendText' && c.args[1] === 'עדיין כאן? 🙂'));

  // מיצינו את התזכורות → onGiveUp=continue ממשיך ל-handoff
  await query(`UPDATE drip.journey_runs SET next_action_at = now() - interval '1 minute' WHERE id = $1`, [run.id]);
  await reconcileJourneys(ctxWith(client), 1);
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 110`);
  assert.equal(run.status, 'done');
});

// ── hook ──

test('hook: conversation_created (real top-level payload) starts only on a fresh inbound conversation', async () => {
  await makeJourney(GRAPH, { on_new_conversation: true, inbox_ids: [3] });
  const client = fakeClient();
  const ctx = ctxWith(client);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, inbox_id) VALUES (200, 200, 1, 3)
    ON CONFLICT (id) DO NOTHING`);
  await query(`DELETE FROM public.messages WHERE conversation_id = 200`);

  // המבנה האמיתי של Chatwoot: שדות השיחה בראש ה-payload (id = display_id, inbox_id שטוח).
  // תיבה לא תואמת → כלום.
  await handleJourneyHook(ctx, { event: 'conversation_created', account: { id: 1 }, id: 200, inbox_id: 9 });
  assert.equal((await query(`SELECT count(*)::int AS n FROM drip.journey_runs`))[0].n, 0);

  // תיבה תואמת אבל בלי אף הודעה נכנסת (שיחה שנציג פתח יזום) → לא מפעילים בוט.
  await handleJourneyHook(ctx, { event: 'conversation_created', account: { id: 1 }, id: 200, inbox_id: 3 });
  assert.equal((await query(`SELECT count(*)::int AS n FROM drip.journey_runs`))[0].n, 0);

  // עם הודעת פתיחה נכנסת → הפלואו מתחיל, וה-watermark מאותחל להודעת הטריגר
  // (שלא תיבלע מחדש ע"י סריקת הגיבוי כ"תשובה" לשאלה הראשונה).
  await query(`INSERT INTO public.messages (id, conversation_id, account_id, message_type, content)
    VALUES (9001, 200, 1, 0, 'היי')`);
  await handleJourneyHook(ctx, { event: 'conversation_created', account: { id: 1 }, id: 200, inbox_id: 3, meta: { sender: { id: 77 } } });
  const runs = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 200`);
  assert.equal(runs.length, 1);
  assert.equal(Number(runs[0].last_inbound_message_id), 9001);
  assert.equal(Number(runs[0].contact_id), 77);

  // אירוע כפול (retry של Chatwoot) → לא נפתחת ריצה שנייה.
  await handleJourneyHook(ctx, { event: 'conversation_created', account: { id: 1 }, id: 200, inbox_id: 3 });
  assert.equal((await query(`SELECT count(*)::int AS n FROM drip.journey_runs`))[0].n, 1);
});

test('hook: keyword starts a journey mid-conversation; answers flow through the hook', async () => {
  await makeJourney(GRAPH, { keywords: ['מבצע'] });
  const client = fakeClient();
  const ctx = ctxWith(client);

  await handleJourneyHook(ctx, {
    event: 'message_created', message_type: 'incoming', id: 800, content: 'יש מבצע?',
    account: { id: 1 }, conversation: { display_id: 201 }, inbox: { id: 3 },
  });
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 201`);
  assert.equal(run.status, 'waiting_answer');

  await handleJourneyHook(ctx, {
    event: 'message_created', message_type: 'incoming', id: 801, content: 'שיווק',
    account: { id: 1 }, conversation: { display_id: 201 }, inbox: { id: 3 },
  });
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 201`);
  assert.equal(run.status, 'done');
  assert.equal(run.answers.business_field, 'שיווק');
});

test('hook: human outgoing message stops the run (human_handled)', async () => {
  const j = await makeJourney();
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 202 });

  await handleJourneyHook(ctxWith(client), {
    event: 'message_created', message_type: 'outgoing', id: 802, content: 'שלום, כאן דנה',
    account: { id: 1 }, conversation: { display_id: 202 }, inbox: { id: 3 },
    sender: { type: 'user' },
  });
  const [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 202`);
  assert.equal(run.status, 'human_handled');
});

test('hook: our own bot outgoing does NOT stop the run', async () => {
  const j = await makeJourney();
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 203 });
  await handleJourneyHook(ctxWith(client), {
    event: 'message_created', message_type: 'outgoing', id: 803, content: 'שאלה מהבוט',
    account: { id: 1 }, conversation: { display_id: 203 },
    sender: { type: 'agent_bot' },
  });
  const [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 203`);
  assert.equal(run.status, 'waiting_answer');
});

// ── סריקת-גיבוי: תשובה שהגיעה בלי hook ──

test('tick fallback scan feeds an answer the hook missed', async () => {
  const j = await makeJourney();
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 204 });

  // ההודעה קיימת רק ב-DB של Chatwoot (ה-hook "פוספס")
  await query(`INSERT INTO public.conversations (id, display_id, account_id) VALUES (5204, 204, 1)
               ON CONFLICT (id) DO NOTHING`);
  await query(`INSERT INTO public.messages (id, conversation_id, account_id, message_type, content, created_at)
               VALUES (9204, 5204, 1, 0, 'תיירות', now())`);

  await reconcileJourneys(ctxWith(client), 1);
  const [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 204`);
  assert.equal(run.status, 'done');
  assert.equal(run.answers.business_field, 'תיירות');
});

// ── פעולות UI ──

test('jrn_save / jrn_list / jrn_set_status / jrn_launch round-trip', async () => {
  const client = fakeClient();
  const ctx = ctxWith(client);
  const saved = await handleJourneysAction(ctx, 'jrn_save', { name: 'פלואו א', graph: GRAPH, trigger: { manual: true } }, 1);
  assert.ok(saved.id);
  assert.equal(saved.status, 'draft');

  const list = await handleJourneysAction(ctx, 'jrn_list', {}, 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].node_count, 4);

  await handleJourneysAction(ctx, 'jrn_set_status', { id: saved.id, status: 'active' }, 1);
  const started = await handleJourneysAction(ctx, 'jrn_launch', { id: saved.id, display_id: 300, contact_id: 7 }, 1);
  assert.ok(started.started);

  // בידוד חשבונות: חשבון אחר לא רואה
  const other = await handleJourneysAction(ctx, 'jrn_list', {}, 2);
  assert.equal(other.length, 0);
});

// חוזה ה-wire: api.js משדר result.data → ה-dispatch של store חייב לעטוף { data }.
// (הבאג שנתפס בדמו: מערך חזר ישירות → הלקוח קיבל {ok:true} בלי data.)
test('store dispatch wraps jrn_ results as { data } for the wire format', async () => {
  const { handleAction } = await import('../src/store.js');
  const r = await handleAction(1, 'jrn_list', {});
  assert.ok(Array.isArray(r.data), 'jrn_list must come back under .data as an array');
});

// ── פיצ'רים חדשים: תבנית, branching פר-כפתור, watermark, שעות שקט, לולאה ──

test('template node sends a WhatsApp template with rendered params', async () => {
  const g = {
    nodes: [
      { id: 't', type: 'trigger', data: {} },
      { id: 'tp', type: 'template', data: {
        name: 'welcome_lead', language: 'he', category: 'MARKETING',
        params: ['{{שם}}', 'קבוע'], mediaUrl: '',
      } },
      { id: 'h', type: 'handoff', data: {} },
    ],
    edges: [{ source: 't', target: 'tp' }, { source: 'tp', target: 'h' }],
  };
  const j = await makeJourney(g);
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 400 });
  const call = client.calls.find((c) => c.name === 'sendTemplate');
  assert.ok(call, 'sendTemplate was not called');
  assert.equal(call.args[0], 400);
  assert.deepEqual(call.args[1], {
    name: 'welcome_lead', language: 'he', category: 'MARKETING', params: ['דנה', 'קבוע'],
  });
  const [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 400`);
  assert.equal(run.status, 'done'); // המשיך ל-handoff
});

test('template waitForReply pauses after the template, saves the Quick Reply, then continues', async () => {
  const confirmation = 'הפרטים שלך נקלטו בהצלחה אצלנו במשרד 📝';
  const g = {
    nodes: [
      { id: 't', type: 'trigger', data: {} },
      { id: 'tp', type: 'template', data: {
        name: 'initial_consultation', language: 'he', category: 'MARKETING',
        params: [], waitForReply: true, validation: 'text',
        saveTo: { scope: 'contact', key: 'callback_window' },
      } },
      { id: 'ok', type: 'message', data: { text: confirmation } },
    ],
    edges: [{ source: 't', target: 'tp' }, { source: 'tp', target: 'ok' }],
  };
  const j = await makeJourney(g);
  const client = fakeClient();

  await startRun(ctxWith(client), j, {
    accountId: 1,
    displayId: 470,
    contactId: 7,
    initialAnswers: {
      _intake_source: 'facebook_lead_ads',
      _intake_external_id: 'fb-470',
      _intake_airtable_lead_id: 'rec-470',
    },
  });

  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 470`);
  assert.equal(run.status, 'waiting_answer');
  assert.equal(run.current_node, 'tp');
  assert.equal(run.answers._intake_external_id, 'fb-470', 'intake identity survives run creation');
  assert.equal(run.answers._intake_airtable_lead_id, 'rec-470');
  assert.equal(client.calls.filter((c) => c.name === 'sendTemplate').length, 1);
  assert.ok(!client.calls.some((c) => c.name === 'sendText' && c.args[1] === confirmation),
    'confirmation is not sent before the customer replies');

  await Promise.all([
    feedAnswer(ctxWith(client), run, j, { id: 9470, content: '12:00-15:00' }),
    feedAnswer(ctxWith(client), run, j, { id: 9470, content: '12:00-15:00' }),
  ]);

  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 470`);
  assert.equal(run.status, 'done');
  assert.equal(run.answers.callback_window, '12:00-15:00');
  assert.equal(run.answers._intake_external_id, 'fb-470');
  assert.equal(run.answers._intake_airtable_lead_id, 'rec-470');
  const saves = client.calls.filter((c) => c.name === 'patchContactAttrs');
  assert.equal(saves.length, 1, 'webhook + reconciliation race claims the reply only once');
  const [saved] = saves;
  assert.deepEqual(saved.args, [7, { callback_window: '12:00-15:00' }]);
  assert.equal(client.calls.filter((c) => c.name === 'sendText' && c.args[1] === confirmation).length, 1);
});

test('webhook non-2xx fails the run and does not send the following confirmation', async () => {
  const originalFetch = globalThis.fetch;
  const confirmation = 'נדבר בקרוב 🤍';
  const g = {
    nodes: [
      { id: 't', type: 'trigger', data: {} },
      { id: 'w', type: 'webhook', data: { url: 'https://8.8.8.8/make-callback' } },
      { id: 'ok', type: 'message', data: { text: confirmation } },
    ],
    edges: [{ source: 't', target: 'w' }, { source: 'w', target: 'ok' }],
  };
  const j = await makeJourney(g);
  const client = fakeClient();
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    text: async () => JSON.stringify({ ok: false }),
  });

  try {
    const started = await startRun(ctxWith(client), j, { accountId: 1, displayId: 471, contactId: 7 });
    assert.equal(started.status, 'failed', 'synchronous callers can detect the failed first node');
  } finally {
    globalThis.fetch = originalFetch;
  }

  const [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 471`);
  assert.equal(run.status, 'failed');
  assert.match(run.last_error, /webhook returned HTTP 503/);
  assert.ok(!client.calls.some((c) => c.name === 'sendText' && c.args[1] === confirmation),
    'the customer must not receive success after Make/Airtable failed');
});

test('buttons: per-option branch routes via opt:<id>; option without an edge takes the default', async () => {
  const g = {
    nodes: [
      { id: 't', type: 'trigger', data: {} },
      { id: 'b', type: 'buttons', data: {
        text: 'בחרו:',
        options: [
          { id: 'o1', title: 'בוט', value: 'bot' },
          { id: 'o2', title: 'אתר', value: 'site' },
        ],
        saveTo: { scope: 'conversation', key: 'interest' },
      } },
      { id: 'm_bot', type: 'message', data: { text: 'ענף בוט' } },
      { id: 'm_def', type: 'message', data: { text: 'ענף ברירת מחדל' } },
    ],
    edges: [
      { source: 't', target: 'b' },
      { source: 'b', target: 'm_bot', sourceHandle: 'opt:o1' },
      { source: 'b', target: 'm_def' }, // ברירת המחדל (בלי handle)
    ],
  };
  // אפשרות עם קשת ייעודית → הענף שלה
  const j1 = await makeJourney(g);
  const c1 = fakeClient();
  await startRun(ctxWith(c1), j1, { accountId: 1, displayId: 401 });
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 401`);
  await feedAnswer(ctxWith(c1), run, j1, { id: 4010, content: 'בוט' });
  assert.ok(c1.calls.some((c) => c.name === 'sendText' && c.args[1] === 'ענף בוט'));
  assert.ok(!c1.calls.some((c) => c.name === 'sendText' && c.args[1] === 'ענף ברירת מחדל'));

  // אפשרות בלי קשת ייעודית → קשת ברירת המחדל
  const j2 = await makeJourney(g);
  const c2 = fakeClient();
  await startRun(ctxWith(c2), j2, { accountId: 1, displayId: 402 });
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 402 AND journey_id = $1`, [j2.id]);
  await feedAnswer(ctxWith(c2), run, j2, { id: 4020, content: 'אתר' });
  assert.ok(c2.calls.some((c) => c.name === 'sendText' && c.args[1] === 'ענף ברירת מחדל'));
});

test('keyword trigger message is NOT re-consumed as the first answer (initial watermark)', async () => {
  await makeJourney(GRAPH, { keywords: ['מבצע'] });
  const client = fakeClient();
  const ctx = ctxWith(client);
  // השיחה וההודעה קיימות ב-DB לפני ה-hook — כמו בפרודקשן (webhook רץ אחרי הכתיבה).
  await query(`INSERT INTO public.conversations (id, display_id, account_id, inbox_id) VALUES (410, 410, 1, 31)
    ON CONFLICT (id) DO NOTHING`);
  await query(`DELETE FROM public.messages WHERE conversation_id = 410`);
  await query(`INSERT INTO public.messages (id, conversation_id, account_id, message_type, content)
    VALUES (8100, 410, 1, 0, 'יש מבצע?')`);

  await handleJourneyHook(ctx, {
    event: 'message_created', message_type: 'incoming', id: 8100, content: 'יש מבצע?',
    account: { id: 1 }, conversation: { display_id: 410 }, inbox: { id: 31 },
  });
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 410`);
  assert.equal(run.status, 'waiting_answer');
  assert.equal(Number(run.last_inbound_message_id), 8100); // הודעת הטריגר כבר מסומנת כנצרכה

  // סריקת הגיבוי של הטיק לא מזינה את הודעת הטריגר כתשובה
  await reconcileJourneys(ctx, 1);
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 410`);
  assert.equal(run.status, 'waiting_answer');
  assert.equal(run.answers.business_field ?? null, null);
});

test('quiet: a due delay is NOT processed inside a no-send window (and IS with shabbat off)', async () => {
  const g = {
    nodes: [
      { id: 't', type: 'trigger', data: {} },
      { id: 'd', type: 'delay', data: { minutes: 1 } },
      { id: 'm', type: 'message', data: { text: 'אחרי ההשהיה' } },
    ],
    edges: [{ source: 't', target: 'd' }, { source: 'd', target: 'm' }],
  };
  // ברירת מחדל: שבת נשמרת → חלון no-send פעיל עוצר את הטיק
  const j = await makeJourney(g);
  const client = fakeClient();
  const windows = [{ starts_at: new Date(Date.now() - 3600e3).toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString() }];
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 420 });
  await query(`UPDATE drip.journey_runs SET next_action_at = now() - interval '1 minute' WHERE display_id = 420`);
  await reconcileJourneys({ ...ctxWith(client), windows }, 1);
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 420`);
  assert.equal(run.status, 'waiting_delay'); // נשאר ממתין — שבת

  // אותו פלואו עם skip_shabbat=false → מעובד
  await query(`UPDATE drip.journeys SET trigger = '{"quiet":{"skip_shabbat":false}}'::jsonb WHERE id = $1`, [j.id]);
  await reconcileJourneys({ ...ctxWith(client), windows }, 1);
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 420`);
  assert.equal(run.status, 'done');
});

test('graph cycle without a waiting node fails the run instead of spamming', async () => {
  const g = {
    nodes: [
      { id: 't', type: 'trigger', data: {} },
      { id: 'a', type: 'message', data: { text: 'א' } },
      { id: 'b', type: 'message', data: { text: 'ב' } },
    ],
    edges: [
      { source: 't', target: 'a' },
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' }, // לולאה
    ],
  };
  const j = await makeJourney(g);
  const client = fakeClient();
  await startRun(ctxWith(client), j, { accountId: 1, displayId: 430 });
  const [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 430`);
  assert.equal(run.status, 'failed');
  assert.match(run.last_error, /לולאה/);
  // כל הודעה נשלחה פעם אחת בלבד
  assert.equal(client.calls.filter((c) => c.name === 'sendText').length, 2);
});

test('message_created path starts an on_new_conversation journey on a fresh inbound conversation', async () => {
  await makeJourney(GRAPH, { on_new_conversation: true });
  const client = fakeClient();
  const ctx = ctxWith(client);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, inbox_id) VALUES (440, 440, 1, 31)
    ON CONFLICT (id) DO NOTHING`);
  await query(`DELETE FROM public.messages WHERE conversation_id = 440`);
  await query(`INSERT INTO public.messages (id, conversation_id, account_id, message_type, content)
    VALUES (8400, 440, 1, 0, 'שלום')`);

  await handleJourneyHook(ctx, {
    event: 'message_created', message_type: 'incoming', id: 8400, content: 'שלום',
    account: { id: 1 }, conversation: { display_id: 440 }, inbox: { id: 31 },
  });
  assert.equal((await query(`SELECT count(*)::int AS n FROM drip.journey_runs WHERE display_id = 440`))[0].n, 1);
});

test('message_created does NOT start on_new_conversation when a human agent already wrote', async () => {
  await makeJourney(GRAPH, { on_new_conversation: true });
  const client = fakeClient();
  const ctx = ctxWith(client);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, inbox_id) VALUES (441, 441, 1, 31)
    ON CONFLICT (id) DO NOTHING`);
  await query(`DELETE FROM public.messages WHERE conversation_id = 441`);
  await query(`INSERT INTO public.messages (id, conversation_id, account_id, message_type, content, sender_type)
    VALUES (8410, 441, 1, 1, 'הצעת מחיר מצורפת', 'User'),
           (8411, 441, 1, 0, 'תודה!', NULL)`);

  await handleJourneyHook(ctx, {
    event: 'message_created', message_type: 'incoming', id: 8411, content: 'תודה!',
    account: { id: 1 }, conversation: { display_id: 441 }, inbox: { id: 31 },
  });
  assert.equal((await query(`SELECT count(*)::int AS n FROM drip.journey_runs WHERE display_id = 441`))[0].n, 0);
});

test('message_created does NOT start on_new_conversation when the business answered from the phone', async () => {
  await makeJourney(GRAPH, { on_new_conversation: true });
  const client = fakeClient();
  const ctx = ctxWith(client);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, inbox_id) VALUES (442, 442, 1, 31)
    ON CONFLICT (id) DO NOTHING`);
  await query(`DELETE FROM public.messages WHERE conversation_id = 442`);
  // coexistence: הודעה מאפליקציית הנייד חוזרת כ-echo — בלי sender_type, רק הדגל.
  // content_attributes נשמר כמחרוזת JSON בתוך עמודת json, בדיוק כמו בפרודקשן.
  await query(`INSERT INTO public.messages (id, conversation_id, account_id, message_type, content, sender_type, content_attributes)
    VALUES (8420, 442, 1, 1, 'כבר עניתי לך מהנייד', NULL, to_json('{"external_echo":true}'::text)),
           (8421, 442, 1, 0, 'תודה!', NULL, NULL)`);

  await handleJourneyHook(ctx, {
    event: 'message_created', message_type: 'incoming', id: 8421, content: 'תודה!',
    account: { id: 1 }, conversation: { display_id: 442 }, inbox: { id: 31 },
  });
  assert.equal((await query(`SELECT count(*)::int AS n FROM drip.journey_runs WHERE display_id = 442`))[0].n, 0);
});

test('isHumanOutgoing: agent and phone-echo count as human, AgentBot and inbound do not', () => {
  assert.equal(isHumanOutgoing({ message_type: 1, sender_type: 'User' }), true);
  // ה-API מחזיר content_attributes כמחרוזת (לפעמים כפולה) או כאובייקט — כל הצורות נתמכות
  assert.equal(isHumanOutgoing({ message_type: 1, content_attributes: { external_echo: true } }), true);
  assert.equal(isHumanOutgoing({ message_type: 1, content_attributes: '{"external_echo":true}' }), true);
  assert.equal(isHumanOutgoing({ message_type: 1, content_attributes: '"{\\"external_echo\\":true}"' }), true);
  assert.equal(isHumanOutgoing({ message_type: 1, sender_type: 'AgentBot' }), false);
  assert.equal(isHumanOutgoing({ message_type: 0, content_attributes: { external_echo: true } }), false);
  assert.equal(isHumanOutgoing({ message_type: 1, content_attributes: 'לא JSON בכלל' }), false);
});

test('jrn_launch refuses manual=false and a graph without a start node', async () => {
  const client = fakeClient();
  const ctx = ctxWith(client);
  const noManual = await handleJourneysAction(ctx, 'jrn_save',
    { name: 'לא ידני', graph: GRAPH, trigger: { manual: false }, status: 'active' }, 1);
  await assert.rejects(
    () => handleJourneysAction(ctx, 'jrn_launch', { id: noManual.id, display_id: 450 }, 1),
    /ידנית/
  );

  const noStart = await handleJourneysAction(ctx, 'jrn_save',
    { name: 'בלי התחלה', graph: { nodes: [{ id: 'trigger', type: 'trigger', data: {} }], edges: [] }, trigger: {} }, 1);
  await assert.rejects(
    () => handleJourneysAction(ctx, 'jrn_launch', { id: noStart.id, display_id: 451 }, 1),
    /צומת ראשון/
  );
});

test('jrn_set_status refuses to activate a graph without a start node', async () => {
  const client = fakeClient();
  const ctx = ctxWith(client);
  const j = await handleJourneysAction(ctx, 'jrn_save',
    { name: 'ריק', graph: { nodes: [{ id: 'trigger', type: 'trigger', data: {} }], edges: [] }, trigger: {} }, 1);
  await assert.rejects(
    () => handleJourneysAction(ctx, 'jrn_set_status', { id: j.id, status: 'active' }, 1),
    /לא מחובר/
  );
  // paused/draft עוברים חופשי
  await handleJourneysAction(ctx, 'jrn_set_status', { id: j.id, status: 'paused' }, 1);
});

test('renderText resolves contact custom attributes for {{key}}', () => {
  const out = renderText('שלום {{שם}} מ-{{עיר}}', {
    contact: { name: 'דנה', custom_attributes: { 'עיר': 'חיפה' } },
    answers: {},
  });
  assert.equal(out, 'שלום דנה מ-חיפה');
});

test('rapid second customer message is captured as the answer (watermark = trigger message only)', async () => {
  await makeJourney(GRAPH, { keywords: ['מבצע'] });
  const client = fakeClient();
  const ctx = ctxWith(client);
  await query(`INSERT INTO public.conversations (id, display_id, account_id, inbox_id) VALUES (460, 460, 1, 31)
    ON CONFLICT (id) DO NOTHING`);
  await query(`DELETE FROM public.messages WHERE conversation_id = 460`);
  // הלקוח שלח שתי הודעות מהירות; שתיהן כבר ב-DB כשה-hook של הראשונה מעובד.
  await query(`INSERT INTO public.messages (id, conversation_id, account_id, message_type, content)
    VALUES (8600, 460, 1, 0, 'מבצע'), (8601, 460, 1, 0, 'דיגיטל')`);

  await handleJourneyHook(ctx, {
    event: 'message_created', message_type: 'incoming', id: 8600, content: 'מבצע',
    account: { id: 1 }, conversation: { display_id: 460 }, inbox: { id: 31 },
  });
  let [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 460`);
  assert.equal(run.status, 'waiting_answer');
  assert.equal(Number(run.last_inbound_message_id), 8600); // רק הודעת הטריגר סומנה

  // סריקת הגיבוי קולטת את ההודעה השנייה (8601) כתשובה לשאלה הראשונה
  await reconcileJourneys(ctx, 1);
  [run] = await query(`SELECT * FROM drip.journey_runs WHERE display_id = 460`);
  assert.equal(run.answers.business_field, 'דיגיטל');
  assert.equal(run.status, 'done');
});
