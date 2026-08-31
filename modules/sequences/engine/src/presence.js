/**
 * presence.js — "נקרא" (✓✓ כחול) ו"מקליד…" לתיבות WhatsApp Cloud API.
 *
 * Chatwoot 4.16.1 לא מממש אף אחד מהשניים (upstream #13984 → v4.19.0). שתי הפעולות
 * זמינות דרך אותו טוקן שכבר יושב ב-channel_whatsapp.provider_config:
 *
 *   POST /<phone_number_id>/messages
 *     { messaging_product, status:"read", message_id }                      → ✓✓ כחול
 *     { ... , typing_indicator:{ type:"text" } }                            → "מקליד…"
 *
 * "מחובר"/online לא קיים ב-Cloud API בשום צורה — אין endpoint, ומספרי Business
 * Platform לא מציגים "מחובר"/"נראה לאחרונה" לאף אחד. זה קיים רק בערוצי WAHA.
 *
 * ⛔ למה משיכה ולא webhook: `SafeFetch` של Chatwoot חוסם כל URL בלי IP ציבורי, כך
 * שקריאה לשירות פנימי נדחית ("has no public ip addresses"). ההיתר היחיד הוא מתג
 * גלובלי שמפרק את הגנת ה-SSRF לכל הלקוחות. ראה 034_presence.sql.
 */

import { HUMAN_OUTGOING_SQL } from './reads.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

// "מקליד" של Meta פג אחרי 25 שניות. מרעננים ב-20 כדי להשאיר מרווח לרשת.
const TYPING_TTL_MS = 20_000;

// ⭐ 06.08.2026 — למה יש בכלל לולאת רענון: ירייה אחת של "מקליד" מתה 25ש' אחרי
// שנשלחה, בעוד שהתשובה מגיעה מ-n8n אחרי 10-15ש' (תשובה פשוטה) ועד 5 דקות (שאלת
// מחיר שמריצה מחקר). נמדד חי בשיחה 297: על "כמה אקבל עליו?" ה"מקליד" כבה 3:46
// דקות לפני התשובה, ועל תשובות קצרות הוא נדלק 3 שניות לפניה — כלומר בפועל לא נראה.
// לכן: מרעננים עד שיוצאת הודעה חדשה בשיחה. הרענון ב-26-32ש' ולא ב-20 בכוונה —
// הפסק הקצר בין מחזורים נקרא כמו אדם שעוצר לחשוב, במקום "מקליד" רצוף של 5 דקות.
const TYPING_REFRESH_MIN_S = 26;
const TYPING_REFRESH_MAX_S = 32;
// תקרה: מעבר לזה משהו תקוע בצד ששולח, ואדם שמקליד רבע שעה הוא לא אדם.
const TYPING_MAX_WAIT_MS = 6 * 60_000;
// כמה הודעות לעבד בסבב אחד. תקרה שמונעת מסבב ראשון אחרי downtime לפתוח מאות
// טיימרים בבת אחת; היתרה נאספת בסבב הבא.
const BATCH = 200;

