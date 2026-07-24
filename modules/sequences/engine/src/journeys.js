/**
 * journeys.js — בונה פלואו (ManyChat-style): זמן-הריצה.
 *
 * שלושה שערי כניסה:
 *   1. handleJourneyHook  — webhook זמן-אמת מ-Chatwoot (message_created / conversation_created):
 *                           טריגרים, קליטת תשובות, זיהוי השתלטות נציג. עונה מיד — לא ממתין ל-tick.
 *   2. reconcileJourneys  — ה-tick (60s): השהיות שהבשילו, פולואפים כשאין מענה, וסריקת-גיבוי
 *                           להודעות שה-webhook פספס (watermark על last_inbound_message_id).
 *   3. handleJourneysAction — פעולות ה-UI (jrn_*): CRUD דרך ה-RPCs של מיגרציה 033 + הפעלה ידנית.
 *
 * הגרף: { nodes: [{id, type, data}], edges: [{source, target, sourceHandle}] }.
 * טיפוסי צמתים: trigger | message | question | buttons | condition | delay | action | webhook | handoff.
 * מצב הריצה חי ב-drip.journey_runs — צומת נוכחי, תשובות, ותזמון הפעולה הבאה.
 */
import { createHmac } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { isOptOut } from './compliance.js';

const LIVE = ['active', 'waiting_answer', 'waiting_delay'];

// 🔒 סוד ה-hook הספציפי לחשבון: HMAC(master, account_id). כל חשבון מקבל נתיב-webhook
// משלו, כך שחשיפת הסוד של דייר אחד (שרואה אותו ב-Settings→Integrations) לא מאפשרת זיוף
// אירועים עבור דייר אחר — צריך את סוד-האב כדי לחשב HMAC של חשבון אחר.
export function perAccountHookToken(masterSecret, accountId) {
  return createHmac('sha256', String(masterSecret)).update(String(accountId)).digest('hex');
}
// ולידציות תשובה: מספר/מייל/טלפון — רשימה סגורה קטנה; 'text' מקבל הכל.
const VALIDATORS = {
  text: (t) => t.trim().length > 0,
  number: (t) => /^[\d\s.,+-]+$/.test(t.trim()) && /\d/.test(t),
  email: (t) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t.trim()),
  phone: (t) => /^[+\d][\d\s()-]{6,}$/.test(t.trim()),
};
const MAX_INVALID_RETRIES = 5; // מעצור לולאת "תשובה לא תקינה" (בוט מול בוט)

// ── עזרי גרף ──
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

export function nextNodeId(graph, nodeId, handle = null) {
  const edges = (graph?.edges || []).filter((e) => e.source === nodeId);
  if (!edges.length) return null;
  if (handle != null) {
    const m = edges.find((e) => String(e.sourceHandle ?? '') === String(handle));
    if (m) return m.target;
  }
  // fallback: קשת בלי handle (צומת עם יציאה אחת)
  return (edges.find((e) => e.sourceHandle == null) || edges[0]).target;
}

const nodeById = (graph, id) => (graph?.nodes || []).find((n) => n.id === id) || null;

// ── תבניות טקסט: {{שם}}/{{name}}, {{טלפון}}/{{phone}}, {{answers.key}} או {{key}} ──
export function renderText(text, { contact = {}, answers = {} } = {}) {
  return String(text || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, raw) => {
    const key = raw.trim();
    if (['שם', 'name'].includes(key)) return contact.name || '';
    if (['טלפון', 'phone'].includes(key)) return contact.phone || '';
    if (['מייל', 'email'].includes(key)) return contact.email || '';
    const k = key.replace(/^answers\./, '');
    return answers[k] != null ? String(answers[k]) : '';
  });
}

export function validateAnswer(kind, text) {
  const v = VALIDATORS[kind] || VALIDATORS.text;
  return v(String(text || ''));
}

// כפתורים אמיתיים רק בערוץ ה-Cloud API הרשמי; בכל ערוץ אחר — נפילה לרשימה ממוספרת.
const channelSupportsButtons = (channelType) => channelType === 'Channel::Whatsapp';

