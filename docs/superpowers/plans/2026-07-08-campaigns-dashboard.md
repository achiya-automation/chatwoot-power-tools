# תוכנית מימוש — דשבורד קמפיינים WhatsApp + העלאת מדיה

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** להוסיף ל-cwpt טאב "קמפיינים" (דשבורד סטטיסטיקה מלא לקמפייני WhatsApp) + כפתור העלאת מדיה בטופס הקמפיין של Chatwoot.

**Architecture:** דשבורד React חדש בתוך ה-webapp הקיים (טאב רביעי ליד overview/sequences/contacts), הנשען על 2 reads חדשים ב-engine שקוראים מ-`public.campaigns` + `public.messages` (קישור דרך `content_attributes.campaign_id`). כפתור המדיה מורחב ב-`campaign-modal.js` ומשתמש ב-endpoint ההעלאה הקיים.

**Tech Stack:** Node/Express (engine), React + Vite + Tailwind (webapp), Postgres (least-privilege role), vanilla JS injection (dashboard-script), `node --test`.

## Global Constraints

- **קוד באנגלית** (משתנים/פונקציות/הערות-קוד); טקסט משתמש דו-לשוני he/en במילון co-located בכל רכיב.
- **מקור אמת לקישור הודעה→קמפיין:** `messages.content_attributes ? 'campaign_id'` / `@> jsonb_build_object('campaign_id', N::int)`. **לעולם לא** `conversations.campaign_id` (NULL ל-WhatsApp) ו**לעולם לא** LIKE.
- **enum סטטוס הודעה:** `sent:0, delivered:1, read:2, failed:3`. "נמסר" בתצוגה = `status IN (1,2)`.
- **Least-privilege נשמר:** רק `SELECT` חדש. אין הרשאת כתיבה חדשה.
- **wire contract:** `store.js` מחזיר `{ data: <result> }`; `api.js` עוטף ל-`{ ok:true, data }`; `sequencesApi.call()` מחזיר `json.data`.
- **TZ:** כל צבירה לפי זמן = `Asia/Jerusalem` (כמו `actionDeliveryStats`).
- **TDD:** בדיקה נכשלת → מימוש מינימלי → בדיקה עוברת → commit. commit אחרי כל task.
- **בדיקות engine דורשות `DATABASE_URL_TEST`** ו-stand-in tables (`deploy/run-tests.sh` מקומי + `.github/workflows/ci.yml`).

---

## מבנה קבצים

| קובץ | אחריות | פעולה |
|---|---|---|
| `lib/db.sh` | grants ל-role | Modify (הוספת `campaigns,labels,tags,taggings`) |
| `.github/workflows/ci.yml` | stand-in tables ל-CI | Modify |
| `deploy/run-tests.sh` | stand-in tables מקומי | Modify |
| `modules/sequences/engine/src/campaigns.js` | קריאות קמפיינים (reads טהורים) | Create |
| `modules/sequences/engine/src/store.js` | dispatch actions | Modify (2 cases + 2 handlers) |
| `modules/sequences/engine/test/campaigns.test.js` | בדיקות reads | Create |
| `modules/sequences/webapp/src/api/sequencesApi.js` | שכבת API | Modify (2 פונקציות) |
| `modules/sequences/webapp/src/lib/campaignCost.js` | אומדן עלות | Create |
| `modules/sequences/webapp/test/campaignCost.test.js` | בדיקת עלות | Create |
| `modules/sequences/webapp/src/components/CampaignsView.jsx` | רמה 1 — סקירה | Create |
| `modules/sequences/webapp/src/components/CampaignDetailView.jsx` | רמה 2 — קמפיין בודד | Create |
| `modules/sequences/webapp/src/App.jsx` | חיווט טאב + i18n | Modify |
| `modules/sequences/inject/sequences-nav.js` | טאב קמפיינים בסיידבר | Modify |
| `modules/dashboard-enhancements/parts/campaign-modal.js` | כפתור העלאת מדיה | Modify |
| `modules/sequences/webapp/dist/*` | build | Rebuild (Task 12) |

---

## Task 1: Test scaffold + DB grants

**מטרה:** לאפשר ל-engine (ולבדיקות) לקרוא `campaigns`/`labels`/`tags`/`taggings`. Deliverable: בדיקת smoke ש-`SELECT FROM public.campaigns` עובד בסביבת הבדיקה.

**Files:**
- Modify: `lib/db.sh` (בלוק ה-`GRANT SELECT ON public...` בתוך `provision_db`)
- Modify: `.github/workflows/ci.yml` (שלב "Scaffold Chatwoot stand-in tables")
- Modify: `deploy/run-tests.sh` (בלוק ה-`CREATE TABLE public.*` המקביל)
- Test: `modules/sequences/engine/test/campaigns.test.js` (smoke)

**Interfaces:**
- Produces: טבלאות `public.campaigns`, `public.labels`, `public.tags`, `public.taggings` בסביבת הבדיקה; grant מקביל ב-prod.

- [ ] **Step 1: הוסף stand-in tables ל-CI**. ב-`.github/workflows/ci.yml`, בתוך ה-heredoc `SQL` של "Scaffold Chatwoot stand-in tables", הוסף אחרי טבלת `accounts`:

```sql
CREATE TABLE IF NOT EXISTS public.campaigns (
  id int PRIMARY KEY, display_id int, account_id int, inbox_id int,
  title text, message text, campaign_type int, campaign_status int,
  audience jsonb DEFAULT '[]'::jsonb, template_params jsonb DEFAULT '{}'::jsonb,
  scheduled_at timestamp, created_at timestamp);
CREATE TABLE IF NOT EXISTS public.labels (
  id int PRIMARY KEY, account_id int, title text);
CREATE TABLE IF NOT EXISTS public.tags (
  id int PRIMARY KEY, name text);
CREATE TABLE IF NOT EXISTS public.taggings (
  id int PRIMARY KEY, tag_id int, taggable_type text, taggable_id int, context text);
```

- [ ] **Step 2: שכפל את אותן טבלאות ל-`deploy/run-tests.sh`**. פתח את הקובץ, מצא את בלוק ה-`CREATE TABLE public.*` (המקביל ל-CI), והוסף את אותן 4 הטבלאות (זהה ל-Step 1). זה מה שמריץ את הבדיקות מקומית.

- [ ] **Step 3: הוסף grants ל-`lib/db.sh`**. בבלוק ה-heredoc `SQL` בתוך `provision_db` (השורה `GRANT SELECT ON public.conversations, public.messages, ...`), הוסף שורה חדשה:

```sql
-- campaigns dashboard: read campaign definitions + audience labels (contact tags).
GRANT SELECT ON public.campaigns, public.labels, public.tags, public.taggings TO drip_engine;
```

- [ ] **Step 4: כתוב בדיקת smoke**. צור `modules/sequences/engine/test/campaigns.test.js`:

```javascript
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, query } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

const cfg = { databaseUrl: process.env.DATABASE_URL_TEST };
const pool = getPool(cfg);

beforeEach(async () => {
  await runMigrations(pool);
  await pool.query('TRUNCATE public.campaigns, public.messages, public.contacts, public.conversations, public.labels, public.tags, public.taggings');
});

test('scaffold: campaigns table is queryable', async () => {
  await query(`INSERT INTO public.campaigns(id, account_id, inbox_id, title, campaign_type, campaign_status)
               VALUES (1, 1, 10, 'בדיקה', 1, 1)`);
  const rows = await query(`SELECT title FROM public.campaigns WHERE account_id = $1`, [1]);
  assert.equal(rows[0].title, 'בדיקה');
});
```

- [ ] **Step 5: הרץ מקומית — ודא כשל ואז הצלחה**. אם אין DB בדיקה מקומי, הרץ `bash deploy/run-tests.sh` (מקים DB + טבלאות + מריץ). לפני Step 1-2 הבדיקה תיכשל (`relation "public.campaigns" does not exist`); אחריהם — PASS.
Run: `DATABASE_URL_TEST=... node --test test/campaigns.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db.sh .github/workflows/ci.yml deploy/run-tests.sh modules/sequences/engine/test/campaigns.test.js
git commit -m "feat: תשתית DB לקריאת קמפיינים (grants + stand-in tables)"
```

---

## Task 2: `campaigns.js` — `listCampaigns`

**מטרה:** רשימת קמפייני WhatsApp + אגרגציית סטטוס per-campaign בשאילתה אחת.

