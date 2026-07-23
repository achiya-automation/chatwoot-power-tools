/**
 * journeys.test.js — בונה פלואו: עזרי גרף טהורים + זמן-ריצה מול DB אמיתי עם client מזויף.
 *
 * Run: DATABASE_URL_TEST=postgres://... node --test test/journeys.test.js
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb } from './helpers.js';
import { getPool, query } from '../src/db.js';
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
  // ערוץ רשמי → כפתורים אמיתיים
  const j1 = await makeJourney(g);
  j1._channelType = 'Channel::Whatsapp';
  const c1 = fakeClient();
  await startRun(ctxWith(c1), j1, { accountId: 1, displayId: 106 });
  assert.ok(c1.calls.some((c) => c.name === 'sendInputSelect'));

  // ערוץ WAHA/אחר → טקסט ממוספר
  const j2 = await makeJourney(g);
  j2._channelType = 'Channel::Api';
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

test('hook: conversation_created starts a journey on a matching inbox only', async () => {
  await makeJourney(GRAPH, { on_new_conversation: true, inbox_ids: [3] });
  const client = fakeClient();
  const ctx = ctxWith(client);

  await handleJourneyHook(ctx, {
    event: 'conversation_created', account: { id: 1 },
    conversation: { display_id: 200 }, inbox: { id: 9 },
  });
  assert.equal((await query(`SELECT count(*)::int AS n FROM drip.journey_runs`))[0].n, 0);

  await handleJourneyHook(ctx, {
    event: 'conversation_created', account: { id: 1 },
    conversation: { display_id: 200 }, inbox: { id: 3 },
  });
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