export function numberedFallback(text, options) {
  const lines = options.map((o, i) => `${i + 1}) ${o.title}`);
  return `${text}\n${lines.join('\n')}\nהשיבו במספר או בטקסט של האפשרות.`;
}

/** פענוח תשובת בחירה: מספר סידורי, כותרת מלאה, value, או הכלה חלקית (יחידה). */
export function matchOption(options, text) {
  const t = String(text || '').trim();
  const idx = Number(t);
  if (Number.isInteger(idx) && idx >= 1 && idx <= options.length) return options[idx - 1];
  const byTitle = options.find((o) => o.title.trim() === t || String(o.value ?? '').trim() === t);
  if (byTitle) return byTitle;
  const contains = options.filter((o) => t && o.title.includes(t));
  return contains.length === 1 ? contains[0] : null;
}

// ── DB helpers ──
// pg מחזיר bigint כמחרוזת — מנרמלים את השדות המספריים של ריצה פעם אחת, במקור.
const toRun = (r) => r && ({
  ...r,
  display_id: Number(r.display_id),
  contact_id: r.contact_id == null ? null : Number(r.contact_id),
  last_inbound_message_id: Number(r.last_inbound_message_id || 0),
  retry_count: Number(r.retry_count || 0),
});

async function getRun(query, accountId, displayId) {
  const rows = await query(
    `SELECT * FROM drip.journey_runs
      WHERE account_id = $1 AND display_id = $2 AND status = ANY($3)
      LIMIT 1`,
    [accountId, displayId, LIVE]
  );
  return toRun(rows[0]) || null;
}

// Column names become SQL identifiers here (they can't be $-parameters), so they MUST come
// from this hardcoded allow-list — never from anything caller/attacker-influenced. All values
// are still passed as bound $-parameters. Every call site uses these literal keys today; the
// allow-list is defense-in-depth so a future call with a bad key throws instead of injecting.
const RUN_COLUMNS = new Set([
  'status', 'current_node', 'answers', 'retry_count',
  'waiting_since', 'next_action_at', 'last_inbound_message_id', 'last_error',
]);
async function updateRun(query, id, fields) {
  const keys = Object.keys(fields);
  const bad = keys.find((k) => !RUN_COLUMNS.has(k));
  if (bad) throw new Error(`updateRun: illegal column ${bad}`);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const vals = keys.map((k) => (k === 'answers' ? JSON.stringify(fields[k]) : fields[k]));
  await query(`UPDATE drip.journey_runs SET ${sets}, updated_at = now() WHERE id = $1`, [id, ...vals]);
}

async function activeJourneys(query, accountId) {
  const rows = await query(
    `SELECT * FROM drip.journeys WHERE account_id = $1 AND status = 'active'`,
    [accountId]
  );
  return rows;
}