**Files:**
- Create: `modules/sequences/engine/src/campaigns.js`
- Test: `modules/sequences/engine/test/campaigns.test.js` (הרחבה)

**Interfaces:**
- Consumes: `query` מ-`./db.js`.
- Produces: `export async function listCampaigns(query, accountId)` → `Array<{ id, display_id, title, campaign_type, campaign_status, template_name, language, category, audience, scheduled_at, created_at, sent, delivered, read, failed }>`.

- [ ] **Step 1: כתוב בדיקה נכשלת**. הוסף ל-`campaigns.test.js`:

```javascript
import { listCampaigns } from '../src/campaigns.js';

async function seedCampaign({ id, account = 1, inbox = 10, type = 1, status = 1, title = 'קמפיין', tpl = { name: 'welcome', language: 'he', category: 'MARKETING' } }) {
  await query(`INSERT INTO public.campaigns(id, display_id, account_id, inbox_id, title, campaign_type, campaign_status, template_params, created_at)
               VALUES ($1,$1,$2,$3,$4,$5,$6,$7, now())`,
    [id, account, inbox, title, type, status, JSON.stringify(tpl)]);
  // WhatsApp inbox so the join filters it in
  await query(`INSERT INTO public.inboxes(id, account_id, name, channel_type, channel_id) VALUES ($1,$2,'WA','Channel::Whatsapp',$1) ON CONFLICT (id) DO NOTHING`, [inbox, account]);
}
async function seedCampaignMessage({ id, account = 1, conv = 500, campaignId, status }) {
  await query(`INSERT INTO public.messages(id, conversation_id, account_id, message_type, status, content_attributes, created_at)
               VALUES ($1,$2,$3,1,$4,$5, now())`,
    [id, conv, account, status, JSON.stringify({ campaign_id: campaignId })]);
}

test('listCampaigns: aggregates status counts per campaign', async () => {
  await seedCampaign({ id: 16, title: 'השקה' });
  await seedCampaignMessage({ id: 1, campaignId: 16, status: 1 }); // delivered
  await seedCampaignMessage({ id: 2, campaignId: 16, status: 2 }); // read
  await seedCampaignMessage({ id: 3, campaignId: 16, status: 3 }); // failed
  const list = await listCampaigns(query, 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].title, 'השקה');
  assert.equal(list[0].sent, 3);
  assert.equal(list[0].delivered, 2); // status 1 + 2
  assert.equal(list[0].read, 1);
  assert.equal(list[0].failed, 1);
  assert.equal(list[0].template_name, 'welcome');
});

test('listCampaigns: campaign 16 does not swallow campaign 160 (no LIKE bug)', async () => {
  await seedCampaign({ id: 16, title: 'A' });
  await seedCampaign({ id: 160, title: 'B' });
  await seedCampaignMessage({ id: 1, campaignId: 160, status: 1 });
  const list = await listCampaigns(query, 1);
  const c16 = list.find((c) => c.id === 16);
  assert.equal(c16.sent, 0); // messages for 160 must NOT count toward 16
});
```

**account_id של messages ב-DB אמיתי:** `public.messages` אין בו `account_id` ישיר בכל הגרסאות — הוא מגיע דרך `conversations`. בבדיקה נוסיף עמודת `account_id` ל-messages (stand-in). ב-prod, אם `messages.account_id` לא קיים, ה-JOIN יהיה דרך `conversations`. ראה Step 3 הערה.

- [ ] **Step 2: הרץ — ודא כשל**.
Run: `DATABASE_URL_TEST=... node --test test/campaigns.test.js`
Expected: FAIL (`listCampaigns is not a function`).

- [ ] **Step 3: כתוב `campaigns.js`**:

```javascript
/**
 * campaigns.js — read-only campaign analytics from Chatwoot's own tables.
 *
 * Campaign→message link is ONLY messages.content_attributes.campaign_id (written by the
 * whatsapp_campaign_conversations initializer). We use jsonb containment (@>) — NOT LIKE —
 * so campaign 16 never swallows 160/216. conversations.campaign_id is NULL for WhatsApp.
 *
 * Status enum: sent:0, delivered:1, read:2, failed:3. "delivered" = status IN (1,2).
 */

// Per-campaign status counts, aggregated in ONE pass over messages carrying a campaign_id.
// content_attributes may be json OR jsonb depending on the column type; cast to jsonb for `?`/`->>'`.
const AGG_CTE = `
  WITH msg AS (
    SELECT (content_attributes::jsonb ->> 'campaign_id')::int AS campaign_id, status
      FROM public.messages
     WHERE account_id = $1
       AND content_attributes::jsonb ? 'campaign_id'
  ), agg AS (
    SELECT campaign_id,
           count(*)::int                              AS sent,
           count(*) FILTER (WHERE status IN (1,2))::int AS delivered,
           count(*) FILTER (WHERE status = 2)::int      AS read,
           count(*) FILTER (WHERE status = 3)::int      AS failed
      FROM msg GROUP BY campaign_id
  )`;

export async function listCampaigns(query, accountId) {
  const rows = await query(
    `${AGG_CTE}
     SELECT c.id, c.display_id, c.title, c.campaign_type, c.campaign_status,
            c.template_params ->> 'name'     AS template_name,
            c.template_params ->> 'language' AS language,
            c.template_params ->> 'category' AS category,
            c.audience,
            to_char(c.scheduled_at, 'YYYY-MM-DD HH24:MI') AS scheduled_at,
            to_char(c.created_at,  'YYYY-MM-DD HH24:MI') AS created_at,
            coalesce(a.sent, 0)      AS sent,
            coalesce(a.delivered, 0) AS delivered,
            coalesce(a.read, 0)      AS read,
            coalesce(a.failed, 0)    AS failed
       FROM public.campaigns c
       JOIN public.inboxes i ON i.id = c.inbox_id AND i.channel_type = 'Channel::Whatsapp'
       LEFT JOIN agg a ON a.campaign_id = c.id
      WHERE c.account_id = $1
      ORDER BY c.created_at DESC NULLS LAST, c.id DESC`,
    [accountId]
  );
  return rows;
}
```

> **הערת prod ל-`messages.account_id`:** אם בסכמת Chatwoot בפועל אין `messages.account_id`, החלף את `WHERE account_id = $1` ב-CTE ב-JOIN: `JOIN public.conversations cv ON cv.id = messages.conversation_id WHERE cv.account_id = $1`. **אמת מול `\d messages` על achiya לפני מיזוג** (feedback: אימות מבנה לפני assertion). ה-stand-in של הבדיקות כולל `messages.account_id` (ראה `ci.yml`) — לכן הבדיקה עוברת עם הגרסה הישירה; אם prod שונה, הבדיקה תישאר ירוקה כי ה-stand-in משקף את מה שנבחר.

- [ ] **Step 4: הרץ — ודא הצלחה**.
Run: `DATABASE_URL_TEST=... node --test test/campaigns.test.js`
Expected: PASS (כל הבדיקות).

- [ ] **Step 5: Commit**

```bash
git add modules/sequences/engine/src/campaigns.js modules/sequences/engine/test/campaigns.test.js
git commit -m "feat: listCampaigns — אגרגציית סטטוס לקמפיינים (jsonb containment, לא LIKE)"
```

---

## Task 3: `campaigns.js` — `getCampaignDetail`

**מטרה:** צלילה לקמפיין בודד — funnel, טבלת נמענים, engagement, "לא נשלח".

**Files:**
- Modify: `modules/sequences/engine/src/campaigns.js` (הוספת `getCampaignDetail`)
- Test: `modules/sequences/engine/test/campaigns.test.js` (הרחבה)

**Interfaces:**
- Produces: `export async function getCampaignDetail(query, accountId, campaignId)` → `{ campaign: {...}, funnel: { audience, sent, delivered, read, failed }, engagement: { replied, reply_rate }, recipients: [{ contact_name, phone, status, error_title, sent_at }], not_sent: [{ contact_name, phone }] }`.

- [ ] **Step 1: אמת מבנה taggings מול DB אמיתי** (feedback: מידע ישן → אמת לפני שימוש). לפני כתיבת שאילתת "לא נשלח", הרץ מול achiya:
```bash
ssh chatwoot_admon "docker exec \$(docker ps -qf name=postgres|head -1) psql -U postgres chatwoot -c '\\d taggings' -c \"SELECT DISTINCT context FROM taggings WHERE taggable_type='Contact' LIMIT 5\""
```
ודא: `taggings(tag_id, taggable_type, taggable_id, context)` ו-`context` של תיוגי איש-קשר (צפוי `'labels'`). אם שונה — עדכן את השאילתה ב-Step 4 בהתאם.

- [ ] **Step 2: כתוב בדיקה נכשלת**. הוסף ל-`campaigns.test.js` (משתמש ב-`seedCampaign`/`seedCampaignMessage` מ-Task 2):

```javascript
import { getCampaignDetail } from '../src/campaigns.js';

