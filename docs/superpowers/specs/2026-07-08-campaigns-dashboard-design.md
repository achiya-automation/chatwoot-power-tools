# מפרט עיצוב — דשבורד קמפיינים של WhatsApp + העלאת מדיה בקמפיין

**תאריך:** 2026-07-08 · **סטטוס:** טיוטה לאישור · **ריפו:** `chatwoot-power-tools` (cwpt)

---

## 1. רקע ומצב קיים

cwpt הוא ערכת תוספים ל-Chatwoot self-hosted (v4.x), בנויה מ-3 מודולים המוגשים same-origin תחת `/chatwoot-addons/*`: `smart-import`, `sequences` (drip), ו-`dashboard-enhancements`. הליבה: sidecar `cwpt-engine` (Node/Express) + role DB least-privilege (`drip_engine`/schema `drip`) + הזרקת `DASHBOARD_SCRIPTS`.

**מה שכבר קיים ורלוונטי (נמצא בחקירה, לא לבנות מחדש):**

| רכיב | קיים | היכן |
|---|---|---|
| דשבורד analytics עשיר (KPI cards, גרף מגמה 7 ימים, סיבות חסימה, פילוח) | ✅ אך **על רצפים בלבד** | `webapp/src/components/OverviewView.jsx` |
| מעקב מסירה מלא (sent/delivered/read/failed + error codes) | ✅ אך על רצפים | `engine/migrations/008_delivery_status.sql`, `reconcile.js` |
| העלאת מדיה (endpoint + validation + volume + טבלה) | ✅ אך על רצפים | `engine/src/api.js` (`POST /drip-api/media`), `engine/src/media.js`, `migrations/012_media.sql` |
| שדרוג מודל הקמפיין (variable chips, token pills, preview) | ✅ | `dashboard-enhancements/parts/campaign-modal.js` |
| מבנה טאבים (`overview`/`sequences`/`contacts`) + ניווט postMessage | ✅ | `webapp/src/App.jsx` |
| grants DB על `messages`,`contacts`,`conversations`,`accounts` | ✅ | `lib/db.sh` |

**מה שקיים מחוץ ל-cwpt (על השרתים, לא ב-repo):**

- **`whatsapp_campaign_conversations.rb`** — Ruby initializer (monkey-patch על `Whatsapp::OneoffCampaignService`) שפרוס **גם על admon וגם על achiya**. הוא הדבר היחיד שגורם לכל שליחת קמפיין WhatsApp **להירשם כ-conversation+message בתוך Chatwoot** עם `message.content_attributes.campaign_id` ו-`source_id` (שממנו webhook של Meta מעדכן סטטוס). **בלי הפאץ' הזה — אין נתונים לדשבורד.**
- **`campaign_report_dashboard.rb`** — Rack middleware שמגיש `/campaign-report` (טבלה + funnel + CSV). קיים **רק על admon**. מקור הנתונים שלו מבוסס `content_attributes::text LIKE '%<id>%'` — **באגי** (קמפיין 17 תופס 170/217). זהו הדשבורד שאנחנו מחליפים.

**עובדה מכריעה #1:** מדיה ב-header של קמפיין WhatsApp **כבר נתמכת נייטיבית ב-Chatwoot v4.15.1** מקצה לקצה (`TemplateProcessorService` → `populate_template_parameters_service` → provider → Meta, בתבנית `{link: <public_url>}`). ה-frontend (`WhatsAppTemplateParser.vue`) כבר מרנדר שדה `media_url` כשהתבנית כוללת header IMAGE/VIDEO/DOCUMENT. **הפער היחיד: אין כפתור העלאת קובץ — צריך להדביק URL ידנית.**

**עובדה מכריעה #2:** הקישור הודעה→קמפיין ל-WhatsApp הוא **רק** `messages.content_attributes.campaign_id` (ש-`conversations.campaign_id` נשאר `NULL` ל-WhatsApp). כל שאילתת דשבורד חייבת להישען על זה, עם `@>` jsonb containment (לא LIKE).

---

## 2. מטרות