// ── ביצוע הגרף: מתקדם עד צומת ממתין (שאלה/השהיה) או עד הסוף ──
export async function executeFrom(ctx, run, journey, nodeId) {
  const { query, reads, log = console } = ctx;
  run = toRun(run);
  const client = ctx.client || await ctx.makeClientFor(run.account_id);
  const graph = journey.graph;
  let currentId = nodeId;
  let answers = run.answers || {};
  let guard = 0;

  while (currentId && guard < 50) {
    guard += 1;
    const node = nodeById(graph, currentId);
    if (!node) break;
    const d = node.data || {};
    const contact = await reads.getContact(run.display_id, run.account_id).catch(() => ({}));
    const rctx = { contact, answers };

    try {
      switch (node.type) {
        case 'message': {
          if (d.mediaUrl) await client.sendMedia(run.display_id, { content: renderText(d.text, rctx), mediaUrl: d.mediaUrl });
          else await client.sendText(run.display_id, renderText(d.text, rctx));
          currentId = nextNodeId(graph, currentId);
          break;
        }
        case 'question': {
          await client.sendText(run.display_id, renderText(d.text, rctx));
          await updateRun(query, run.id, {
            status: 'waiting_answer', current_node: currentId, answers,
            retry_count: 0, waiting_since: new Date(),
            next_action_at: d.followUp?.afterMinutes ? new Date(Date.now() + d.followUp.afterMinutes * 60000) : null,
          });
          return;
        }
        case 'buttons': {
          const options = d.options || [];
          const channelType = journey._channelType || '';
          const prompt = renderText(d.text, rctx);
          if (channelSupportsButtons(channelType) && options.length && options.length <= 10) {
            await client.sendInputSelect(run.display_id, prompt,
              options.map((o) => ({ title: o.title, value: String(o.value ?? o.title) })));
          } else {
            await client.sendText(run.display_id, numberedFallback(prompt, options));
          }
          await updateRun(query, run.id, {
            status: 'waiting_answer', current_node: currentId, answers,
            retry_count: 0, waiting_since: new Date(),
            next_action_at: d.followUp?.afterMinutes ? new Date(Date.now() + d.followUp.afterMinutes * 60000) : null,
          });
          return;
        }
        case 'condition': {
          const val = answers[d.field] ?? contact[d.field] ?? '';
          let pass = false;
          if (d.op === 'exists') pass = String(val) !== '';
          else if (d.op === 'contains') pass = String(val).includes(String(d.value ?? ''));
          else pass = String(val).trim() === String(d.value ?? '').trim(); // eq
          currentId = nextNodeId(graph, currentId, pass ? 'yes' : 'no');
          break;
        }
        case 'delay': {
          const ms = ((d.days || 0) * 1440 + (d.hours || 0) * 60 + (d.minutes || 0)) * 60000;
          await updateRun(query, run.id, {
            status: 'waiting_delay', current_node: currentId, answers,
            next_action_at: new Date(Date.now() + Math.max(ms, 60000)),
          });
          return;
        }
        case 'action': {
          if (Array.isArray(d.labels) && d.labels.length) await client.addLabels(run.display_id, d.labels);
          if (d.assigneeId || d.teamId) await client.assignConversation(run.display_id, { assigneeId: d.assigneeId, teamId: d.teamId });
          if (d.status) await client.toggleStatus(run.display_id, d.status);
          if (d.webhookUrl) await postWebhook(d.webhookUrl, { journey, node, run, answers, contact });
          currentId = nextNodeId(graph, currentId);
          break;
        }
        case 'webhook': {
          const res = await postWebhook(d.url, {
            journey: { id: journey.id, name: journey.name },
            account_id: run.account_id,
            conversation: { display_id: run.display_id },
            contact, answers,
          });
          if (d.saveResponseTo && res != null) answers = { ...answers, [d.saveResponseTo]: res };
          currentId = nextNodeId(graph, currentId);
          break;
        }
        case 'handoff': {
          if (d.message) await client.sendText(run.display_id, renderText(d.message, rctx));
          if (d.assigneeId || d.teamId) await client.assignConversation(run.display_id, { assigneeId: d.assigneeId, teamId: d.teamId });
          await client.toggleStatus(run.display_id, 'open');
          await updateRun(query, run.id, { status: 'done', current_node: currentId, answers, next_action_at: null });
          return;
        }
        default:
          currentId = nextNodeId(graph, currentId);
      }
    } catch (e) {
      log.error?.(`[journeys] node ${node.type}/${currentId} failed on conv ${run.display_id}: ${e.message}`);
      await updateRun(query, run.id, { status: 'failed', last_error: `${node.type}: ${e.message}`, answers });
      return;
    }
  }

  // סוף טבעי בלי handoff — לא משאירים שיחה תקועה ב-pending: פותחים לטיפול אנושי.
  try { await client.toggleStatus(run.display_id, 'open'); } catch { /* לא קריטי */ }
  await updateRun(query, run.id, { status: 'done', current_node: currentId, answers, next_action_at: null });
}