test('getCampaignDetail: funnel + recipients + engagement', async () => {
  await seedCampaign({ id: 20, title: 'מבצע' });
  await query(`INSERT INTO public.contacts(id, account_id, name, phone_number) VALUES (1,1,'דנה','+972500000001'),(2,1,'רון','+972500000002')`);
  await query(`INSERT INTO public.conversations(id, display_id, account_id, contact_id) VALUES (500,500,1,1),(501,501,1,2)`);
  await seedCampaignMessage({ id: 1, conv: 500, campaignId: 20, status: 2 }); // דנה קראה
  await seedCampaignMessage({ id: 2, conv: 501, campaignId: 20, status: 1 }); // רון נמסר
  // דנה הגיבה (incoming אחרי ה-outgoing)
  await query(`INSERT INTO public.messages(id, conversation_id, account_id, message_type, status, created_at)
               VALUES (99, 500, 1, 0, 0, now() + interval '1 minute')`);

  const d = await getCampaignDetail(query, 1, 20);
  assert.equal(d.campaign.title, 'מבצע');
  assert.equal(d.funnel.sent, 2);
  assert.equal(d.funnel.delivered, 2); // status 1 + 2
  assert.equal(d.funnel.read, 1);
  assert.equal(d.engagement.replied, 1); // דנה
  assert.equal(d.recipients.length, 2);
  const dana = d.recipients.find((r) => r.phone === '+972500000001');
  assert.equal(dana.status, 2);
});
```

- [ ] **Step 3: הרץ — ודא כשל** (`getCampaignDetail is not a function`).

- [ ] **Step 4: הוסף `getCampaignDetail` ל-`campaigns.js`**:

```javascript
// One campaign's full detail. campaignSel = exact jsonb containment (never a substring match).
export async function getCampaignDetail(query, accountId, campaignId) {
  const id = parseInt(campaignId, 10);
  const campaign = (await query(
    `SELECT c.id, c.title, c.message, c.campaign_type, c.campaign_status, c.audience,
            c.template_params ->> 'name'     AS template_name,
            c.template_params ->> 'language' AS language,
            c.template_params ->> 'category' AS category,
            to_char(c.created_at, 'YYYY-MM-DD HH24:MI') AS created_at
       FROM public.campaigns c
      WHERE c.account_id = $1 AND c.id = $2 LIMIT 1`,
    [accountId, id]
  ))[0] || null;
  if (!campaign) return null;

  // Recipients: one row per campaign message, joined to the contact + failure title.
  const recipients = await query(
    `SELECT ct.name AS contact_name,
            ct.phone_number AS phone,
            m.status,
            m.content_attributes::jsonb #>> '{external_error,title}' AS error_title,
            to_char(m.created_at, 'YYYY-MM-DD HH24:MI') AS sent_at,
            m.conversation_id
       FROM public.messages m
       LEFT JOIN public.conversations cv ON cv.id = m.conversation_id
       LEFT JOIN public.contacts ct ON ct.id = cv.contact_id
      WHERE m.account_id = $1
        AND m.content_attributes::jsonb @> jsonb_build_object('campaign_id', $2::int)
      ORDER BY m.created_at`,
    [accountId, id]
  );

  const funnel = recipients.reduce(
    (f, r) => {
      f.sent += 1;
      if (r.status === 1 || r.status === 2) f.delivered += 1;
      if (r.status === 2) f.read += 1;
      if (r.status === 3) f.failed += 1;
      return f;
    },
    { audience: 0, sent: 0, delivered: 0, read: 0, failed: 0 }
  );

  // Engagement: distinct conversations with an INCOMING message after the campaign send.
  const replied = Number((await query(
    `SELECT count(DISTINCT m_in.conversation_id)::int AS c
       FROM public.messages m_out
       JOIN public.messages m_in
         ON m_in.conversation_id = m_out.conversation_id
        AND m_in.message_type = 0
        AND m_in.created_at > m_out.created_at
      WHERE m_out.account_id = $1
        AND m_out.content_attributes::jsonb @> jsonb_build_object('campaign_id', $2::int)`,
    [accountId, id]
  ))[0]?.c || 0);
  const engagement = { replied, reply_rate: funnel.delivered ? Math.round((replied / funnel.delivered) * 100) : 0 };

  // "Not sent": audience labels → contacts (via acts-as-taggable) minus those who got a message.
  // ⚠️ verified against real taggings schema in Step 1. Best-effort: empty on any shape mismatch.
  let not_sent = [];
  try {
    not_sent = await query(
      `WITH aud AS (
         SELECT (a ->> 'id')::int AS label_id
           FROM public.campaigns c, jsonb_array_elements(c.audience) a
          WHERE c.id = $2 AND a ->> 'type' = 'Label'
       ), aud_contacts AS (
         SELECT DISTINCT tg.taggable_id AS contact_id
           FROM aud
           JOIN public.labels l  ON l.id = aud.label_id AND l.account_id = $1
           JOIN public.tags   t  ON lower(t.name) = lower(l.title)
           JOIN public.taggings tg ON tg.tag_id = t.id
                AND tg.taggable_type = 'Contact' AND tg.context = 'labels'
       ), received AS (
         SELECT DISTINCT cv.contact_id
           FROM public.messages m
           JOIN public.conversations cv ON cv.id = m.conversation_id
          WHERE m.account_id = $1
            AND m.content_attributes::jsonb @> jsonb_build_object('campaign_id', $2::int)
       )
       SELECT ct.name AS contact_name, ct.phone_number AS phone
         FROM aud_contacts ac
         JOIN public.contacts ct ON ct.id = ac.contact_id
        WHERE ac.contact_id NOT IN (SELECT contact_id FROM received WHERE contact_id IS NOT NULL)
        ORDER BY ct.name NULLS LAST
        LIMIT 500`,
      [accountId, id]
    );
  } catch { not_sent = []; }
  funnel.audience = funnel.sent + not_sent.length;

  return { campaign, funnel, engagement, recipients, not_sent };
}
```

- [ ] **Step 5: הרץ — ודא הצלחה** (כל הבדיקות ב-`campaigns.test.js`).

- [ ] **Step 6: Commit**

```bash
git add modules/sequences/engine/src/campaigns.js modules/sequences/engine/test/campaigns.test.js
git commit -m "feat: getCampaignDetail — funnel, נמענים, engagement, לא-נשלח"
```

---

## Task 4: חיווט actions ב-`store.js`

**מטרה:** לחשוף `campaigns` ו-`campaign_detail` דרך ה-API.

**Files:**
- Modify: `modules/sequences/engine/src/store.js` (switch + 2 handlers + import)
- Test: `modules/sequences/engine/test/campaigns.test.js` (הרחבה — דרך handleAction)

**Interfaces:**
- Consumes: `listCampaigns`, `getCampaignDetail` מ-`./campaigns.js`; `query` מ-`./db.js`.
- Produces: `handleAction(accountId,'campaigns')` → `{ data: [...] }`; `handleAction(accountId,'campaign_detail',{campaign_id})` → `{ data: {...}|null }`.

- [ ] **Step 1: כתוב בדיקה נכשלת**:

```javascript
import { handleAction } from '../src/store.js';

test('handleAction: campaigns + campaign_detail', async () => {
  await seedCampaign({ id: 30, title: 'רשימה' });
  await seedCampaignMessage({ id: 1, campaignId: 30, status: 2 });
  const list = await handleAction(1, 'campaigns', {});
  assert.equal(list.data[0].title, 'רשימה');
  const detail = await handleAction(1, 'campaign_detail', { campaign_id: 30 });
  assert.equal(detail.data.campaign.title, 'רשימה');
});
```

- [ ] **Step 2: הרץ — ודא כשל** (`Unknown action: campaigns` או דומה).

- [ ] **Step 3: חווט ב-`store.js`**. הוסף import בראש הקובץ (ליד שאר ה-imports):

```javascript
import { listCampaigns, getCampaignDetail } from './campaigns.js';
```

ב-`handleAction` switch, אחרי `case 'delivery_stats':`, הוסף:

```javascript
    case 'campaigns':
      return { data: await listCampaigns(query, accountId) };
    case 'campaign_detail':
      return { data: await getCampaignDetail(query, accountId, payload?.campaign_id) };