1. **דשבורד קמפיינים** — טאב "קמפיינים" חדש בתוך cwpt (React), עם סקירה כוללת + צלילה לקמפיין בודד, כולל 4 תוספות: תגובות/engagement, השוואת קמפיינים, עלות משוערת, גרף מגמה.
2. **העלאת מדיה בקמפיין** — כפתור "העלה קובץ" בטופס הקמפיין של Chatwoot, שמארח את הקובץ ב-URL ציבורי ומזרים אותו ל-`media_url` — בדיוק כמו ברצפים.

**יעד פריסה:** שני השרתים — admon (כבר מריץ cwpt) מיד; achiya (מריץ `drip-engine` ישן) אחרי שדרוג המנוע.

---

## 3. ארכיטקטורה כללית

```
┌─ Chatwoot dashboard ───────────────────────────────────────────┐
│                                                                │
│  טופס קמפיין (Vue, נייטיבי)                                     │
│    └─ campaign-modal.js  ──[כפתור "העלה קובץ"]──┐               │
│                                                 │ POST /media  │
│  טאב "קמפיינים" (iframe → cwpt webapp)          ▼               │
│    ├─ CampaignsView   ──action: campaigns──┐   cwpt-engine     │
│    └─ CampaignDetail  ──action: campaign_detail─┤  (Node)       │
│                                             ▼   │               │
│                                    reads מ-Postgres (least-priv)│
│                                     public.campaigns            │
│                                     public.messages (@> campaign_id)
│                                     public.labels/taggings      │
└────────────────────────────────────────────────────────────────┘
         ▲
         │ הרישום שמזין הכל:
   whatsapp_campaign_conversations.rb (Ruby initializer — כבר פרוס)
```

**3 נגיעות קוד ב-cwpt + תלות אחת חיצונית:**

- **A. Webapp** (`modules/sequences/webapp/`) — טאב + תצוגות חדשות (React, קורא מה-engine).
- **B. Engine** (`modules/sequences/engine/`) — 2 actions חדשים + קובץ reads + grants ב-`lib/db.sh`.
- **C. Media button** (`modules/dashboard-enhancements/parts/campaign-modal.js`) — כפתור העלאה.
- **D. תלות:** ה-Ruby initializer שמייצר את הרישום. אצל המשתמש כבר פרוס; להכללה ב-repo הציבורי — מודול `campaign-tracking` חדש (שלב 2, ראה §11).

> **ponytail:** הדשבורד נכנס לתוך ה-webapp הקיים ומשתמש מחדש בכל רכיבי ה-UI (Table/Badge/Card/Skeleton), ה-i18n, וה-auth gate. אין webapp/service/DB-schema חדשים. הרישום, המדיה ורוב ה-analytics — קוד קיים שמורחב, לא נכתב מאפס.

---

## 4. רכיבים מפורטים

### A. הדשבורד (React)

טאב רביעי `campaigns` ב-`App.jsx` (ליד overview/sequences/contacts). מבנה: `view === 'campaigns'` → `<CampaignsView>`; בחירת קמפיין → `<CampaignDetailView campaignId>` (תצוגה, לא מודאל — מרחב לטבלת נמענים ו-funnel).

**רמה 1 — `CampaignsView` (סקירת כל הקמפיינים):**
- **כרטיסי KPI:** מספר קמפיינים · סה״כ נשלחו · % נמסרו · % נקראו · % נכשלו (אגרגציה על כל הקמפיינים). שימוש חוזר בסגנון הכרטיסים של `OverviewView`.
- **טבלת קמפיינים:** שם, סטטוס (פעיל/הסתיים/בעיבוד), תאריך, קהל (labels), נשלחו/נמסרו/נקראו/נכשלו, אחוז קריאה. חיפוש + מיון client-side (כמו הדשבורד הישן).
- **גרף מגמה** [תוספת]: הודעות קמפיין נשלחו/נמסרו/נקראו לאורך זמן — שימוש חוזר בקומפוננטת ה-trend של `OverviewView` (`DeliveryCard` trend bars).
- **השוואת קמפיינים** [תוספת]: דירוג הקמפיינים לפי אחוז קריאה/מסירה (טבלה ממוינת או bar-list) — לזהות מה עובד.

