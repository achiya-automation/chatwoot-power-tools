/*
 * campaign-stats injector — בדיקת DOM אמיתית (jsdom) לקוד הכי מצומד ל-Chatwoot:
 * הסלקטורים של כרטיסי הקמפיין, ההזרקה ה-idempotent, וההתנהגות בכפילות כותרות.
 * ה-fixture משחזר את השלד המינימלי של עמוד הקמפיינים (v4.15.x): .group/cardLayout,
 * span כותרת .text-base.font-medium.capitalize, ו-main > .max-w-5xl.
 * אם Chatwoot ישנה את המבנה — הבדיקה הזו היא המקום לעדכן את ה-fixture ואת הסלקטורים יחד.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const SRC_URL = new URL('../../../dashboard-enhancements/parts/campaign-stats.js', import.meta.url);

function pageDom(cards) {
  const cardHtml = cards.map((title) =>
    `<div class="group/cardLayout"><div><span class="text-base font-medium capitalize">${title}</span></div></div>`
  ).join('');
  const html = `<!doctype html><html><body>
    <div id="app" dir="rtl">
      <div class="h-20 justify-between"><div>כותרת</div><div><button>+ קמפיין חדש</button></div></div>
      <main><div class="max-w-5xl">${cardHtml}</div></main>
    </div>
  </body></html>`;
  // runScripts:'outside-only' מפעיל window.eval — כך ה-IIFE רץ עם ה-globals של החלון, כמו בדפדפן
  return new JSDOM(html, { url: 'https://chatwoot.test/app/accounts/1/campaigns/whatsapp', runScripts: 'outside-only' });
}

async function runInjector(dom, apiData, tierData = null) {
  const src = await readFile(SRC_URL, 'utf8');
  const w = dom.window;
  // שתי פעולות על אותו endpoint — מבחינים לפי גוף הבקשה (כמו ה-engine האמיתי)
  w.fetch = async (_url, opts) => {
    const action = JSON.parse((opts && opts.body) || '{}').action;
    const data = action === 'campaigns_tier' ? tierData : apiData;
    return { ok: true, json: async () => ({ data }) };
  };
  // מריצים את ה-IIFE בתוך חלון ה-jsdom — אותם globals שהדפדפן מספק ב-DASHBOARD_SCRIPTS
  w.eval(src);
  // bootstrap: setTimeout(tick, 500) ואז fetch אסינכרוני — מחכים שהשרשרת תסתיים
  await new Promise((r) => setTimeout(r, 900));
  return w;
}

test('injector: stats row lands on the matching card (matched by title)', async () => {
  const dom = pageDom(['מבצע קיץ']);
  await runInjector(dom, [{ id: 7, title: 'מבצע קיץ', sent: 3, delivered: 2, read: 1, failed: 1 }]);
  const card = dom.window.document.querySelector('.group\\/cardLayout');
  const bar = card.querySelector('.cwpt-stats');
  assert.ok(bar, 'stats row should be injected into the card');
  assert.match(bar.textContent, /3/);
  assert.ok(bar.querySelector('[data-cwpt-report="7"]'), 'full-report button carries the campaign id');
});

test('injector: KPI bar aggregates all campaigns and lands in .max-w-5xl', async () => {
  const dom = pageDom(['א', 'ב']);
  await runInjector(dom, [
    { id: 1, title: 'א', sent: 2, delivered: 1, read: 0, failed: 1 },
    { id: 2, title: 'ב', sent: 4, delivered: 4, read: 2, failed: 0 },
  ]);
  const bar = dom.window.document.getElementById('cwpt-kpi-bar');
  assert.ok(bar, 'KPI bar should exist');
  assert.match(bar.textContent, /6/); // sent total = 2+4
  assert.doesNotMatch(bar.textContent, /נותרו להיום/); // אין מידע tier → אין אריח
});

test('injector: tier preflight tile shows remaining daily budget', async () => {
  const dom = pageDom(['א']);
  await runInjector(
    dom,
    [{ id: 1, title: 'א', sent: 2, delivered: 2, read: 1, failed: 0 }],
    { cap: 1000, unlimited: false, used_24h: 40, remaining: 960 }
  );
  const bar = dom.window.document.getElementById('cwpt-kpi-bar');
  assert.match(bar.textContent, /נותרו להיום/);
  assert.match(bar.textContent, /960/);
});

test('injector: duplicate titles → NO per-card stats (ambiguous), KPI still counts both', async () => {
  const dom = pageDom(['חוזר', 'חוזר']);
  await runInjector(dom, [
    { id: 1, title: 'חוזר', sent: 5, delivered: 5, read: 5, failed: 0 },
    { id: 2, title: 'חוזר', sent: 1, delivered: 0, read: 0, failed: 1 },
  ]);
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.cwpt-stats').length, 0, 'ambiguous cards must not show (possibly wrong) stats');
  const kpi = doc.getElementById('cwpt-kpi-bar');
  assert.ok(kpi, 'KPI bar still renders');
  assert.match(kpi.textContent, /6/); // 5+1 — totals unaffected by the ambiguity
});

test('injector: unmatched DOM (selector drift) leaves the page untouched, no crash', async () => {
  const html = '<!doctype html><html><body><div id="app" dir="rtl"><main><div class="max-w-5xl"></div></main></div></body></html>';
  const dom = new JSDOM(html, { url: 'https://chatwoot.test/app/accounts/1/campaigns/whatsapp', runScripts: 'outside-only' });
  await runInjector(dom, [{ id: 1, title: 'x', sent: 1, delivered: 1, read: 0, failed: 0 }]);
  assert.equal(dom.window.document.querySelectorAll('.cwpt-stats').length, 0);
});

test('injector: idempotent across repeated ticks (one stats row, not duplicates)', async () => {
  const dom = pageDom(['יחיד']);
  const w = await runInjector(dom, [{ id: 3, title: 'יחיד', sent: 1, delivered: 1, read: 1, failed: 0 }]);
  // מוטציה שמעירה את ה-MutationObserver → tick נוסף
  w.document.body.appendChild(w.document.createElement('div'));
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(w.document.querySelectorAll('.cwpt-stats').length, 1);
});