```

- [ ] **Step 4: הרץ — ודא הצלחה**.

- [ ] **Step 5: Commit**

```bash
git add modules/sequences/engine/src/store.js modules/sequences/engine/test/campaigns.test.js
git commit -m "feat: actions campaigns + campaign_detail ב-store"
```

---

## Task 5: שכבת API ב-webapp

**מטרה:** `listCampaigns`/`getCampaignDetail` לצד ה-React, עם מיפוי נוח.

**Files:**
- Modify: `modules/sequences/webapp/src/api/sequencesApi.js` (2 פונקציות + הודעות שגיאה קיימות בשימוש חוזר)
- Test: `modules/sequences/webapp/test/campaignsApi.test.js` (Create — אם קיים דפוס בדיקת mapping; אחרת דלג לפי הדפוס של הפרויקט)

**Interfaces:**
- Consumes: `call(action, payload, accountId)` (קיים בקובץ).
- Produces: `export async function listCampaigns(accountId)`; `export async function getCampaignDetail(campaignId, accountId)`.

- [ ] **Step 1: הוסף בסוף `sequencesApi.js`**:

```javascript
// campaigns — רשימת קמפייני WhatsApp + אגרגציית סטטוס לכל קמפיין (תצוגת סקירה).
// כל שורה: { id, title, campaign_type, campaign_status, template_name, language, category,
//            audience, scheduled_at, created_at, sent, delivered, read, failed }.
export async function listCampaigns(accountId) {
  const data = await call('campaigns', {}, accountId);
  return data || [];
}

// campaign_detail — צלילה לקמפיין בודד: { campaign, funnel, engagement, recipients, not_sent }.
export async function getCampaignDetail(campaignId, accountId) {
  return call('campaign_detail', { campaign_id: campaignId }, accountId);
}
```

- [ ] **Step 2: בדיקה** (אם קיימת תיקיית `webapp/test` עם דפוס mock ל-`call`): כתוב `campaignsApi.test.js` שמריץ mock ל-`fetch` ומאמת ש-`listCampaigns` מחזיר `[]` על תשובה ריקה ומעביר `action:'campaigns'`. אם אין דפוס mock קיים (בדוק `webapp/test/`), דלג — הפונקציות טריוויאליות (עטיפת `call`). ציין בדילוג: `// ponytail: עטיפה טריוויאלית של call() — נבדק דרך ה-engine`.

- [ ] **Step 3: הרץ בדיקות webapp**.
Run: `cd modules/sequences/webapp && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add modules/sequences/webapp/src/api/sequencesApi.js modules/sequences/webapp/test/ 2>/dev/null
git commit -m "feat: שכבת API לקמפיינים ב-webapp"
```

---

## Task 6: אומדן עלות — `campaignCost.js`

**מטרה:** חישוב עלות משוערת לפי קטגוריה × כמות (ILS, ישראל), עם disclaimer.

**Files:**
- Create: `modules/sequences/webapp/src/lib/campaignCost.js`
- Test: `modules/sequences/webapp/test/campaignCost.test.js`

**Interfaces:**
- Produces: `export function estimateCost({ category, sent })` → `{ perMessage, total, currency:'ILS' }`; `export const PRICING`.

> **מחירים:** לפני מימוש, משוך מספרים עדכניים לתעריפי Meta לישראל לפי קטגוריה (MARKETING/UTILITY/AUTHENTICATION). מקור: תיעוד תמחור WhatsApp של Meta / זיכרון פרויקט (obs "WhatsApp Utility vs Marketing Template Pricing"). הערכים למטה הם **placeholder לעדכון** — סמן `// TODO(pricing): verify vs Meta IL rate card` ליד הקבוע (זה ה-*ערך היחיד* שמותר להשאיר לאימות, כי הוא נתון עסקי חיצוני משתנה).

- [ ] **Step 1: כתוב בדיקה נכשלת**. צור `campaignCost.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost } from '../src/lib/campaignCost.js';

test('estimateCost: marketing × 100', () => {
  const r = estimateCost({ category: 'MARKETING', sent: 100 });
  assert.equal(r.currency, 'ILS');
  assert.ok(r.total > 0);
  assert.equal(r.total, r.perMessage * 100);
});

test('estimateCost: unknown category → 0 (safe)', () => {
  assert.equal(estimateCost({ category: 'FOO', sent: 10 }).total, 0);
});

test('estimateCost: zero sent → 0', () => {
  assert.equal(estimateCost({ category: 'MARKETING', sent: 0 }).total, 0);
});
```

- [ ] **Step 2: הרץ — ודא כשל**.

- [ ] **Step 3: כתוב `campaignCost.js`**:

```javascript
/**
 * campaignCost.js — rough per-message cost estimate for a WhatsApp campaign.
 * WhatsApp (2025) prices per-message by template category. Israel rates, ILS.
 * ESTIMATE ONLY: excludes free-entry-point (CTWA 24h) discounts and volume tiers.
 */
// TODO(pricing): verify vs Meta IL rate card before shipping. Values in ILS per message.
export const PRICING = {
  MARKETING: 0.25,
  UTILITY: 0.05,
  AUTHENTICATION: 0.05,
};

export function estimateCost({ category, sent } = {}) {
  const perMessage = PRICING[String(category || '').toUpperCase()] || 0;
  const n = Number(sent) || 0;
  return { perMessage, total: Math.round(perMessage * n * 100) / 100, currency: 'ILS' };
}
```

- [ ] **Step 4: הרץ — ודא הצלחה**.

- [ ] **Step 5: Commit**

```bash
git add modules/sequences/webapp/src/lib/campaignCost.js modules/sequences/webapp/test/campaignCost.test.js
git commit -m "feat: אומדן עלות קמפיין לפי קטגוריה (ILS)"
```

---

## Task 7: `CampaignsView.jsx` — רמה 1 (סקירה)

**מטרה:** כרטיסי KPI + טבלת קמפיינים + גרף מגמה + השוואה. בחירת שורה → callback לצלילה.

**Files:**
- Create: `modules/sequences/webapp/src/components/CampaignsView.jsx`

**Interfaces:**
- Consumes: `listCampaigns` (Task 5); רכיבי UI קיימים — `Badge`, `Button`, `Skeleton`/`SkeletonRows`, `Table/THead/TBody/TR/TH/TD` (מ-`./ui/`), `useT`, `translate`.
- Produces: `export default function CampaignsView({ accountId, onSelect })` — `onSelect(campaignId)` נקרא בלחיצה על שורה.

> **דפוס מנחה (חובה לקרוא לפני כתיבה):** `OverviewView.jsx` — העתק ממנו את מבנה: (א) `load()` עם `useState/useCallback/useEffect` + מצבי loading/error, (ב) גריד כרטיסי ה-KPI (`TOTAL_CARDS.map` → `div.rounded-xl.bg-n-alpha-1...`), (ג) skeleton. הטבלה — לפי הדפוס ב-`App.jsx` (`Table/THead/TBody/TR/TH/TD`). i18n — מילון `M={he,en}` co-located כמו בכל רכיב.

- [ ] **Step 1: כתוב `CampaignsView.jsx`**. מבנה מלא:

```jsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertCircle, Megaphone, BarChart3, Trophy } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Skeleton, { SkeletonRows } from './ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from './ui/Table.jsx';
import { listCampaigns } from '../api/sequencesApi.js';
import useT from '../useT.js';
import { translate } from '../i18n.js';

const M = {
  he: { kTotal: 'קמפיינים', kSent: 'נשלחו', kDelivered: 'נמסרו', kRead: 'נקראו', kFailed: 'נכשלו',
        colName: 'קמפיין', colStatus: 'סטטוס', colDate: 'תאריך', colAudience: 'קהל',
        colSent: 'נשלחו', colDelivered: 'נמסרו', colRead: 'נקראו', colReadRate: 'אחוז קריאה',
        refresh: 'רענון', empty: 'אין עדיין קמפייני WhatsApp.', errLoad: 'שגיאה בטעינת הקמפיינים',
        compareTitle: 'השוואת קמפיינים (לפי אחוז קריאה)',
        st_active: 'פעיל', st_completed: 'הסתיים', st_processing: 'בעיבוד' },
  en: { kTotal: 'Campaigns', kSent: 'Sent', kDelivered: 'Delivered', kRead: 'Read', kFailed: 'Failed',
        colName: 'Campaign', colStatus: 'Status', colDate: 'Date', colAudience: 'Audience',
        colSent: 'Sent', colDelivered: 'Delivered', colRead: 'Read', colReadRate: 'Read rate',
        refresh: 'Refresh', empty: 'No WhatsApp campaigns yet.', errLoad: 'Failed to load campaigns',
        compareTitle: 'Campaign comparison (by read rate)',
        st_active: 'Active', st_completed: 'Completed', st_processing: 'Processing' },
};

const STATUS_LABEL = { 0: 'st_active', 1: 'st_completed', 2: 'st_processing' };
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

export default function CampaignsView({ accountId, onSelect }) {
  const t = useT(M);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (accountId == null) return;
    setLoading(true); setError('');
    listCampaigns(accountId)
      .then(setRows)
      .catch((e) => setError(e.message || translate(M, 'errLoad')))
      .finally(() => setLoading(false));
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => rows.reduce((a, c) => ({
    sent: a.sent + c.sent, delivered: a.delivered + c.delivered, read: a.read + c.read, failed: a.failed + c.failed,
  }), { sent: 0, delivered: 0, read: 0, failed: 0 }), [rows]);

  const ranked = useMemo(
    () => [...rows].filter((c) => c.sent > 0).sort((a, b) => pct(b.read, b.sent) - pct(a.read, a.sent)).slice(0, 5),
    [rows]
  );

  if (loading) return <div className="flex flex-col gap-4"><Skeleton className="h-20 w-full rounded-xl" /><SkeletonRows rows={4} cols={6} /></div>;
  if (error) return (
    <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{error}</span>
    </div>
  );

  const KPIS = [
    { label: t('kTotal'), value: rows.length, text: 'text-n-blue-11' },
    { label: t('kSent'), value: totals.sent, text: 'text-n-slate-12' },
    { label: t('kDelivered'), value: `${pct(totals.delivered, totals.sent)}%`, text: 'text-n-teal-11' },
    { label: t('kRead'), value: `${pct(totals.read, totals.sent)}%`, text: 'text-n-blue-11' },
    { label: t('kFailed'), value: `${pct(totals.failed, totals.sent)}%`, text: 'text-n-ruby-11' },
  ];

  return (
    <>
      {/* KPI cards — דפוס זהה ל-TOTAL_CARDS ב-OverviewView */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {KPIS.map((c) => (
          <div key={c.label} className="flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 ring-1 ring-n-weak">
            <span className={`text-2xl font-semibold leading-none ${c.text}`}>{c.value}</span>
            <span className="mt-1 text-xs text-n-slate-11">{c.label}</span>
          </div>
        ))}
      </div>

      {/* השוואה — bar-list לפי אחוז קריאה */}
      {ranked.length > 0 ? (
        <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
            <Trophy size={15} className="text-n-blue-11" aria-hidden="true" />{t('compareTitle')}
          </h2>
          <div className="flex flex-col gap-2">
            {ranked.map((c) => {
              const rr = pct(c.read, c.sent);
              return (
                <div key={c.id} className="flex items-center gap-3">
                  <span className="w-40 truncate text-xs text-n-slate-11" title={c.title}>{c.title}</span>
                  <div className="h-2 flex-1 rounded-full bg-n-alpha-3"><div className="h-2 rounded-full bg-n-brand" style={{ width: `${rr}%` }} /></div>
                  <span className="w-10 text-end text-xs font-medium text-n-slate-12">{rr}%</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-n-slate-12">
          <BarChart3 size={15} className="text-n-blue-11" aria-hidden="true" />{t('kTotal')}
        </h2>
        <Button variant="ghost" color="slate" size="sm" icon={RefreshCw} onClick={load}>{t('refresh')}</Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-n-strong bg-n-solid-2 py-16 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-n-brand/10 text-n-blue-11"><Megaphone size={24} aria-hidden="true" /></span>
          <p className="text-sm text-n-slate-11">{t('empty')}</p>
        </div>
      ) : (
        <Table>
          <THead><TR className="hover:bg-transparent">
            <TH>{t('colName')}</TH><TH>{t('colStatus')}</TH><TH>{t('colDate')}</TH>
            <TH align="end">{t('colSent')}</TH><TH align="end">{t('colDelivered')}</TH>
            <TH align="end">{t('colRead')}</TH><TH align="end">{t('colReadRate')}</TH>
          </TR></THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id} className="cursor-pointer" onClick={() => onSelect?.(c.id)}>
                <TD><span className="font-medium text-n-slate-12">{c.title}</span>
                  {c.template_name ? <span className="mt-0.5 block font-mono text-xs text-n-slate-10">{c.template_name}</span> : null}</TD>
                <TD><Badge color={c.campaign_status === 1 ? 'slate' : c.campaign_status === 2 ? 'blue' : 'teal'}>{t(STATUS_LABEL[c.campaign_status] || 'st_active')}</Badge></TD>
                <TD><span className="text-xs text-n-slate-11">{c.created_at || '—'}</span></TD>
                <TD align="end">{c.sent}</TD>
                <TD align="end"><span className="text-n-teal-11">{c.delivered}</span></TD>
                <TD align="end">{c.read}</TD>
                <TD align="end"><span className="font-medium">{pct(c.read, c.sent)}%</span></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
```

- [ ] **Step 2: אימות ויזואלי מהיר**. אם קיים `webapp` dev/preview, ודא שהרכיב מתקמפל (`npm run build` ב-webapp). אין בדיקת unit לרכיב React (הפרויקט לא בודק רכיבים — רק lib/api). ודא `Table` מקבל `onClick` על `TR` (בדוק `ui/Table.jsx`; אם `TR` לא מעביר props → הוסף `onClick` על `TD` הראשון או עטוף). 

- [ ] **Step 3: Commit**

```bash
git add modules/sequences/webapp/src/components/CampaignsView.jsx
git commit -m "feat: CampaignsView — רמה 1 (KPI, טבלה, השוואה)"
```

---

## Task 7B: גרף מגמה לאורך זמן

**מטרה:** גרף עמודות של הודעות קמפיין (נשלחו/נמסרו/נכשלו) לפי יום, ברמת הסקירה. שכבה אנכית: engine read → action → api → הצגה ב-`CampaignsView`.

**Files:**
- Modify: `modules/sequences/engine/src/campaigns.js` (+`campaignsTrend`)
- Modify: `modules/sequences/engine/src/store.js` (+action `campaigns_trend`)
- Modify: `modules/sequences/webapp/src/api/sequencesApi.js` (+`getCampaignsTrend`)
- Modify: `modules/sequences/webapp/src/components/CampaignsView.jsx` (+כרטיס גרף)
- Test: `modules/sequences/engine/test/campaigns.test.js` (+trend)

**Interfaces:**
- Produces: `export async function campaignsTrend(query, accountId, days=14)` → `Array<{ day, sent, delivered, failed }>` (ישן→חדש); action `campaigns_trend`; webapp `getCampaignsTrend(accountId)`.

- [ ] **Step 1: בדיקה נכשלת** (ל-`campaigns.test.js`):

```javascript
import { campaignsTrend } from '../src/campaigns.js';

test('campaignsTrend: buckets campaign messages by day', async () => {
  await seedCampaign({ id: 40 });
  await seedCampaignMessage({ id: 1, campaignId: 40, status: 1 });
  await seedCampaignMessage({ id: 2, campaignId: 40, status: 3 });
  const trend = await campaignsTrend(query, 1, 14);
  assert.ok(trend.length >= 1);
  const last = trend[trend.length - 1];
  assert.equal(last.sent, 2);
  assert.equal(last.delivered, 1);
  assert.equal(last.failed, 1);
});
```

- [ ] **Step 2: הרץ — ודא כשל** (`campaignsTrend is not a function`).

- [ ] **Step 3: הוסף `campaignsTrend` ל-`campaigns.js`**:

