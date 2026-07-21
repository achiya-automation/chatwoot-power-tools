/*
 * בדיקת עשן על ה-ARTIFACT — לא על קבצי המקור.
 *
 * למה זה קיים: campaignStats.injector.test.js קורא את קובץ המקור ישירות (readFile), ולכן הוא
 * עיוור לכל מה שקורה *אחרי* המקור — הרכבה (assemble_dashboard_script) ו-escaping. בפרוד נשברו
 * שני פיצ'רים בבת אחת בלי שאף בדיקה תצפצף:
 *   1. import-button.js הכריז `function t(k)` (i18n) בקובץ שכבר השתמש ב-`var t` כמזהה טיימר.
 *      ה-MutationObserver דרס את t במספר → t('smartImport') זרק TypeError → נבלע ב-catch של
 *      inject() → הכפתור פשוט לא הופיע. לקובץ הזה לא הייתה בדיקה בכלל.
 *   2. הסלקטור '.group\\/cardLayout' איבד backslash כשהערך נכתב מחדש ל-InstallationConfig דרך
 *      מחרוזת Ruby ('\\' → '\') → '.group/cardLayout' → SyntaxError ב-renderCards() → tick()
 *      מת לפני renderHeader()/renderKpiBar() → כל דשבורד הקמפיינים נעלם.
 *
 * הבדיקה מרכיבה את ה-DASHBOARD_SCRIPTS האמיתי דרך lib/assemble-dashboard-script.sh, מריצה אותו
 * ב-jsdom על שלד DOM בצורת Chatwoot, ודורשת שהכפתורים באמת ייווצרו. כל שגיאה שנזרקת בתוך
 * ה-IIFE נאספת (window error) ומכשילה — כישלון שקט הוא בדיוק מה שהחמצנו.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

// ה-artifact שבאמת נכתב ל-InstallationConfig — אותה פונקציה שה-installer מריץ.
function assembleDashboardScript(base = '/drip') {
  return execFileSync(
    'bash',
    ['-c', `source lib/assemble-dashboard-script.sh && assemble_dashboard_script "${base}" import sequences enhancements`],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
}

// גופי ה-<script> מתוך ה-HTML המורכב, לפי הסדר — בדיוק מה שהדפדפן מריץ.
function scriptBodies(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

// ⚠️ ה-DOM ההתחלתי מכיל #app *בלי* dir — בדיוק כמו Chatwoot ברגע שבו DASHBOARD_SCRIPTS רץ.
// Vue טרם רינדר, ולכן #app[dir]="rtl" עוד לא קיים. renderPage() הוא זה שיוצר אותו, בדיוק כמו
// שקורה בדפדפן (Chatwoot מרנדר #app פנימי, עם dir, בתוך ה-#app שהוא נקודת ההרכבה של Vue).
// fixture שמגדיר dir מראש מחביא באג אמיתי: כל תרגום שמחושב בזמן טעינה ננעל על אנגלית.
// this bundle includes the sequences module, whose templates-nav.js runs a self-healing
// setInterval (highlight sync) — a real timer that outlives the test unless the window is
// closed explicitly. jsdom does not tear this down on its own (unlike a real browser tab
// closing); window.close() is jsdom's own documented way to stop pending timers.
const OPEN_WINDOWS = [];
after(() => {
  for (const w of OPEN_WINDOWS) { try { w.close(); } catch (e) {} }
});

function makeDom(path) {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: `https://chatwoot.test${path}`,
    runScripts: 'outside-only',
  });
  OPEN_WINDOWS.push(dom.window);
  const errors = [];
  dom.window.addEventListener('error', (e) => errors.push(e.message));
  // campaign-stats מושך סטטיסטיקות; import-button לא נוגע ברשת עד שלוחצים.
  dom.window.fetch = async (_url, opts) => {
    const action = JSON.parse((opts && opts.body) || '{}').action;
    const data = action === 'campaigns_tier'
      ? null
      : [{ id: 7, title: 'מבצע קיץ', sent: 10, delivered: 8, read: 5, failed: 2 }];
    return { ok: true, json: async () => ({ data }) };
  };
  return { dom, errors };
}

// רצף האתחול האמיתי של Chatwoot, על שלושת שלביו — כל שלב חשף באג אחר:
//   1. DASHBOARD_SCRIPTS רץ (בתחתית <body>). ה-DOM כמעט ריק; אין עדיין #app[dir].
//   2. Vue מרנדר את העמוד — העוגנים מופיעים. הממשק עדיין נראה LTR.
//   3. פרטי החשבון נטענים ורק אז dir הופך ל-"rtl".
// מי שמצלם את השפה בשלב 1 (או בשלב 2, ביצירת הכפתור) — ננעל על אנגלית לנצח.
async function runDashboardScript(dom, renderPage) {
  const w = dom.window;
  for (const body of scriptBodies(assembleDashboardScript())) w.eval(body);
  await new Promise((r) => setTimeout(r, 50));

  renderPage(w.document);                       // שלב 2 — עדיין בלי dir
  await new Promise((r) => setTimeout(r, 900)); // הכפתורים נוצרים כאן, בעוד הממשק "אנגלי"

  w.document.querySelector('#app').setAttribute('dir', 'rtl'); // שלב 3 — החשבון נטען
  await new Promise((r) => setTimeout(r, 600));
  return w;
}

// שלב 2: Vue מרנדר את תוכן העמוד. עדיין בלי dir — הוא מגיע רק בשלב 3, אחרי טעינת החשבון.
// (בדפדפן האמיתי Chatwoot מקנן #app פנימי עם ה-dir בתוך נקודת ההרכבה של Vue; jsdom לא מתאים
//  סלקטור מורכב כמו '#app[dir]' כששני אלמנטים חולקים id, אז כאן מדובר ב-#app יחיד. התזמון —
//  מה שנבדק — זהה.)
function mountVueRoot(doc, innerHtml) {
  doc.querySelector('#app').innerHTML = innerHtml;
}

test('artifact: כפתור "ייבוא חכם" נוצר בעמוד אנשי הקשר אחרי שה-DOM משתנה', async () => {
  const { dom, errors } = makeDom('/app/accounts/1/contacts');
  const w = await runDashboardScript(dom, (doc) =>
    mountVueRoot(doc, '<div><button id="toggleContactsFilterButton">סינון</button></div>')
  );

  const btn = w.document.getElementById('cwi-open-btn');
  assert.ok(btn, 'כפתור הייבוא חייב להופיע — היעדרו הוא הבאג של התנגשות t/setTimeout');
  assert.match(
    btn.textContent,
    /ייבוא חכם/,
    'הכפתור חייב להיות בעברית: הממשק RTL. תווית באנגלית = השפה חושבה בזמן טעינה, לפני ש-Vue רינדר'
  );
  assert.deepEqual(errors, [], 'אסור שתיזרק שגיאה מתוך סקריפט הדשבורד');
});

test('artifact: דשבורד הקמפיינים מזריק KPI + כפתור סטטיסטיקה + שורת סטטיסטיקה על הכרטיס', async () => {
  const { dom, errors } = makeDom('/app/accounts/1/campaigns/whatsapp');
  const w = await runDashboardScript(dom, (doc) =>
    mountVueRoot(doc, `
      <div class="h-20 justify-between"><span>קמפיינים</span><div><button>+ קמפיין חדש</button></div></div>
      <main><div class="max-w-5xl">
        <div class="group/cardLayout"><div><span class="text-base font-medium capitalize">מבצע קיץ</span></div></div>
      </div></main>`)
  );

  const doc = w.document;
  const overview = doc.getElementById('cwpt-overview-btn');
  assert.ok(overview, 'כפתור "סטטיסטיקה" חייב להופיע בכותרת');
  assert.match(overview.textContent, /סטטיסטיקה/, 'גם הוא חייב להיות בעברית בממשק RTL');
  assert.ok(doc.querySelector('.cwpt-stats'), 'שורת הסטטיסטיקה חייבת לנחות על כרטיס הקמפיין');
  assert.match(doc.querySelector('main .max-w-5xl').textContent, /10/, 'סרגל ה-KPI חייב להציג את הסך');
  assert.deepEqual(errors, [], 'אסור שתיזרק שגיאה מתוך סקריפט הדשבורד');
});

test('artifact: אין backslash כפול בשום מקום — הוא לא שורד כתיבה חוזרת ל-InstallationConfig', () => {
  // מחרוזת Ruby בגרשיים בודדים מקפלת '\\' ל-'\'. כל '\\' ב-artifact הוא מוקש: אחרי כתיבה
  // חוזרת של הערך (ניקוי ידני, כלי אחר) הוא הופך ל-'\' והסלקטור/הביטוי נשבר בשקט.
  // סלקטורים עם תו מיוחד נכתבים כ-[class~="..."] — שלא דורש escaping בכלל.
  const html = assembleDashboardScript();
  const offenders = html
    .split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => line.includes('\\\\'));

  assert.deepEqual(
    offenders,
    [],
    `backslash כפול ב-artifact — לא ישרוד כתיבה חוזרת ל-DB:\n${offenders.map(([n, l]) => `  ${n}: ${l.trim()}`).join('\n')}`
  );
});