**רמה 2 — `CampaignDetailView` (קמפיין בודד):**
- **Funnel:** קהל → נשלח → נמסר → נקרא, עם אחוזי המרה בין השלבים.
- **סיבות כשל בעברית:** מיפוי error codes של Meta (מספר לא תקין / נחסם / ביטל הסכמה / תקרת שיווק / אחר) — שימוש חוזר במילון `reason*` שכבר קיים ב-`OverviewView`.
- **תגובות/engagement** [תוספת]: כמה נמענים פתחו שיחה בחזרה (incoming אחרי ה-outgoing של הקמפיין) + שיעור תגובה מתוך שנמסרו.
- **עלות משוערת** [תוספת]: לפי קטגוריית התבנית × מספר שנשלחו (ראה §6).
- **טבלת נמענים:** שם, טלפון, סטטוס אישי (נשלח/נמסר/נקרא/נכשל + סיבה), זמן. כולל **"לא נשלח"** — מי בקהל היעד שלא קיבל כלל.
- **פרטי תבנית** + תצוגה מקדימה של גוף ההודעה.
- **ייצוא CSV** client-side (BOM + RTL), כמו הדשבורד הישן.

**API (webapp → engine)** ב-`webapp/src/api/sequencesApi.js`:
- `listCampaigns(accountId)` → action `campaigns`
- `getCampaignDetail(campaignId, accountId)` → action `campaign_detail`

**i18n:** מילון co-located he/en בכל תצוגה, כמו הדפוס הקיים.

### B. Engine — reads + actions + grants

**קובץ חדש `engine/src/campaigns.js`** — פונקציות קריאה טהורות (בסגנון `reads.js`, לא RPC — אין state ב-schema `drip`, הכל reads מ-`public`):

- `listCampaigns(accountId)` — מ-`public.campaigns` (title, campaign_type, campaign_status, audience, template_params, scheduled_at, created_at, inbox_id) `WHERE account_id=$1 AND inbox → Whatsapp`, עם אגרגציית סטטוסים per-campaign בשאילתה אחת (JOIN ל-`messages` דרך containment).
- `getCampaignDetail(campaignId, accountId)` — פרטי הקמפיין + טבלת נמענים (JOIN `messages`→`conversations`→`contacts`), funnel counts, engagement (incoming-since), ו-audience→"לא נשלח".

**מקור אגרגציית סטטוס (מדויק, לא LIKE):**
```sql
SELECT (content_attributes->>'campaign_id')::int AS campaign_id,
       count(*)                                        AS sent,
       count(*) FILTER (WHERE status IN (1,2))         AS delivered,  -- delivered+read
       count(*) FILTER (WHERE status = 2)              AS read,
       count(*) FILTER (WHERE status = 3)              AS failed
FROM public.messages
WHERE account_id = $1
  AND content_attributes ? 'campaign_id'   -- קיים מפתח campaign_id (top-level, שהפאץ' כותב)
GROUP BY 1;
```
> הערה: הסינון המדויק לקמפיין ספציפי (drill-down) = `content_attributes @> jsonb_build_object('campaign_id', $2::int)` — containment מדויק, לא תופס id-חלקי. enum הסטטוס: `sent:0, delivered:1, read:2, failed:3`.

**engagement:** לכל conversation עם הודעת קמפיין — האם קיים `messages.message_type=0` (incoming) עם `created_at` אחרי ה-outgoing. שימוש חוזר בדפוס `reads.incomingSince`.

**"לא נשלח":** `campaigns.audience` (`[{type:'Label', id}]`) → `public.labels.title` → `public.tags.name` (acts-as-taggable) → `public.taggings` (taggable_type='Contact', context='labels') → contacts. פחות contacts שקיבלו הודעת קמפיין. ⚠️ קירוב: התיוג עשוי להשתנות אחרי שליחת הקמפיין — לתעד ב-UI כ"קהל נוכחי".

**Actions ב-`engine/src/api.js`** (או `store.js` handleAction, לפי הדפוס):
- `campaigns` → `data = await listCampaigns(accountId)`
- `campaign_detail` → `data = await getCampaignDetail(payload.campaign_id, accountId)`

**Grants חדשים ב-`lib/db.sh`** (idempotent — re-run של install.sh מספיק):
```sql
GRANT SELECT ON public.campaigns, public.labels, public.tags, public.taggings TO drip_engine;
```
(`messages`, `contacts`, `conversations` — כבר מוענקים.)

### C. כפתור העלאת מדיה — `campaign-modal.js`