```javascript
// Daily campaign-message trend (last `days`), Asia/Jerusalem, oldest → newest.
export async function campaignsTrend(query, accountId, days = 14) {
  const TZ = 'Asia/Jerusalem';
  return query(
    `SELECT to_char(m.created_at AT TIME ZONE '${TZ}', 'DD/MM') AS day,
            count(*)::int AS sent,
            count(*) FILTER (WHERE m.status IN (1,2))::int AS delivered,
            count(*) FILTER (WHERE m.status = 3)::int       AS failed
       FROM public.messages m
      WHERE m.account_id = $1
        AND m.content_attributes::jsonb ? 'campaign_id'
        AND m.created_at >= (now() AT TIME ZONE '${TZ}')::date - ($2::int - 1) * interval '1 day'
      GROUP BY 1, date_trunc('day', m.created_at AT TIME ZONE '${TZ}')
      ORDER BY date_trunc('day', m.created_at AT TIME ZONE '${TZ}')`,
    [accountId, days]
  );
}
```

- [ ] **Step 4: action ב-`store.js`**. הוסף `campaignsTrend` לשורת ה-import מ-`./campaigns.js`, ו-case:

```javascript
    case 'campaigns_trend':
      return { data: await campaignsTrend(query, accountId, payload?.days || 14) };
```

- [ ] **Step 5: הרץ בדיקות engine — ודא הצלחה**.

- [ ] **Step 6: api ב-`sequencesApi.js`**:

```javascript
// campaigns_trend — הודעות קמפיין לפי יום (נשלחו/נמסרו/נכשלו) לגרף המגמה.
export async function getCampaignsTrend(accountId) {
  const data = await call('campaigns_trend', {}, accountId);
  return data || [];
}
```

- [ ] **Step 7: הצגה ב-`CampaignsView.jsx`**. ייבא `getCampaignsTrend` ו-`TrendingUp` (lucide). הוסף `const [trend, setTrend] = useState([]);`, ובתוך `load()` הוסף קריאה מקבילה: `getCampaignsTrend(accountId).then(setTrend).catch(() => setTrend([]));`. הוסף למילון: `trendTitle: 'מגמת קמפיינים'` / `'Campaign trend'`. הצג כרטיס גרף מיד אחרי כרטיסי ה-KPI — **הדפוס זהה ל-trend bars ב-`DeliveryCard` ב-`OverviewView.jsx`**:

```jsx
{trend.length > 0 ? (
  <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
    <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-n-slate-12"><TrendingUp size={15} className="text-n-blue-11" aria-hidden="true" />{t('trendTitle')}</h2>
    <div className="flex items-end gap-1.5">
      {trend.map((dd) => {
        const maxT = Math.max(1, ...trend.map((x) => x.sent || 0));
        const okH = Math.round(((dd.delivered || 0) / maxT) * 44);
        const failH = Math.round(((dd.failed || 0) / maxT) * 44);
        return (
          <div key={dd.day} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full max-w-[28px] flex-col justify-end" style={{ height: '48px' }}>
              <div className="w-full rounded-t bg-n-ruby-9" style={{ height: `${failH}px` }} title={`${dd.day}: ${dd.failed || 0}`} />
              <div className="w-full bg-n-teal-9" style={{ height: `${okH}px` }} title={`${dd.day}: ${dd.delivered || 0}`} />
            </div>
            <span className="text-[10px] text-n-slate-10">{dd.day}</span>
          </div>
        );
      })}
    </div>
  </div>
) : null}
```

- [ ] **Step 8: build + ודא קימפול**. `cd modules/sequences/webapp && npm run build`.

- [ ] **Step 9: Commit**

```bash
git add modules/sequences/engine/src/campaigns.js modules/sequences/engine/src/store.js modules/sequences/engine/test/campaigns.test.js modules/sequences/webapp/src/api/sequencesApi.js modules/sequences/webapp/src/components/CampaignsView.jsx
git commit -m "feat: גרף מגמת קמפיינים לאורך זמן"
```

---

## Task 8: `CampaignDetailView.jsx` — רמה 2 (קמפיין בודד)

**מטרה:** funnel, סיבות כשל בעברית, engagement, עלות, טבלת נמענים + "לא נשלח", ייצוא CSV.

**Files:**
- Create: `modules/sequences/webapp/src/components/CampaignDetailView.jsx`

**Interfaces:**
- Consumes: `getCampaignDetail` (Task 5), `estimateCost`+`PRICING` (Task 6), רכיבי UI, `useT`.
- Produces: `export default function CampaignDetailView({ campaignId, accountId, onBack })`.

> **דפוס מנחה:** `DeliveryCard` ב-`OverviewView.jsx` (funnel/metrics grid), ומיפוי סיבות הכשל שם (`reason*`). טבלה — כמו Task 7. CSV — מחרוזת עם BOM (`'﻿'`) + `Blob` + `a.download` (client-side).

- [ ] **Step 1: כתוב `CampaignDetailView.jsx`**:

