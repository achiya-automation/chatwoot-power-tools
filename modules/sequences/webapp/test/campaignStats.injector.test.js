/*
 * campaign-stats injector — בדיקת DOM אמיתית (jsdom) לקוד הכי מצומד ל-Chatwoot:
 * הסלקטורים של כרטיסי הקמפיין, ההזרקה ה-idempotent, וההתנהגות בכפילות כותרות.
 * ה-fixture משחזר את השלד המינימלי של עמוד הקמפיינים (v4.15.x): .group/cardLayout,
 * span כותרת .text-base.font-medium.capitalize, ו-main > .max-w-5xl.
 * אם Chatwoot ישנה את המבנה — הבדיקה הזו היא המקום לעדכן את ה-fixture ואת הסלקטורים יחד.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const SRC_URL = new URL('../../../dashboard-enhancements/parts/campaign-stats.js', import.meta.url);
const WINDOWS = [];
after(() => WINDOWS.forEach((window) => window.close()));

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
  WINDOWS.push(w);
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
  assert.equal(
    bar.querySelector('[data-cwpt-report]'),
    null,
    'the duplicate full-report action stays removed because Chatwoot 4.17 owns the drill-down'
  );
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
  assert.ok(bar.classList.contains('flex'), 'KPI summary should be one compact flex strip');
  assert.ok(!bar.classList.contains('grid'), 'the old multi-row card grid must not return');
  assert.ok(bar.classList.contains('py-1.5'), 'compact strip should use shallow vertical padding');
  assert.equal(bar.children.length, 5, 'one inline metric per aggregate KPI');
  assert.equal(bar.children[0].style.flex, '1 1 108px');
  assert.equal(bar.children[0].querySelector('.text-sm').textContent, '2');
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

test('injector: reused cards lose stale statistics when their title no longer matches', async () => {
  const dom = pageDom(['Old campaign']);
  const w = await runInjector(dom, [{ id: 3, title: 'Old campaign', sent: 9, delivered: 1, read: 1, failed: 0 }]);
  w.document.querySelector('.capitalize').textContent = 'New campaign';
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.equal(w.document.querySelector('.cwpt-stats'), null);
});

test('injector: switching accounts clears cached cards and discards late responses', async () => {
  const dom = pageDom(['Shared title']);
  const w = dom.window;
  WINDOWS.push(w);
  const pending = new Map();
  w.fetch = (url, options) => {
    if (JSON.parse(options.body).action === 'campaigns_tier') return Promise.resolve({ ok: true, json: async () => ({ data: null }) });
    return new Promise((resolve) => pending.set(new URL(url, w.location.href).searchParams.get('account_id'), resolve));
  };
  w.eval(await readFile(SRC_URL, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 600));
  w.history.pushState({}, '', '/app/accounts/2/campaigns/whatsapp');
  w.document.body.appendChild(w.document.createElement('div'));
  await new Promise((resolve) => setTimeout(resolve, 220));
  pending.get('2')({ ok: true, json: async () => ({ data: [{ id: 2, title: 'Shared title', sent: 22, delivered: 0, read: 0, failed: 0 }] }) });
  await new Promise((resolve) => setTimeout(resolve, 220));
  pending.get('1')({ ok: true, json: async () => ({ data: [{ id: 1, title: 'Shared title', sent: 99, delivered: 0, read: 0, failed: 0 }] }) });
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.match(w.document.querySelector('.cwpt-stats').textContent, /22/);
  assert.doesNotMatch(w.document.querySelector('.cwpt-stats').textContent, /99/);
});

test('injector: RTL message content does not override an English application locale', async () => {
  const dom = pageDom(['Campaign']);
  dom.window.document.querySelector('#app').dir = 'ltr';
  const content = dom.window.document.createElement('div');
  content.dir = 'rtl';
  dom.window.document.body.appendChild(content);
  const w = await runInjector(dom, [{ id: 1, title: 'Campaign', sent: 2, delivered: 1, read: 0, failed: 0 }]);
  assert.match(w.document.querySelector('.cwpt-stats').textContent, /Sent/);
});

test('injector: a previous visit cannot replace the current daily budget after A to B to A navigation', async () => {
  const dom = pageDom(['Campaign']);
  const w = dom.window;
  WINDOWS.push(w);
  const tiers = [];
  w.fetch = (url, options) => {
    if (JSON.parse(options.body).action === 'campaigns_tier') {
      return new Promise((resolve) => tiers.push({ url, resolve }));
    }
    return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 1, title: 'Campaign', sent: 1, delivered: 0, read: 0, failed: 0 }] }) });
  };
  w.eval(await readFile(SRC_URL, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 600));
  for (const account of ['2', '1']) {
    w.history.pushState({}, '', `/app/accounts/${account}/campaigns/whatsapp`);
    w.document.body.appendChild(w.document.createElement('div'));
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  const accountTiers = tiers.filter(({ url }) => url.includes('account_id=1'));
  assert.equal(accountTiers.length, 2);
  accountTiers[1].resolve({ ok: true, json: async () => ({ data: { remaining: 222, unlimited: false } }) });
  await new Promise((resolve) => setTimeout(resolve, 30));
  accountTiers[0].resolve({ ok: true, json: async () => ({ data: { remaining: 999, unlimited: false } }) });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.match(w.document.getElementById('cwpt-kpi-bar').textContent, /222/);
  assert.doesNotMatch(w.document.getElementById('cwpt-kpi-bar').textContent, /999/);
});