// ⛔ שני השדות הראשונים חייבים להישאר כבויים: ב-Cloud API גם payload של "מקליד"
// נושא status:"read", כך ש-typing_mode פעיל מסמן נקרא גם כש-read_receipts כבוי.
// הפעלה — רק במפורש, פר-חשבון/תיבה, מהדשבורד (הוחלט 06.08.2026).
const DEFAULTS = {
  read_receipts: false,
  typing_mode: 'off',
  read_delay_min: 2,
  read_delay_max: 5,
  typing_delay_min: 2,
  typing_delay_max: 4,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (min, max) => (Number(min) + Math.random() * (Number(max) - Number(min))) * 1000;

/**
 * שיחת בוט פעילה לפי מודל Chatwoot, בשני המצבים שנתמכים בפלטפורמה:
 *
 * 1. בוט שמוקצה במפורש לשיחה (`assignee_agent_bot_id`).
 * 2. בוט פעיל שמחובר לכל התיבה (`agent_bot_inboxes.status = active/0`).
 *
 * הקצאה לאדם תמיד גוברת. בלי התנאי הזה בוט-תיבה ממשיך להיחשב מחובר גם אחרי
 * takeover, מפני ש-Chatwoot עדיין מדוור אליו אירועים ברמת התיבה.
 *
 * נשארים עם העמודה הוותיקה `assignee_agent_bot_id` ולא עם `ai_assignee_type`, כדי
 * שהתוסף ימשיך לעבוד גם ב-Chatwoot 4.16; ב-4.17+ אותה עמודה היא המפתח של
 * ה-polymorphic association החדש.
 */
const BOT_CONNECTED_SQL = `(conv.assignee_id IS NULL
  AND (
    conv.assignee_agent_bot_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM public.agent_bot_inboxes abi
       WHERE abi.inbox_id = conv.inbox_id
         AND abi.status = 0
    )
  ))`;

/**
 * בדיקה חוזרת רגע לפני פנייה ל-Meta. ה-tick מסנן מראש, אבל בין קליטת ההודעה
 * לבין השהיית ה-read/typing אדם יכול לקחת את השיחה או לכבות את בוט התיבה.
 */
async function isBotConnected(query, conversationId, inboxId) {
  if (!conversationId || !inboxId) return false;
  const rows = await query(
    `SELECT 1
       FROM public.conversations conv
      WHERE conv.id = $1 AND conv.inbox_id = $2
        AND ${BOT_CONNECTED_SQL}
      LIMIT 1`,
    [conversationId, inboxId]
  );
  return rows.length > 0;
}

/**
 * שולח פעולת presence אחת. `typing` מוסיף את המחוון לאותה קריאה שמסמנת כנקרא —
 * זה מבנה ה-payload של Meta, לא קיצור דרך שלנו.
 */
// ⚠️ לולאת הנוכחות רצה כל 2 שניות. קריאה בלי תקציב זמן שנתקעת מול מטא נשארת תלויה
// לנצח וגוררת איתה את התור — לכן ברירת המחדל היא fetch עם ביטול אוטומטי.
const PRESENCE_TIMEOUT_MS = 10_000;
async function timedFetch(url, opts = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PRESENCE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: opts.signal || ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function send({ phoneId, token, wamid, typing }, fetchImpl = timedFetch) {
  const body = { messaging_product: 'whatsapp', status: 'read', message_id: wamid };
  if (typing) body.typing_indicator = { type: 'text' };
  const res = await fetchImpl(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // צפוי ושפיר: הודעה בת יותר מ-30 יום, wamid שנמחק, תיבה שנותקה מ-Meta.
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${detail.slice(0, 200)}`);
  }
  return true;
}

/**
 * ההגדרות בתוקף לתיבה: שורת התיבה גוברת על ברירת המחדל של החשבון (inbox_id = 0),
 * וזו גוברת על DEFAULTS. תיבה שמעולם לא נגעו בה נכשלת סגור — בלי "נקרא" ובלי
 * "מקליד" עד להפעלה מפורשת.
 */
export async function settingsFor(query, accountId, inboxId) {
  const rows = await query(
    `SELECT * FROM drip.presence_settings
      WHERE account_id = $1 AND inbox_id IN (0, $2)
      ORDER BY inbox_id DESC LIMIT 1`,
    [accountId, inboxId]
  );
  return { ...DEFAULTS, ...(rows[0] || {}) };
}

/**
 * האם כבר יצאה הודעה חדשה יותר בשיחה — תשובת הבוט, נציג, או הודעה נוספת מהלקוח
 * (שתקבל לולאת "מקליד" משל עצמה). זה סימן העצירה של הרענון.
 */
async function hasNewerMessage(query, conversationId, messageId) {
  if (!conversationId) return true; // בלי מזהה שיחה אין איך לדעת מתי לעצור — לא מרעננים
  const rows = await query(
    `SELECT 1 FROM public.messages
      WHERE conversation_id = $1 AND id > $2 AND private = false
      LIMIT 1`,
    [conversationId, messageId]
  );
  return rows.length > 0;
}

/**
 * מטפל בהודעה נכנסת אחת: המתנה → נקרא → (במצב auto) המתנה → מקליד → רענון עד התשובה.
 * רץ מנותק מהלולאה — סבב המשיכה לא ממתין לאף טיימר.
 */
async function handleIncoming(deps, msg) {
  const { query, log } = deps;
  let s = await settingsFor(query, msg.account_id, msg.inbox_id);
  if (!s.read_receipts && s.typing_mode !== 'auto') return;

  const target = { phoneId: msg.phone_id, token: msg.token, wamid: msg.source_id };
  await sleep(jitter(s.read_delay_min, s.read_delay_max));

  // ההגדרה והבעלות עשויות להשתנות בזמן ההשהיה. כיבוי מהדשבורד או takeover
  // חייבים לעצור גם handler שכבר תוזמן, לא רק הודעות שייכנסו מה-tick הבא.
  s = await settingsFor(query, msg.account_id, msg.inbox_id);
  if (!s.read_receipts && s.typing_mode !== 'auto') return;
  if (!await isBotConnected(query, msg.conversation_id, msg.inbox_id)) {
    log(`[presence] skipped inbox=${msg.inbox_id}: bot not connected`);
    return;
  }

  if (s.read_receipts) {
    try {
      await send({ ...target, typing: false }, deps.fetchImpl);
      log(`[presence] read inbox=${msg.inbox_id}`);
    } catch (e) {
      log(`[presence] read failed inbox=${msg.inbox_id}: ${e.message}`);
      return; // טוקן/wamid פסולים — אין טעם לנסות גם "מקליד"
    }
  }

  if (s.typing_mode !== 'auto') return;
  await sleep(jitter(s.typing_delay_min, s.typing_delay_max));

  s = await settingsFor(query, msg.account_id, msg.inbox_id);
  if (s.typing_mode !== 'auto') return;
  if (!await isBotConnected(query, msg.conversation_id, msg.inbox_id)) {
    log(`[presence] typing skipped inbox=${msg.inbox_id}: bot not connected`);
    return;
  }
  try {
    await send({ ...target, typing: true }, deps.fetchImpl);
    log(`[presence] typing inbox=${msg.inbox_id} (auto)`);
  } catch (e) {
    log(`[presence] typing failed inbox=${msg.inbox_id}: ${e.message}`);
    return;
  }

  // מחזיקים את "מקליד" חי עד שהתשובה באמת יוצאת (ראה TYPING_REFRESH_MIN_S)
  const deadline = Date.now() + TYPING_MAX_WAIT_MS;
  let cycles = 0;
  while (Date.now() < deadline) {
    await sleep(jitter(TYPING_REFRESH_MIN_S, TYPING_REFRESH_MAX_S));
    if (await hasNewerMessage(query, msg.conversation_id, msg.id)) return;
    const current = await settingsFor(query, msg.account_id, msg.inbox_id);
    if (current.typing_mode !== 'auto') return;
    if (!await isBotConnected(query, msg.conversation_id, msg.inbox_id)) return;
    try {
      await send({ ...target, typing: true }, deps.fetchImpl);
      cycles += 1;
    } catch (e) {
      log(`[presence] typing refresh failed inbox=${msg.inbox_id}: ${e.message}`);
      return;
    }
  }
  log(`[presence] typing timeout inbox=${msg.inbox_id} after ${cycles} refreshes`);
}

/**
 * נציג מקליד ב-Chatwoot → הלקוח רואה "מקליד…" בוואטסאפ.
 * נקרא מ-api.js (הדשבורד מדווח), ולכן חייב להיות זול וממודד: האירוע נורה על כל
 * תו, ואילו ל-Meta פונים רק כשה-25 שניות עומדות לפוג.
 */
const lastTyping = new Map();
export async function relayAgentTyping(deps, accountId, conversationId) {
  const now = Date.now();
  const prev = lastTyping.get(conversationId) || 0;
  if (now - prev < TYPING_TTL_MS) return { throttled: true };
  lastTyping.set(conversationId, now);
  if (lastTyping.size > 5000) lastTyping.clear(); // ponytail: ניקוי גס, המפה זולה לבנייה מחדש

  const rows = await deps.query(
    `SELECT m.inbox_id, m.source_id,
            cw.provider_config->>'phone_number_id' AS phone_id,
            cw.provider_config->>'api_key'         AS token
       FROM public.messages m
       JOIN public.inboxes i          ON i.id = m.inbox_id
       JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
      WHERE m.conversation_id = $1 AND m.account_id = $2
        AND m.message_type = 0 AND m.source_id LIKE 'wamid.%'
        AND i.channel_type = 'Channel::Whatsapp' AND cw.provider = 'whatsapp_cloud'
      ORDER BY m.id DESC LIMIT 1`,
    [conversationId, accountId]
  );
  if (!rows.length) return { sent: false, reason: 'no_incoming_whatsapp_message' };

  const s = await settingsFor(deps.query, accountId, rows[0].inbox_id);
  if (s.typing_mode === 'off') return { sent: false, reason: 'disabled' };
  // גם payload של "נציג מקליד" מכיל status=read. לכן כל מצב פעיל — auto או agent —
  // חייב לעבור את אותו שער בוט; opt-in לתיבה אינו הרשאה לסמן שיחה רגילה כנקראה.
  if (!await isBotConnected(deps.query, conversationId, rows[0].inbox_id)) {
    return { sent: false, reason: 'bot_not_connected' };
  }

  await send(
    { phoneId: rows[0].phone_id, token: rows[0].token, wamid: rows[0].source_id, typing: true },
    deps.fetchImpl
  );
  return { sent: true };
}

/**
 * סבב אחד: כל ההודעות הנכנסות החדשות בתיבות whatsapp_cloud מאז הסמן.
 *
 * הסמן מתקדם גם כשההודעות מסוננות החוצה, אחרת תיבה שקטה עם ערוץ אחר תשאיר את
 * הלולאה תקועה על אותו טווח לנצח.
 *
 * ⭐ 31.08.2026 — שני שערים נפרדים, ושניהם חובה:
 * (א) BOT_CONNECTED_SQL מוכיח שבוט מחובר *עכשיו* לשיחה או לתיבה ושאדם לא לקח
 *     בעלות. זה סוגר את החור שבו שיחה חדשה ולא-מוקצית סומנה לפני שאדם ענה.
 * (ב) NOT EXISTS על HUMAN_OUTGOING_SQL משמר את הגנת ה-takeover מהטלפון. ב-coexistence
 *     תשובת אדם יכולה להגיע כ-external_echo בלי לשנות מיד את ההקצאה ב-Chatwoot.
 */
export async function tickPresence(deps) {
  const { query } = deps;
  const cur = await query('SELECT last_message_id FROM drip.presence_cursor WHERE id LIMIT 1');
  if (!cur.length) return { processed: 0 };
  const from = Number(cur[0].last_message_id);

  const rows = await query(
    `SELECT msg.id, msg.account_id, msg.inbox_id, msg.source_id, msg.conversation_id,
            cw.provider_config->>'phone_number_id' AS phone_id,
            cw.provider_config->>'api_key'         AS token
       FROM public.messages msg
       JOIN public.inboxes i           ON i.id = msg.inbox_id
       JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
       JOIN public.conversations conv  ON conv.id = msg.conversation_id
      WHERE msg.id > $1
        AND msg.message_type = 0
        AND msg.private = false
        AND msg.source_id LIKE 'wamid.%'
        AND i.channel_type = 'Channel::Whatsapp'
        AND cw.provider = 'whatsapp_cloud'
        AND COALESCE(cw.provider_config->>'api_key', '') <> ''
        AND ${BOT_CONNECTED_SQL}
        AND NOT EXISTS (
              SELECT 1 FROM public.messages m
               WHERE m.conversation_id = msg.conversation_id
                 AND m.id < msg.id
                 AND ${HUMAN_OUTGOING_SQL}
            )
      ORDER BY msg.id
      LIMIT $2`,
    [from, BATCH]
  );

  // הסמן זז לפי ה-id הגבוה ביותר שקיים בטבלה עד לתקרת האצווה — לא לפי ההודעה
  // האחרונה שהתאימה לסינון.
  const ceiling = await query(
    'SELECT COALESCE(MAX(id), $1) AS id FROM (SELECT id FROM public.messages WHERE id > $1 ORDER BY id LIMIT $2) s',
    [from, BATCH]
  );
  const next = Number(ceiling[0].id);
  if (next > from) {
    await query('UPDATE drip.presence_cursor SET last_message_id = $1, updated_at = now() WHERE id', [next]);
  }

  for (const msg of rows) {
    handleIncoming(deps, msg).catch((e) => deps.log(`[presence] handler error: ${e.message}`));
  }
  return { processed: rows.length, cursor: next };
}

// ── פעולות הדשבורד (prs_*) ────────────────────────────────────────────────

/**
 * prs_get   → { defaults, inboxes:[{id, name, phone_number, settings, inherited}] }
 * prs_save  → שמירת שורה אחת. inbox_id = 0 היא ברירת המחדל של החשבון.
 * prs_reset → מחיקת שורת התיבה, כלומר חזרה לירושה מברירת המחדל.
 * prs_typing→ ממסר הקלדת נציג (נקרא מהדשבורד, לכן פתוח לכל חבר בחשבון).
 */
export async function handlePresenceAction(deps, action, payload = {}, accountId) {
  const { query } = deps;

  if (action === 'prs_typing') {
    const cid = Number(payload.conversation_id);
    if (!cid) throw new Error('conversation_id required');
    return relayAgentTyping(deps, accountId, cid);
  }

  if (action === 'prs_get') {
    const inboxes = await query(
      `SELECT i.id, i.name, cw.phone_number
         FROM public.inboxes i
         JOIN public.channel_whatsapp cw ON cw.id = i.channel_id
        WHERE i.account_id = $1 AND i.channel_type = 'Channel::Whatsapp'
          AND cw.provider = 'whatsapp_cloud'
        ORDER BY i.name`,
      [accountId]
    );
    const rows = await query(
      'SELECT * FROM drip.presence_settings WHERE account_id = $1',
      [accountId]
    );
    const byInbox = new Map(rows.map((r) => [Number(r.inbox_id), r]));
    const defaults = { ...DEFAULTS, ...(byInbox.get(0) || {}) };
    return {
      defaults,
      inboxes: inboxes.map((i) => ({
        ...i,
        inherited: !byInbox.has(Number(i.id)),
        settings: { ...defaults, ...(byInbox.get(Number(i.id)) || {}) },
      })),
    };
  }

  if (action === 'prs_save') {
    const inboxId = Number(payload.inbox_id) || 0;
    const s = { ...DEFAULTS, ...payload };
    if (!['off', 'agent', 'auto'].includes(s.typing_mode)) throw new Error('invalid typing_mode');
    // התיבה חייבת להיות של החשבון — אחרת אדמין בחשבון אחד יכול לכתוב הגדרות לאחר.
    if (inboxId) {
      const owned = await query(
        'SELECT 1 FROM public.inboxes WHERE id = $1 AND account_id = $2',
        [inboxId, accountId]
      );
      if (!owned.length) throw new Error('inbox not in account');
    }
    await query(
      `INSERT INTO drip.presence_settings
         (account_id, inbox_id, read_receipts, typing_mode,
          read_delay_min, read_delay_max, typing_delay_min, typing_delay_max, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (account_id, inbox_id) DO UPDATE SET
         read_receipts = EXCLUDED.read_receipts, typing_mode = EXCLUDED.typing_mode,
         read_delay_min = EXCLUDED.read_delay_min, read_delay_max = EXCLUDED.read_delay_max,
         typing_delay_min = EXCLUDED.typing_delay_min, typing_delay_max = EXCLUDED.typing_delay_max,
         updated_at = now()`,
      [accountId, inboxId, !!s.read_receipts, s.typing_mode,
       s.read_delay_min, s.read_delay_max, s.typing_delay_min, s.typing_delay_max]
    );
    return { saved: true };
  }

  if (action === 'prs_reset') {
    const inboxId = Number(payload.inbox_id);
    if (!inboxId) throw new Error('inbox_id required');
    await query('DELETE FROM drip.presence_settings WHERE account_id = $1 AND inbox_id = $2',
      [accountId, inboxId]);
    return { reset: true };
  }

  throw new Error(`unknown presence action: ${action}`);
}

export const _internals = {
  send, jitter, DEFAULTS, TYPING_TTL_MS, lastTyping,
  BOT_CONNECTED_SQL, isBotConnected,
  hasNewerMessage, TYPING_REFRESH_MIN_S, TYPING_REFRESH_MAX_S, TYPING_MAX_WAIT_MS,
};