// 🔒 SSRF guard: צומת webhook נשלט ע"י אדמין-החשבון, והמנוע יושב על רשת ה-Docker
// הפנימית (rails, postgres) עם גישה ל-PII. בלי הגנה, אדמין יכול לכוון את ה-fetch לשירות
// פנימי או ל-169.254.169.254 (metadata) ואף לחלץ את התשובה דרך saveResponseTo. לכן:
// רק http/https, והיעד נפתר (DNS) ונבדק שאינו כתובת פרטית/loopback/link-local.
function isPrivateIp(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split('.').map(Number);
    return p[0] === 10
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168)
      || p[0] === 127
      || (p[0] === 169 && p[1] === 254)          // link-local + cloud metadata
      || p[0] === 0;
  }
  const s = ip.toLowerCase();
  return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd')  // ULA
    || s.startsWith('fe80') || s.startsWith('::ffff:127.') || s.startsWith('::ffff:169.254');
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('bad webhook url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('webhook url must be http(s)');
  const host = u.hostname;
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('webhook url resolves to a private address');
    return;
  }
  // hostname → resolve every address and reject if any is private (DNS-rebinding-safe enough)
  const addrs = await dnsLookup(host, { all: true }).catch(() => { throw new Error('webhook host does not resolve'); });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error('webhook url resolves to a private address');
  }
}

async function postWebhook(url, payload) {
  await assertPublicUrl(url);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
      redirect: 'error',                          // a 30x to an internal host would re-open SSRF
    });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return text || null; }
  } finally {
    clearTimeout(t);
  }
}

// ── התחלת ריצה ──
export async function startRun(ctx, journey, { accountId, displayId, contactId }) {
  const { query } = ctx;
  const client = ctx.client || await ctx.makeClientFor(accountId);
  const first = startNodeOf(journey.graph);
  if (!first) return null;
  let run;
  try {
    const rows = await query(
      `INSERT INTO drip.journey_runs (journey_id, account_id, display_id, contact_id, status, current_node)
       VALUES ($1, $2, $3, $4, 'active', $5) RETURNING *`,
      [journey.id, accountId, displayId, contactId || null, first]
    );
    run = rows[0];
  } catch (e) {
    if (String(e.message).includes('uq_journey_runs_live')) return null; // כבר יש פלואו חי בשיחה
    throw e;
  }
  // הבוט לוקח בעלות: השיחה עוברת ל-pending (הנציגים רואים שהבוט מטפל).
  try { await client.toggleStatus(displayId, 'pending'); } catch { /* ערוץ בלי סטטוס — ממשיכים */ }
  await executeFrom({ ...ctx, client }, run, journey, first);
  return run;
}

// ── קליטת הודעה נכנסת לריצה ממתינה ──
export async function feedAnswer(ctx, run, journey, message) {
  const { query, reads } = ctx;
  run = toRun(run);
  const client = ctx.client || await ctx.makeClientFor(run.account_id);
  ctx = { ...ctx, client };
  const text = String(message.content || '').trim();
  const messageId = Number(message.id) || 0;
  if (messageId && messageId <= Number(run.last_inbound_message_id || 0)) return; // דדופ

  const graph = journey.graph;
  const node = nodeById(graph, run.current_node);
  if (!node) return;
  const d = node.data || {};
  let answers = run.answers || {};

  // מילת עצירה (הסר וכו') — הפלואו נעצר; ההסרה החשבונית מטופלת ב-compliance הרגיל.
  if (isOptOut(text)) {
    await updateRun(query, run.id, { status: 'stopped', last_inbound_message_id: messageId, answers });
    return;
  }

  let value = null;
  if (node.type === 'buttons') {
    const opt = matchOption(d.options || [], text);
    if (!opt) {
      const retries = (run.retry_count || 0) + 1;
      if (retries >= MAX_INVALID_RETRIES) {
        await updateRun(query, run.id, { status: 'stopped', last_error: 'too many invalid answers', last_inbound_message_id: messageId });
        return;
      }
      const contact = await reads.getContact(run.display_id, run.account_id).catch(() => ({}));
      await client.sendText(run.display_id,
        d.retryMessage || numberedFallback(renderText(d.text, { contact, answers }), d.options || []));
      await updateRun(query, run.id, { retry_count: retries, last_inbound_message_id: messageId });
      return;
    }
    value = String(opt.value ?? opt.title);
  } else { // question
    const kind = d.validation || 'text';
    if (!validateAnswer(kind, text)) {
      const retries = (run.retry_count || 0) + 1;
      if (retries >= MAX_INVALID_RETRIES) {
        await updateRun(query, run.id, { status: 'stopped', last_error: 'too many invalid answers', last_inbound_message_id: messageId });
        return;
      }
      await client.sendText(run.display_id, d.retryMessage || defaultRetryMessage(kind));
      await updateRun(query, run.id, { retry_count: retries, last_inbound_message_id: messageId });
      return;
    }
    value = text;
  }

  // שמירה: answers בריצה + שדה מותאם באיש הקשר (ברירת מחדל) או בשיחה.
  const key = d.saveTo?.key;
  if (key) {
    answers = { ...answers, [key]: value };
    try {
      if ((d.saveTo?.scope || 'contact') === 'conversation') {
        await client.patchAttrs(run.display_id, { [key]: value });
      } else if (run.contact_id) {
        await client.patchContactAttrs(run.contact_id, { [key]: value });
      } else {
        await client.patchAttrs(run.display_id, { [key]: value });
      }
    } catch (e) {
      console.warn(`[journeys] saving answer '${key}' failed: ${e.message}`);
    }
  }

  await updateRun(query, run.id, {
    status: 'active', answers, retry_count: 0,
    waiting_since: null, next_action_at: null, last_inbound_message_id: messageId,
  });
  await executeFrom(ctx, { ...run, answers, last_inbound_message_id: messageId }, journey, nextNodeId(graph, run.current_node));
}