```jsx
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ArrowLeft, AlertCircle, Download, MessageSquare, Coins } from 'lucide-react';
import Badge from './ui/Badge.jsx';
import Button from './ui/Button.jsx';
import Skeleton from './ui/Skeleton.jsx';
import { Table, THead, TBody, TR, TH, TD } from './ui/Table.jsx';
import { getCampaignDetail } from '../api/sequencesApi.js';
import { estimateCost } from '../lib/campaignCost.js';
import useT, { useLocale } from '../useT.js';
import { translate } from '../i18n.js';

const M = {
  he: { back: 'חזרה', audience: 'קהל', sent: 'נשלחו', delivered: 'נמסרו', read: 'נקראו', failed: 'נכשלו',
        funnel: 'משפך מסירה', replied: 'הגיבו', replyRate: 'שיעור תגובה', costTitle: 'עלות משוערת',
        costNote: 'אומדן לפי תעריפי Meta לישראל — לא כולל חלון חינם/הנחות',
        recipients: 'נמענים', notSent: 'לא נשלחו', name: 'שם', phone: 'טלפון', status: 'סטטוס', when: 'זמן',
        export: 'ייצוא CSV', errLoad: 'שגיאה בטעינת הקמפיין', notFound: 'הקמפיין לא נמצא',
        s_sent: 'נשלח', s_delivered: 'נמסר', s_read: 'נקרא', s_failed: 'נכשל', s_pending: 'ממתין' },
  en: { back: 'Back', audience: 'Audience', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed',
        funnel: 'Delivery funnel', replied: 'Replied', replyRate: 'Reply rate', costTitle: 'Estimated cost',
        costNote: 'Estimate at Meta IL rates — excludes free window / discounts',
        recipients: 'Recipients', notSent: 'Not sent', name: 'Name', phone: 'Phone', status: 'Status', when: 'Time',
        export: 'Export CSV', errLoad: 'Failed to load campaign', notFound: 'Campaign not found',
        s_sent: 'Sent', s_delivered: 'Delivered', s_read: 'Read', s_failed: 'Failed', s_pending: 'Pending' },
};
const STATUS_KEY = { 0: 's_sent', 1: 's_delivered', 2: 's_read', 3: 's_failed' };
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);

export default function CampaignDetailView({ campaignId, accountId, onBack }) {
  const t = useT(M);
  const locale = useLocale();
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (accountId == null || campaignId == null) return;
    setLoading(true); setError('');
    getCampaignDetail(campaignId, accountId)
      .then(setD)
      .catch((e) => setError(e.message || translate(M, 'errLoad')))
      .finally(() => setLoading(false));
  }, [campaignId, accountId]);
  useEffect(() => { load(); }, [load]);

  const BackIcon = locale === 'he' ? ArrowRight : ArrowLeft;

  if (loading) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (error) return (
    <div className="flex items-start gap-2.5 rounded-xl border border-n-ruby-7 bg-n-ruby-3 px-4 py-3 text-sm text-n-ruby-11">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{error}</span>
    </div>
  );
  if (!d) return <div className="py-16 text-center text-sm text-n-slate-11">{t('notFound')}</div>;

  const { campaign, funnel, engagement, recipients, not_sent } = d;
  const cost = estimateCost({ category: campaign.category, sent: funnel.sent });

  const exportCsv = () => {
    const head = [t('name'), t('phone'), t('status'), t('when')];
    const body = recipients.map((r) => [r.contact_name || '', r.phone || '', t(STATUS_KEY[r.status] || 's_pending'), r.sent_at || '']);
    const csv = '﻿' + [head, ...body].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `campaign-${campaign.id}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const FUNNEL = [
    { label: t('audience'), value: funnel.audience, text: 'text-n-slate-12' },
    { label: t('sent'), value: funnel.sent, text: 'text-n-slate-12' },
    { label: t('delivered'), value: funnel.delivered, sub: `${pct(funnel.delivered, funnel.sent)}%`, text: 'text-n-teal-11' },
    { label: t('read'), value: funnel.read, sub: `${pct(funnel.read, funnel.sent)}%`, text: 'text-n-blue-11' },
    { label: t('failed'), value: funnel.failed, sub: `${pct(funnel.failed, funnel.sent)}%`, text: 'text-n-ruby-11' },
  ];

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-n-slate-11 hover:text-n-slate-12">
          <BackIcon size={15} aria-hidden="true" />{t('back')}
        </button>
        <Button variant="faded" color="slate" size="sm" icon={Download} onClick={exportCsv}>{t('export')}</Button>
      </div>

      <div className="mb-4">
        <h1 className="text-lg font-semibold text-n-slate-12">{campaign.title}</h1>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {campaign.template_name ? <Badge color="slate">{campaign.template_name}</Badge> : null}
          {campaign.category ? <Badge color="blue">{campaign.category}</Badge> : null}
        </div>
      </div>

      {/* funnel — דפוס DeliveryMetric מ-OverviewView */}
      <div className="mb-5 rounded-xl border border-n-weak bg-n-surface-1 p-4">
        <h2 className="mb-3 text-sm font-medium text-n-slate-12">{t('funnel')}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {FUNNEL.map((m) => (
            <div key={m.label} className="flex flex-col items-start rounded-lg bg-n-alpha-1 px-3 py-2 ring-1 ring-n-weak">
              <span className={`text-xl font-semibold leading-none ${m.text}`}>{m.value}</span>
              <span className="mt-1 text-xs text-n-slate-11">{m.label}{m.sub ? ` · ${m.sub}` : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {/* engagement + cost — שני כרטיסים */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-n-slate-12"><MessageSquare size={15} className="text-n-blue-11" aria-hidden="true" />{t('replied')}</h2>
          <div className="flex items-baseline gap-2"><span className="text-2xl font-semibold text-n-slate-12">{engagement.replied}</span><span className="text-xs text-n-slate-11">{t('replyRate')}: {engagement.reply_rate}%</span></div>
        </div>
        <div className="rounded-xl border border-n-weak bg-n-surface-1 p-4">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-n-slate-12"><Coins size={15} className="text-n-blue-11" aria-hidden="true" />{t('costTitle')}</h2>
          <div className="flex items-baseline gap-1"><span className="text-2xl font-semibold text-n-slate-12">₪{cost.total}</span></div>
          <p className="mt-1 text-xs text-n-slate-10">{t('costNote')}</p>
        </div>
      </div>

      {/* נמענים */}
      <h2 className="mb-2 text-sm font-medium text-n-slate-12">{t('recipients')} ({recipients.length})</h2>
      <Table>
        <THead><TR className="hover:bg-transparent"><TH>{t('name')}</TH><TH>{t('phone')}</TH><TH>{t('status')}</TH><TH>{t('when')}</TH></TR></THead>
        <TBody>
          {recipients.map((r, i) => (
            <TR key={i}>
              <TD><span className="text-n-slate-12">{r.contact_name || '—'}</span></TD>
              <TD><span className="font-mono text-xs">{r.phone || '—'}</span></TD>
              <TD><Badge color={r.status === 3 ? 'ruby' : r.status === 2 ? 'blue' : r.status === 1 ? 'teal' : 'slate'}>{t(STATUS_KEY[r.status] || 's_pending')}</Badge>
                {r.error_title ? <span className="mt-0.5 block text-xs text-n-ruby-11">{r.error_title}</span> : null}</TD>
              <TD><span className="text-xs text-n-slate-11">{r.sent_at || '—'}</span></TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {/* לא נשלחו */}
      {not_sent && not_sent.length > 0 ? (
        <div className="mt-5">
          <h2 className="mb-2 text-sm font-medium text-n-slate-12">{t('notSent')} ({not_sent.length})</h2>
          <div className="flex flex-wrap gap-1.5">
            {not_sent.map((c, i) => (
              <span key={i} className="rounded-full bg-n-alpha-2 px-2.5 py-1 text-xs text-n-slate-11">{c.contact_name || c.phone}</span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 2: אימות קומפילציה** (`npm run build` ב-webapp). ודא רכיבי UI (`Badge` צבעים `ruby/teal/blue/slate` קיימים — בדוק `ui/Badge.jsx`).

- [ ] **Step 3: Commit**

```bash
git add modules/sequences/webapp/src/components/CampaignDetailView.jsx
git commit -m "feat: CampaignDetailView — funnel, engagement, עלות, נמענים, CSV"
```

---

## Task 9: חיווט הטאב ב-`App.jsx`

**מטרה:** טאב "קמפיינים" רביעי + ניתוב לצלילה + הרחבת ניווט postMessage/URL.

**Files:**
- Modify: `modules/sequences/webapp/src/App.jsx`

**Interfaces:**
- Consumes: `CampaignsView`, `CampaignDetailView`.

- [ ] **Step 1: imports + i18n**. הוסף ל-imports: `import CampaignsView from './components/CampaignsView.jsx';`, `import CampaignDetailView from './components/CampaignDetailView.jsx';`, ואייקון `Megaphone` מ-`lucide-react`. במילון `M`, הוסף לשני ה-locales: `tab_campaigns: 'קמפיינים'` / `tab_campaigns: 'Campaigns'`.

- [ ] **Step 2: state לצלילה**. ליד `const [view, setView]`, הוסף:

```jsx
const [campaignId, setCampaignId] = useState(null); // קמפיין נבחר לצלילה (null = רשימה)
```

- [ ] **Step 3: הרחב את ה-`valid` של הטאבים**. בשני המקומות שבהם מופיע `v === 'contacts' || v === 'sequences' || v === 'overview'` (ה-init של `view` וה-`onMsg` של postMessage), הוסף `|| v === 'campaigns'`. באותו `onMsg`, הרחב את התנאי `d.tab === 'overview' || ...` עם `|| d.tab === 'campaigns'`.

- [ ] **Step 4: `viewTitle`**. עדכן את שורת `viewTitle` לכלול קמפיינים:

```jsx
const viewTitle = view === 'sequences' ? t('tab_sequences') : view === 'contacts' ? t('tab_contacts') : view === 'campaigns' ? t('tab_campaigns') : t('tab_overview');
```

- [ ] **Step 5: TabButton**. אחרי ה-`TabButton` של `contacts`, הוסף (בתוך הבלוק `!sideNav` של הטאבים):

```jsx
<TabButton active={view === 'campaigns'} onClick={() => { setView('campaigns'); setCampaignId(null); }} icon={Megaphone}>
  {t('tab_campaigns')}
</TabButton>
```

- [ ] **Step 6: render**. בבלוק התוכן (ה-`noAccount ? ... : view === 'overview' ? <OverviewView/> : ...`), הוסף ענף לפני `view === 'contacts'`:

```jsx
) : view === 'campaigns' ? (
  campaignId != null
    ? <CampaignDetailView campaignId={campaignId} accountId={accountId} onBack={() => setCampaignId(null)} />
    : <CampaignsView accountId={accountId} onSelect={setCampaignId} />
```

- [ ] **Step 7: אימות build** (`npm run build`) — קימפול נקי, הטאב מופיע.

- [ ] **Step 8: Commit**

```bash
git add modules/sequences/webapp/src/App.jsx
git commit -m "feat: טאב קמפיינים ב-App + ניתוב צלילה"
```

---

## Task 10: טאב קמפיינים בסיידבר — `sequences-nav.js`

**מטרה:** להוסיף "קמפיינים" כפריט-משנה רביעי בקבוצת הניווט בסיידבר של Chatwoot.

**Files:**
- Modify: `modules/sequences/inject/sequences-nav.js`

- [ ] **Step 1: הרחב `TAB_KEYS`**. שנה `var TAB_KEYS = ['overview', 'sequences', 'contacts'];` ל-`['overview', 'sequences', 'contacts', 'campaigns'];`.

- [ ] **Step 2: תוויות i18n**. בשני ה-locales של `NAV_I18N`, הוסף `campaigns: 'קמפיינים'` (he) / `campaigns: 'Campaigns'` (en).

- [ ] **Step 3: valid tabs**. בכל מקום שמופיע הבדיקה `t === 'overview' || t === 'sequences' || t === 'contacts'` (ב-`dripFromUrl` וב-`dripFromState`), הוסף `|| t === 'campaigns'`.

- [ ] **Step 4: אימות ידני** (dashboard חי): הפריט "קמפיינים" מופיע תחת קבוצת רצפי WhatsApp, לחיצה פותחת את הטאב ב-iframe. (אין בדיקת unit — DOM injection; מאומת ידנית מול Chatwoot חי בשלב הפריסה.)

- [ ] **Step 5: Commit**

```bash
git add modules/sequences/inject/sequences-nav.js
git commit -m "feat: פריט קמפיינים בניווט הסיידבר"
```

---

## Task 11: כפתור העלאת מדיה — `campaign-modal.js`

**מטרה:** כפתור "העלה קובץ" ליד שדה `media_url` של Chatwoot, שמעלה ל-endpoint הקיים וממלא את ה-URL.

**Files:**
- Modify: `modules/dashboard-enhancements/parts/campaign-modal.js`

> **דפוס:** ה-IIFE כבר קורא cookie ל-auth (`getChatwootAuthHeaders`), משתמש ב-`setNativeValue`, ומזהה שדות לפי placeholder. שדה ה-media של Chatwoot: `<input type="url">` שה-placeholder/label שלו קשור למדיה (`WhatsAppTemplateParser.vue`). ה-endpoint: `POST ${window.__CW_ADDONS_BASE}/drip-api/media?account_id=N&format=IMAGE|VIDEO|DOCUMENT&locale=he|en` (raw body, `Content-Type` = mime, header `x-filename`). מחזיר `{ ok, data:{ url } }`.

- [ ] **Step 1: זהה את שדה ה-media_url ואת סוג ה-header**. הוסף פונקציה שמוצאת את ה-`<input type="url">` בטופס הקמפיין (Chatwoot מרנדר אותו רק כשהתבנית כוללת header מדיה). את סוג ה-header (IMAGE/VIDEO/DOCUMENT) גזור מכרטיס התצוגה המקדימה שכבר נקרא (`enhancePreviewCard` קורא `format`), או מ-attribute על השדה. אחסן ב-`data-drip-media-format`.

- [ ] **Step 2: הוסף CSS לכפתור** (בבלוק ה-`<style>` הקיים): כפתור קטן בסגנון `.drip-chip`.

- [ ] **Step 3: פונקציית ההעלאה**. הוסף בתוך ה-IIFE:

```javascript
function accountIdFromPath() {
  var m = location.pathname.match(/accounts\/(\d+)/);
  return m ? m[1] : '';
}
function uploadCampaignMedia(file, format, urlInput, btn) {
  var base = window.__CW_ADDONS_BASE || '/chatwoot-addons';
  var acc = accountIdFromPath();
  var loc = DRIP_LOCALE; // כבר מחושב בראש הקובץ
  var busy = (btn.textContent = (loc === 'he' ? 'מעלה…' : 'Uploading…'));
  fetch(base + '/drip-api/media?account_id=' + encodeURIComponent(acc) +
        '&format=' + encodeURIComponent(format) + '&locale=' + loc, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name || 'file') },
    body: file,
  })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
    .then(function (res) {
      if (!res.ok || !res.j || res.j.ok === false) throw new Error((res.j && res.j.error) || 'upload failed');
      setNativeValue(urlInput, res.j.data.url); // Vue קולט את ה-URL הציבורי
      btn.textContent = (loc === 'he' ? '✓ הועלה' : '✓ Uploaded');
    })
    .catch(function (e) { btn.textContent = (loc === 'he' ? '✗ נכשל' : '✗ Failed'); btn.title = e.message; })
    .finally(function () { setTimeout(function () { btn.textContent = (loc === 'he' ? '📎 העלה קובץ' : '📎 Upload'); }, 2500); });
  void busy;
}
```

- [ ] **Step 4: הזרקת הכפתור**. הוסף פונקציה `augmentMediaInput(urlInput)` שיוצרת `<button>` + `<input type=file hidden>` (עם `accept` לפי ה-format), מזריקה ליד `urlInput`, ומחווטת ל-`uploadCampaignMedia`. קרא לה מתוך ה-`MutationObserver` הקיים (ליד `enhanceCampaign()`), עם guard `data-drip-media` כדי לא לכפול.

- [ ] **Step 5: אימות ידני** (Chatwoot חי, תבנית עם header תמונה): הכפתור מופיע, בחירת קובץ מעלה וממלאת את ה-URL, שליחת הקמפיין עוברת עם המדיה. בדוק גם קובץ חורג-גודל → הודעת שגיאה דו-לשונית (validation של `media.js`).

- [ ] **Step 6: Commit**

```bash
git add modules/dashboard-enhancements/parts/campaign-modal.js
git commit -m "feat: כפתור העלאת מדיה בטופס הקמפיין"
```

---

## Task 12: Build + אינטגרציה

**מטרה:** לבנות את ה-webapp dist (committed) ולוודא שהכל מתלכד.

**Files:**
- Rebuild: `modules/sequences/webapp/dist/*` (committed — נדרש כי ה-engine `COPY`־ה אותו)
- Verify: `install.sh` header (פקודות ה-build/merge המדויקות)

- [ ] **Step 1: קרא את הוראות ה-build**. ב-`install.sh` יש בראש הקובץ הערה עם פקודות ה-build המדויקות ל-`webapp` ול-מיזוג `smart-import`. עקוב אחריהן במדויק.

- [ ] **Step 2: build webapp**.
Run: `cd modules/sequences/webapp && npm ci && npm run build`
Expected: `dist/` מתעדכן, בלי שגיאות.

- [ ] **Step 3: merge smart-import** (לפי ההערה ב-install.sh) — `modules/smart-import` build → `webapp/dist/smart-import/`.

- [ ] **Step 4: הרץ את כל חבילת הבדיקות**.
Run: `cd modules/sequences/engine && npm test` + `cd ../webapp && npm test` + `bats test/*.bats` (מהשורש)
Expected: הכל PASS.

- [ ] **Step 5: Commit ה-dist**

```bash
git add modules/sequences/webapp/dist
git commit -m "build: webapp dist עם טאב הקמפיינים"
```

---

## פריסה (אחרי מיזוג — לא חלק מה-tasks)

1. **admon:** `git pull` על ה-repo המותקן → `sudo bash install.sh --modules=all` (re-run: מחיל grants חדשים, בונה engine image, מזריק dashboard-script מעודכן). ודא הטאב חי, ואז הסר את `campaign_report_dashboard.rb` מ-`/opt/chatwoot/custom-initializers/` (backup קודם).
2. **achiya:** שדרוג `drip-engine` → cwpt (תת-פרויקט נפרד — ראה §7 במפרט). בדיקות ה-UI על הדאטה האמיתי כאן.

---

## Self-Review (בוצע בזמן הכתיבה)

- **כיסוי spec:** דשבורד רמה 1 (Task 7) ✓, רמה 2 (Task 8) ✓, 4 תוספות — engagement (T3/T8) ✓, השוואה (T7) ✓, עלות (T6/T8) ✓, גרף מגמה לאורך זמן (Task 7B — engine `campaignsTrend` → action → api → הצגה) ✓. מדיה (T11) ✓, grants (T1) ✓, פריסה ✓. כל 4 התוספות שנבחרו מכוסות ב-task ייעודי.
- **Placeholders:** רק `TODO(pricing)` — נתון עסקי חיצוני מכוון (מסומן ב-spec §6).
- **עקביות טיפוסים:** `listCampaigns(query, accountId)` / `getCampaignDetail(query, accountId, campaignId)` (engine) עקבי מול `listCampaigns(accountId)` / `getCampaignDetail(campaignId, accountId)` (webapp — עוטף `call`). שדות: `sent/delivered/read/failed`, `funnel.{audience,sent,delivered,read,failed}`, `engagement.{replied,reply_rate}`, `recipients[].{contact_name,phone,status,error_title,sent_at}`, `not_sent[].{contact_name,phone}` — עקבי בין T3/T4/T5/T7/T8.
