/*
 * templates-nav injector — בדיקת DOM אמיתית (jsdom), אותו הדפוס בדיוק כמו
 * dashboardScript.injector.test.js: מרכיבים את ה-DASHBOARD_SCRIPTS האמיתי דרך
 * lib/assemble-dashboard-script.sh (לא קוראים את קובץ המקור ישירות), מריצים אותו ב-jsdom
 * על שלד DOM בצורת Chatwoot בשלושת השלבים (סקריפט → Vue בלי dir → dir=rtl אחרי טעינת חשבון),
 * ודורשים שהכניסה תופיע/תיעדר בפועל לפי תפקיד המשתמש — בדיוק כמו admin gating אמיתי.
 *
 * הכניסה תלויה ב-#drip-nav-item (נבנה על ידי sequences-nav.js), אז ה-fixture כולל גם את
 * ה-div[name="Campaigns"] המינימלי ש-sequences-nav.js's inject() דורש כדי ליצור אותו.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

// רק המודול sequences — templates-nav.js תלוי ב-window.__dripShowPanel שחושף sequences-nav.js,
// ואין תלות ברשת/DOM של import/enhancements (הבדיקה הקיימת ב-dashboardScript.injector.test.js
// כבר מכסה את אלה, ואת ה-backslash-guard על כל המודולים יחד).
function assembleDashboardScript(base = '/drip') {
  return execFileSync(
    'bash',
    ['-c', `source lib/assemble-dashboard-script.sh && assemble_dashboard_script "${base}" sequences`],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
}

function scriptBodies(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

// #app בלי dir — בדיוק כמו Chatwoot ברגע שבו DASHBOARD_SCRIPTS רץ (ראה dashboardScript.injector
// לפירוט המלא של הלקח). cw_d_session_info מדמה session אמיתי לצורך authHeaders().
function makeDom(path) {
  const cookie = encodeURIComponent(JSON.stringify({
    'access-token': 'tok123', 'token-type': 'Bearer', client: 'c1', expiry: '999', uid: 'u1',
  }));
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: `https://chatwoot.test${path}`,
    runScripts: 'outside-only',
  });
  dom.window.document.cookie = `cw_d_session_info=${cookie}`;
  const errors = [];
  dom.window.addEventListener('error', (e) => errors.push(e.message));
  return { dom, errors };
}

// profile mock — role-בקרה: fetch('/api/v1/profile') הוא הקריאה היחידה מתוך templates-nav.js
// (sequences-nav.js עצמו לא נוגע ברשת בכלל).
function withProfileFetch(dom, accounts) {
  dom.window.fetch = async (url) => {
    if (String(url).indexOf('/api/v1/profile') !== -1) {
      return { ok: true, json: async () => ({ accounts }) };
    }
    return { ok: false, json: async () => ({}) };
  };
}

// שלד מינימלי: <li><div name="Campaigns">…</div></li> בתוך <ul> — כל מה ש-sequences-nav.js's
// inject() צריך כדי ליצור #drip-nav-item, שממנו templates-nav.js תולה את הפריט שלו כ-sibling.
function mountSidebar(doc) {
  doc.querySelector('#app').innerHTML =
    '<ul><li><div name="Campaigns">קמפיינים</div></li></ul>';
}

async function runDashboardScript(dom) {
  const w = dom.window;
  for (const body of scriptBodies(assembleDashboardScript())) w.eval(body);
  await new Promise((r) => setTimeout(r, 50));

  mountSidebar(w.document);                      // שלב 2 — עדיין בלי dir
  await new Promise((r) => setTimeout(r, 900));  // תג ה-admin נבדק כאן, בעוד הממשק "אנגלי"

  w.document.querySelector('#app').setAttribute('dir', 'rtl'); // שלב 3 — החשבון נטען
  await new Promise((r) => setTimeout(r, 600));
  return w;
}

test('templates-nav: admin — li#tpl-nav-item עם תווית אנגלית לפני dir=rtl, עברית אחריו', async () => {
  const { dom, errors } = makeDom('/app/accounts/1/contacts');
  withProfileFetch(dom, [{ id: 1, role: 'administrator' }]);

  const w = dom.window;
  for (const body of scriptBodies(assembleDashboardScript())) w.eval(body);
  await new Promise((r) => setTimeout(r, 50));

  mountSidebar(w.document);
  await new Promise((r) => setTimeout(r, 900));

  const preFlip = w.document.getElementById('tpl-nav-item');
  assert.ok(preFlip, 'הפריט חייב להופיע למנהל עוד לפני dir=rtl');
  assert.match(preFlip.textContent, /WhatsApp Templates/, 'לפני dir=rtl הממשק עדיין "אנגלי" — תווית אנגלית');

  w.document.querySelector('#app').setAttribute('dir', 'rtl');
  await new Promise((r) => setTimeout(r, 600));

  const postFlip = w.document.getElementById('tpl-nav-item');
  assert.ok(postFlip, 'הפריט חייב להישאר אחרי dir=rtl');
  assert.match(postFlip.textContent, /תבניות WhatsApp/, 'אחרי dir=rtl התווית חייבת להתעדכן לעברית');
  assert.deepEqual(errors, [], 'אסור שתיזרק שגיאה מתוך סקריפט הדשבורד');
});

test('templates-nav: agent — אין li#tpl-nav-item (fail-closed)', async () => {
  const { dom, errors } = makeDom('/app/accounts/1/contacts');
  withProfileFetch(dom, [{ id: 1, role: 'agent' }]);

  const w = await runDashboardScript(dom);
  assert.equal(w.document.getElementById('tpl-nav-item'), null, 'סוכן (לא-מנהל) לא אמור לראות את הכניסה');
  assert.deepEqual(errors, [], 'אסור שתיזרק שגיאה מתוך סקריפט הדשבורד');
});

test('templates-nav: profile fetch נכשל — fail-closed, אין li', async () => {
  const { dom, errors } = makeDom('/app/accounts/1/contacts');
  dom.window.fetch = async () => ({ ok: false, json: async () => ({}) });

  const w = await runDashboardScript(dom);
  assert.equal(w.document.getElementById('tpl-nav-item'), null, 'שגיאת רשת/auth → ללא כניסה, לא ברירת מחדל פתוחה');
  assert.deepEqual(errors, [], 'אסור שתיזרק שגיאה מתוך סקריפט הדשבורד');
});

test('templates-nav: קליק שולח window.__dripShowPanel עם "templates"', async () => {
  const { dom } = makeDom('/app/accounts/1/contacts');
  withProfileFetch(dom, [{ id: 1, role: 'administrator' }]);

  const w = await runDashboardScript(dom);
  const li = w.document.getElementById('tpl-nav-item');
  assert.ok(li, 'הכניסה חייבת להיות קיימת לפני שבודקים קליק');

  let called = null;
  w.__dripShowPanel = (tab) => { called = tab; }; // stub — דורס את הפונקציה האמיתית של sequences-nav.js

  const a = li.querySelector('a');
  a.dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
  assert.equal(called, 'templates', 'קליק על הפריט חייב לקרוא ל-__dripShowPanel עם \'templates\'');
});

test('artifact (sequences module): אין backslash כפול — templates-nav.js בטווח הבדיקה', () => {
  // אותו guard בדיוק כמו dashboardScript.injector.test.js, מצומצם למודול sequences —
  // מוודא שהקובץ החדש (שנרשם עכשיו תחת sequences) לא מכניס \\ שלא ישרוד כתיבה חוזרת ל-DB.
  const html = assembleDashboardScript();
  assert.match(html, /templates-nav\.js/, 'templates-nav.js חייב להיכלל ב-artifact המורכב של המודול sequences');
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