const defaultRetryMessage = (kind) => ({
  number: 'לא זיהיתי מספר — אפשר לכתוב שוב, בספרות?',
  email: 'זו לא נראית כתובת מייל תקינה — אפשר לנסות שוב?',
  phone: 'זה לא נראה מספר טלפון תקין — אפשר לנסות שוב?',
}[kind] || 'לא הצלחתי להבין — אפשר לנסח שוב?');

// ── מילות מפתח: התאמת מילה-שלמה, לא רגישת רישיות ──
export function keywordMatch(keywords, text) {
  const t = String(text || '').toLowerCase();
  return (keywords || []).some((k) => {
    const kw = String(k || '').trim().toLowerCase();
    if (!kw) return false;
    // גבולות מילה ידידותיים לעברית: תחילת/סוף מחרוזת או תו שאינו אות/ספרה
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, 'u').test(t);
  });
}

// ── webhook זמן-אמת מ-Chatwoot ──
export async function handleJourneyHook(ctx, event) {
  const { query, makeClientFor, log = console } = ctx;
  const accountId = Number(event?.account?.id);
  if (!accountId) return;
  const journeys = await activeJourneys(query, accountId);
  if (!journeys.length) return;

  const conv = event.conversation || {};
  const displayId = Number(conv.display_id ?? conv.id);
  if (!displayId) return;
  const inboxId = Number(event.inbox?.id ?? conv.inbox_id) || null;
  const contactId = Number(event.conversation?.contact_inbox?.contact_id ?? event.sender?.id) || null;

  const inboxAllowed = (j) => {
    const ids = j.trigger?.inbox_ids || [];
    return !ids.length || (inboxId && ids.map(Number).includes(inboxId));
  };

  if (event.event === 'conversation_created') {
    const j = journeys.find((x) => x.trigger?.on_new_conversation && inboxAllowed(x));
    if (!j) return;
    const client = await makeClientFor(accountId);
    await prepJourney(query, j);
    await startRun({ ...ctx, client }, j, { accountId, displayId, contactId });
    return;
  }

  if (event.event !== 'message_created') return;

  // הודעה יוצאת של נציג אנושי (לא הבוט שלנו) = השתלטות → הפלואו נעצר ומפנה מקום.
  if (event.message_type === 'outgoing') {
    if (String(event.sender?.type || '').toLowerCase() !== 'agent_bot') {
      const run = await getRun(query, accountId, displayId);
      if (run) await updateRun(query, run.id, { status: 'human_handled' });
    }
    return;
  }
  if (event.message_type !== 'incoming') return;
  if (event.private) return;

  const run = await getRun(query, accountId, displayId);
  if (run) {
    if (run.status !== 'waiting_answer') {
      // הודעה באמצע השהיה/ביצוע — רק מקדמים watermark (הפלואו ממשיך כרגיל)
      const mid = Number(event.id) || 0;
      if (mid > Number(run.last_inbound_message_id || 0)) {
        await updateRun(query, run.id, { last_inbound_message_id: mid });
      }
      return;
    }
    const journey = journeys.find((j) => j.id === run.journey_id)
      || (await query(`SELECT * FROM drip.journeys WHERE id = $1`, [run.journey_id]))[0];
    if (!journey) return;
    const client = await makeClientFor(accountId);
    await prepJourney(query, journey);
    await feedAnswer({ ...ctx, client }, run, journey, { id: event.id, content: event.content });
    return;
  }

  // אין ריצה חיה — טריגר מילת מפתח פותח פלואו גם באמצע שיחה קיימת.
  const j = journeys.find((x) => (x.trigger?.keywords || []).length
    && inboxAllowed(x) && keywordMatch(x.trigger.keywords, event.content));
  if (!j) return;
  // 🔒 הגבלת-קצב: לקוח חיצוני יכול להקליד את מילת-המפתח שוב ושוב. uq_journey_runs_live מונע
  // ריצה כפולה בו-זמנית, אבל אחרי סיום/עצירה מילה חוזרת הייתה מפעילה שוב ושוב — ספאם, עלות
  // תבניות, וסיכון WABA. חוסמים הפעלה חוזרת בשיחה אם כבר הייתה ריצה ב-30 הדקות האחרונות.
  const recent = await query(
    `SELECT 1 FROM drip.journey_runs
      WHERE account_id = $1 AND display_id = $2 AND created_at > now() - interval '30 minutes'
      LIMIT 1`,
    [accountId, displayId]
  );
  if (recent.length) { log.info?.(`[journeys] keyword rate-limited on conv ${displayId} (account ${accountId})`); return; }
  const client = await makeClientFor(accountId);
  await prepJourney(query, j);
  await startRun({ ...ctx, client }, j, { accountId, displayId, contactId });
  log.info?.(`[journeys] keyword-triggered '${j.name}' on conv ${displayId} (account ${accountId})`);
}

