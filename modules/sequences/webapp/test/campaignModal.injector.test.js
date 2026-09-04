/*
 * campaign-modal injector — בדיקת שער הנתיב.
 *
 * החלק הזה רץ ב-DASHBOARD_SCRIPTS, כלומר בכל עמוד בדשבורד. ה-observer שלו מריץ ארבע
 * קריאות querySelectorAll בכל התייצבות DOM, ואחת מהן (enhanceCampaignMedia) עוטפת כל
 * `input[type="url"]` בהעלאת מדיה של WhatsApp. בעמוד שאינו קמפיינים זו גם עבודה מיותרת
 * וגם התנהגות שגויה — ולכן יש שער נתיב, בדיוק כמו ב-campaign-stats.js.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const SRC_URL = new URL('../../../dashboard-enhancements/parts/campaign-modal.js', import.meta.url);
const OPEN_WINDOWS = [];

after(() => {
  for (const window of OPEN_WINDOWS) {
    try { window.close(); } catch (error) {}
  }
});

// שדה media header של WhatsApp (placeholder עם URL + פורמט) — בעמוד קמפיינים הוא אמור
// לקבל עטיפת מדיה, ובכל עמוד אחר החלק לא אמור לגעת בו בכלל.
function pageDom(url) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="app" dir="rtl"><main><input type="url" placeholder="Enter Image URL" /></main></div></body></html>',
    { url, runScripts: 'outside-only' }
  );
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ payload: [] }) });
  OPEN_WINDOWS.push(dom.window);
  return dom;
}

async function runInjector(dom) {
  dom.window.eval(await readFile(SRC_URL, 'utf8'));
  await new Promise((resolve) => setTimeout(resolve, 700));
  return dom.window;
}

test('on the campaigns page the media enhancer claims url inputs', async () => {
  const dom = pageDom('https://chatwoot.test/app/accounts/1/campaigns/whatsapp');
  const window = await runInjector(dom);
  assert.equal(window.document.querySelector('input[type="url"]').getAttribute('data-drip-media'), '1');
});

test('outside campaigns the enhancers never run', async () => {
  for (const path of ['/app/accounts/1/conversations/9', '/app/accounts/1/settings/integrations']) {
    const dom = pageDom(`https://chatwoot.test${path}`);
    const window = await runInjector(dom);
    assert.equal(
      window.document.querySelector('input[type="url"]').getAttribute('data-drip-media'),
      null,
      `url input was enhanced on ${path}`
    );
  }
});