הרחבה של ה-IIFE הקיים. לאחר שהמשתמש בוחר תבנית עם header מדיה, Chatwoot מרנדר `<Input type="url" media_url>` (עם placeholder ידוע). מזריקים לידו כפתור "📎 העלה קובץ":
1. `<input type="file">` נסתר, מסונן לפי סוג ה-header (accept image/* | video/* | .pdf…).
2. בבחירה → `POST ${window.__CW_ADDONS_BASE}/drip-api/media?account_id=N&format=IMAGE|VIDEO|DOCUMENT&locale=` (endpoint קיים; validation קיים ב-`media.js`; מוגש same-origin עם cookie ל-auth gate).
3. בהצלחה → `setNativeValue(mediaUrlInput, data.url)` (דפוס קיים ב-campaign-modal.js) → Vue קולט את ה-URL הציבורי → השליחה עובדת.
4. בזמן העלאה: spinner; בכישלון: הודעת שגיאה דו-לשונית מה-engine.

זיהוי סוג ה-header: מהתבנית הנבחרת (כבר נקראת ל-preview card). מגבלות: תמונה 5MB / וידאו 16MB / מסמך 100MB (נאכף server-side).

> **ponytail:** אפס backend חדש — endpoint ההעלאה, ה-validation, ה-volume וטבלת `drip.media` כבר קיימים מהרצפים. זו נגיעת frontend בלבד באותו קובץ injection.

### D. תלות הרישום (`whatsapp_campaign_conversations`)

הדשבורד ריק בלי ה-initializer שמייצר `messages.content_attributes.campaign_id`. **אצל המשתמש (admon + achiya) הוא כבר פרוס — אין מה לעשות לצורך הפריסה הזו.** להכללה ב-repo הציבורי: §11.

---

## 5. מודל נתונים ומקורות (סיכום)

| נתון | מקור | הערה |
|---|---|---|
| רשימת קמפיינים | `public.campaigns` | סינון ל-inbox מסוג Whatsapp |
| סטטוס שליחה | `public.messages.status` (0/1/2/3) | מתעדכן מ-webhook Meta |
| קישור הודעה→קמפיין | `messages.content_attributes.campaign_id` | `@>` jsonb, **לא** LIKE; **לא** `conversations.campaign_id` |
| שגיאת מסירה | `messages.content_attributes` (error) | מיפוי לעברית |
| קהל | `campaigns.audience` → labels → taggings | קירוב "קהל נוכחי" |
| engagement | incoming `messages` אחרי outgoing | דפוס `incomingSince` |
| תבנית | `campaigns.template_params` | name/language/category |

---

## 6. עלות משוערת

WhatsApp עבר (2025) לתמחור per-message לפי קטגוריה. חישוב: `מספר שנשלח × מחיר-לפי-קטגוריה(ILS)`.

- **טבלת מחירים קבועה בקוד** (ILS, מדינה=ישראל, לפי MARKETING/UTILITY/AUTHENTICATION), עם קבוע אחד לעדכון ידני. **לא** API חיצוני (over-engineering; המחירים משתנים לאט).
- תצוגה עם disclaimer מפורש: "אומדן — לפי תעריפי Meta לישראל, לא כולל הנחות/חלון חינם".
- המספרים המדויקים יימשכו לפני מימוש (מקור: תיעוד תמחור Meta 2025 / זיכרון פרויקט).

> **ponytail:** קבוע מחירים במקום אינטגרציית billing. חלון ה-24ש׳ החינמי (CTWA) וכפל-הנחות לא מחושבים — מסומן כאומדן.

---

## 7. פריסה

1. **admon** (מריץ cwpt) — `install.sh --modules=...` re-run מחיל grants חדשים + engine image חדש + webapp build; הזרקת campaign-modal מעודכנת. הדשבורד ה-Ruby הישן (`campaign_report_dashboard`) יוסר לאחר אימות שהחדש חי.
2. **achiya** (מריץ `drip-engine` ישן) — דורש **שדרוג המנוע ל-cwpt** (build + deploy מה-repo הנוכחי). זהו תת-פרויקט: הקוד תואם (drip-engine = השם הישן של אותו codebase); צריך אימות התאמת compose/route/volume. **הדאטה האמיתי (4 קמפיינים) כאן** — בדיקות ה-UI יתבצעו על achiya.

---

## 8. אבטחה

- **Least-privilege נשמר:** רק `SELECT` נוסף על 4 טבלאות ציבוריות לקריאה. אין הרשאת כתיבה חדשה.
- **Auth gate:** ה-actions החדשים עוברים דרך `authGate` הקיים (session cookie מול `/api/v1/profile`) — טבלת הנמענים חושפת טלפונים, בדיוק כמו `enrollments`.
- **Tenant isolation:** `account_id` תמיד מה-query string; super-admin (master account) רואה הכל, שאר המשתמשים מוגבלים לחשבונם — דפוס קיים.
- **מדיה:** endpoint ההעלאה כבר auth-gated; `/media` הציבורי מגיש קבצים סטטיים בלבד (Meta מושך). ולידציה server-side.

---

## 9. בדיקות

- **Engine:** `node --test` על `campaigns.js` — אגרגציית סטטוס (containment מדויק, לא תופס id-חלקי), funnel, engagement, audience→"לא נשלח". מול Postgres חד-פעמי עם stand-in tables (כמו ה-CI scaffold הקיים; להוסיף `campaigns`,`labels`,`tags`,`taggings`).
- **Webapp:** `node --test` על מיפויי ה-API + פונקציות עזר (summarize/format).
- **Media:** בדיקת ה-validation כבר קיימת (`media_validate.test.js`); להוסיף בדיקת חוט העלאה→setNativeValue אם בר-בדיקה.
- **בדיקת קצה ידנית:** על achiya (דאטה אמיתי) — קמפיין עם/בלי מדיה, נמענים בסטטוסים שונים, קמפיין עם id שהוא תת-מחרוזת של אחר (למשל 1 מול 16) לוודא שאין דליפת LIKE.

---

## 10. סיכונים ושאלות פתוחות

1. **קירוב "קהל"** — audience נשמר כ-label refs; התיוג עשוי להשתנות. מוצג כ"קהל נוכחי".
2. **אין timestamp per-status** — Chatwoot שומר רק `status` נוכחי. גרף המגמה מבוסס `created_at` של ההודעה, לא זמן המסירה בפועל. funnel-over-time אמיתי ידרוש רישום נוסף (מחוץ להיקף).
3. **שדרוג achiya** — מ-drip-engine ל-cwpt: תת-פרויקט עם סיכון תאימות compose/route. לתכנן בנפרד.
4. **מחירי עלות** — למשוך מספרים מעודכנים לפני מימוש; לתעד מקור.
5. **אינדקס** — `content_attributes @>` בלי אינדקס GIN. לנפחים הנוכחיים (עשרות קמפיינים) זניח; אינדקס GIN הוא שיפור עתידי אם צריך.

---

## 11. היקף מפורש

**כלול:**
- טאב קמפיינים React (2 רמות) + 4 התוספות.
- 2 actions + `campaigns.js` + grants ב-engine.
- כפתור העלאת מדיה ב-campaign-modal.js.
- פריסה ל-admon; תכנון שדרוג achiya.
- החלפת הדשבורד ה-Ruby הישן על admon.

**מחוץ להיקף (מתועד, לא נבנה עכשיו):**
- **מודול `campaign-tracking`** (הכללת ה-Ruby initializer ב-repo הציבורי) — שלב 2. אצל המשתמש ה-patch כבר פרוס; זה נחוץ רק כדי שכל מי שמתקין cwpt יקבל דשבורד עובד. דורש ביקורת נקיון/אבטחה של ה-patch לפרסום.
- Funnel-over-time אמיתי (רישום status transitions).
- אינטגרציית billing חיה / אינדקס GIN.
- שדרוג achiya עצמו — תת-פרויקט נפרד (המפרט מניח אותו כתלות).

> **ponytail — הסולם:** רוב הבקשה = חלקי-פאזל קיימים שמורכבים מחדש (analytics, media, delivery-tracking, tabs — כולם קיימים ברצפים). הקוד החדש היחיד: 2 reads ב-engine, טאב React, וכפתור. אלמלא בקשת "היקף מלא" מפורשת, הליבה לבדה (רמות 1+2 בלי 4 התוספות) הייתה ה-MVP.