// טעינת סוג הערוץ של תיבת הטריגר — פעם אחת לכל ביצוע (כפתורים אמיתיים או נומריים).
async function prepJourney(query, journey) {
  if (journey._channelType !== undefined) return;
  const ids = journey.trigger?.inbox_ids || [];
  if (ids.length) {
    const rows = await query(`SELECT channel_type FROM public.inboxes WHERE id = $1 LIMIT 1`, [Number(ids[0])]);
    journey._channelType = rows[0]?.channel_type || '';
  } else {
    journey._channelType = '';
  }
}

// ── ה-tick: השהיות, פולואפים, וסריקת-גיבוי ──
export async function reconcileJourneys(ctx, accountId) {
  const { query, makeClientFor, config, log = console } = ctx;
  const journeys = await activeJourneys(query, accountId);
  if (!journeys.length) return;
  const byId = Object.fromEntries(journeys.map((j) => [j.id, j]));

  // רישום ה-webhook (אידמפוטנטי; הנתיב נושא סוד ספציפי-לחשבון, לא סוד גלובלי)
  if (config.journeyHookBase && config.journeyHookSecret) {
    const url = `${config.journeyHookBase.replace(/\/+$/, '')}/drip-api/journey-hook/${perAccountHookToken(config.journeyHookSecret, accountId)}`;
    await query(`SELECT drip.ensure_journey_webhook($1, $2)`, [accountId, url])
      .catch((e) => log.warn?.(`[journeys] ensure webhook failed: ${e.message}`));
  }

  const due = (await query(
    `SELECT * FROM drip.journey_runs
      WHERE account_id = $1 AND status IN ('waiting_delay', 'waiting_answer')
        AND next_action_at IS NOT NULL AND next_action_at <= now()
      ORDER BY next_action_at ASC LIMIT 50`,
    [accountId]
  )).map(toRun);

  for (const run of due) {
    const journey = byId[run.journey_id];
    if (!journey) continue;
    const client = await makeClientFor(accountId);
    await prepJourney(query, journey);
    const ctx2 = { ...ctx, client };

    if (run.status === 'waiting_delay') {
      await updateRun(query, run.id, { status: 'active', next_action_at: null });
      await executeFrom(ctx2, run, journey, nextNodeId(journey.graph, run.current_node));
      continue;
    }

    // waiting_answer שהבשיל = אין מענה → פולואפ או ויתור
    const node = nodeById(journey.graph, run.current_node);
    const fu = node?.data?.followUp || {};
    const maxRetries = Number(fu.maxRetries ?? 1);
    if ((run.retry_count || 0) < maxRetries && fu.message) {
      const contact = await ctx.reads.getContact(run.display_id, accountId).catch(() => ({}));
      await client.sendText(run.display_id, renderText(fu.message, { contact, answers: run.answers || {} }));
      await updateRun(query, run.id, {
        retry_count: (run.retry_count || 0) + 1,
        next_action_at: new Date(Date.now() + (fu.afterMinutes || 30) * 60000),
      });
      continue;
    }
    // ויתור
    const onGiveUp = fu.onGiveUp || 'continue';
    if (onGiveUp === 'stop') {
      await updateRun(query, run.id, { status: 'stopped', next_action_at: null, last_error: 'no answer' });
    } else if (onGiveUp === 'handoff') {
      try { await client.toggleStatus(run.display_id, 'open'); } catch { /* ערוץ בלי סטטוס */ }
      await updateRun(query, run.id, { status: 'done', next_action_at: null, last_error: 'no answer → handoff' });
    } else {
      await updateRun(query, run.id, { status: 'active', next_action_at: null });
      await executeFrom(ctx2, run, journey, nextNodeId(journey.graph, run.current_node));
    }
  }

  // סריקת-גיבוי: תשובות שה-webhook פספס (למשל היה למטה) — watermark על מזהה ההודעה.
  const waiting = (await query(
    `SELECT * FROM drip.journey_runs WHERE account_id = $1 AND status = 'waiting_answer' LIMIT 200`,
    [accountId]
  )).map(toRun);
  for (const run of waiting) {
    const rows = await query(
      `SELECT m.id, m.content
         FROM public.messages m
         JOIN public.conversations c ON c.id = m.conversation_id
        WHERE c.account_id = $1 AND c.display_id = $2
          AND m.message_type = 0 AND m.private IS NOT TRUE AND m.id > $3
        ORDER BY m.id ASC LIMIT 1`,
      [accountId, run.display_id, Number(run.last_inbound_message_id || 0)]
    );
    if (!rows.length) continue;
    const journey = byId[run.journey_id];
    if (!journey) continue;
    const client = await makeClientFor(accountId);
    await prepJourney(query, journey);
    await feedAnswer({ ...ctx, client }, run, journey, rows[0]);
  }
}

// ── פעולות ה-UI (jrn_*) ──
export async function handleJourneysAction(ctx, action, payload, accountId) {
  const { query, makeClientFor } = ctx;
  switch (action) {
    case 'jrn_list':
      return (await query(`SELECT drip.list_journeys($1) AS j`, [accountId]))[0].j;
    case 'jrn_get': {
      // account-scoped in SQL (defense in depth) — not fetch-then-check in JS.
      const rows = await query(
        `SELECT drip._journey_json($1::uuid, $2) AS j`, [String(payload.id), accountId]
      );
      const j = rows[0]?.j;
      if (!j) throw new Error('הפלואו לא נמצא');
      return j;
    }
    case 'jrn_save':
      return (await query(`SELECT drip.save_journey($1::jsonb) AS j`,
        [JSON.stringify({ ...payload, account_id: accountId })]))[0].j;
    case 'jrn_delete':
      return { deleted: (await query(`SELECT drip.delete_journey($1, $2::uuid) AS ok`,
        [accountId, String(payload.id)]))[0].ok };
    case 'jrn_set_status':
      return (await query(`SELECT drip.set_journey_status($1, $2::uuid, $3) AS j`,
        [accountId, String(payload.id), String(payload.status)]))[0].j;
    case 'jrn_meta': {
      // רשימת תיבות לעורך (agents/teams/labels נטענים בדפדפן עם ה-session — לבוט אין גישה)
      const inboxes = await query(
        `SELECT id, name, channel_type FROM public.inboxes WHERE account_id = $1 ORDER BY id`,
        [accountId]
      );
      return { inboxes };
    }
    case 'jrn_runs':
      return await query(
        `SELECT id, display_id, status, current_node, answers, retry_count,
                waiting_since, next_action_at, last_error, created_at, updated_at
           FROM drip.journey_runs
          WHERE account_id = $1 AND journey_id = $2::uuid
          ORDER BY updated_at DESC LIMIT 100`,
        [accountId, String(payload.id)]
      );
    case 'jrn_launch': {
      const rows = await query(
        `SELECT * FROM drip.journeys WHERE id = $1::uuid AND account_id = $2`,
        [String(payload.id), accountId]
      );
      const journey = rows[0];
      if (!journey) throw new Error('הפלואו לא נמצא');
      const displayId = Number(payload.display_id);
      // 🔒 כשהחשבון מגביל נציגים לשיחות שלהם, נציג לא-אדמין רשאי להזניק פלואו רק על שיחה
      // שמשויכת אליו — אחרת הוא יכול לנחש display_id ולהפעיל בוט על שיחה שהוא כלל לא רואה.
      const actor = payload.__actor || {};
      let contactId = Number(payload.contact_id) || null;
      const c = await query(
        `SELECT c.contact_id, c.assignee_id,
                (a.settings->>'restrict_agents_to_assigned' IN ('true','1')) AS restricted
           FROM public.conversations c JOIN public.accounts a ON a.id = c.account_id
          WHERE c.account_id = $1 AND c.display_id = $2 LIMIT 1`,
        [accountId, displayId]
      );
      const conv = c[0];
      if (conv?.restricted && !actor.isAdmin && actor.uid && Number(conv.assignee_id) !== Number(actor.uid)) {
        throw new Error('אפשר להזניק פלואו רק על שיחה שמשויכת אליך');
      }
      if (!contactId) contactId = conv?.contact_id ? Number(conv.contact_id) : null;
      const client = await makeClientFor(accountId);
      await prepJourney(query, journey);
      const run = await startRun({ ...ctx, client }, journey, { accountId, displayId, contactId });
      if (!run) throw new Error('פלואו אחר כבר פעיל בשיחה הזו');
      return { started: true, run_id: run.id };
    }
    case 'jrn_stop_run': {
      const rows = await query(
        `UPDATE drip.journey_runs SET status = 'stopped', updated_at = now()
          WHERE account_id = $1 AND id = $2::uuid AND status = ANY($3) RETURNING id`,
        [accountId, String(payload.run_id), LIVE]
      );
      return { stopped: rows.length > 0 };
    }
    default:
      throw new Error(`unknown journeys action ${action}`);
  }
}

/**
 * בונה ctx אחיד לכל שערי הכניסה. makeClient/makeDbReads מוזרקים (לא מיובאים) —
 * journeys.js נשאר בלי תלות מודולים, והבדיקות מזריקות מימושים מזויפים בקלות.
 */
export function makeJourneysCtx({ query, makeClient, makeDbReads, config = {} }) {
  const reads = makeDbReads(query);
  const makeClientFor = async (accountId) => {
    const rows = await query(
      `SELECT chatwoot_token, base_url FROM drip.account_tokens WHERE account_id = $1`,
      [accountId]
    );
    const a = rows[0];
    if (!a) throw new Error('החשבון עדיין לא מחובר למנוע — נסו שוב בעוד רגע');
    return makeClient({
      baseUrl: a.base_url || config.chatwootBaseUrl || process.env.CHATWOOT_BASE_URL,
      token: a.chatwoot_token,
      accountId,
      reads,
      query,
    });
  };
  return { query, reads, makeClientFor, config };
}
