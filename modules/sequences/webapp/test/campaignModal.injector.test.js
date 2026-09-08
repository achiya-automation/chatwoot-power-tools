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

const settle = (ms = 220) => new Promise((resolve) => setTimeout(resolve, ms));
const response = (data) => ({ ok: true, json: async () => ({ ok: true, data }) });
function addTemplate(window, name = 'welcome') {
  const card = window.document.createElement('div');
  card.className = 'bg-n-alpha-black2';
  card.innerHTML = `<div><h3>${name}</h3><span>Language: en</span></div>`;
  window.document.querySelector('main').appendChild(card);
}

test('media loads lazily after entering an account and ignores a late previous-account response', async () => {
  const dom = pageDom('https://chatwoot.test/app/login');
  const w = dom.window;
  addTemplate(w);
  const pending = new Map();
  w.fetch = (url) => new Promise((resolve) => pending.set(new URL(url, w.location.href).searchParams.get('account_id'), resolve));
  await runInjector(dom);
  assert.equal(pending.size, 0, 'login must not fetch account media');
  w.history.pushState({}, '', '/app/accounts/1/campaigns/whatsapp');
  w.document.body.appendChild(w.document.createElement('div'));
  await settle();
  assert.ok(pending.has('1'));
  w.history.pushState({}, '', '/app/accounts/2/campaigns/whatsapp');
  w.document.body.appendChild(w.document.createElement('div'));
  await settle();
  pending.get('2')(response({ welcome: 'https://media.test/account-2.png' }));
  await settle();
  pending.get('1')(response({ welcome: 'https://media.test/account-1.png' }));
  await settle();
  assert.equal(w.document.querySelector('input[type="url"]').value, 'https://media.test/account-2.png');
});

test('an upload started for one template cannot populate another template after switching', async () => {
  const dom = pageDom('https://chatwoot.test/app/accounts/1/campaigns/whatsapp');
  const w = dom.window;
  addTemplate(w);
  let finishUpload;
  w.fetch = (url) => url.includes('/media?')
    ? new Promise((resolve) => { finishUpload = resolve; })
    : Promise.resolve(response({}));
  await runInjector(dom);
  const file = w.document.querySelector('input[type="file"]');
  Object.defineProperty(file, 'files', { value: [new w.File(['image'], 'header.png', { type: 'image/png' })] });
  file.dispatchEvent(new w.Event('change'));
  assert.ok(w.document.querySelector('.drip-media-badge .rep').disabled, 'replacement cannot start a competing upload');
  w.document.querySelector('h3').textContent = 'another_template';
  finishUpload(response({ url: 'https://media.test/old-template.png' }));
  await settle();
  assert.equal(w.document.querySelector('input[type="url"]').value, '');
  assert.equal(w.document.querySelector('.drip-media-badge .rep').disabled, false);
});

test('failed replacement preserves the existing media and shows an accessible persistent error', async () => {
  const dom = pageDom('https://chatwoot.test/app/accounts/1/campaigns/whatsapp');
  const w = dom.window;
  addTemplate(w);
  w.fetch = async (url) => url.includes('/media?')
    ? { ok: false, json: async () => ({ error: 'File too large' }) }
    : response({ welcome: 'https://media.test/previous.png' });
  await runInjector(dom);
  const file = w.document.querySelector('input[type="file"]');
  Object.defineProperty(file, 'files', { value: [new w.File(['image'], 'header.png', { type: 'image/png' })] });
  file.dispatchEvent(new w.Event('change'));
  await settle();
  assert.equal(w.document.querySelector('input[type="url"]').value, 'https://media.test/previous.png');
  assert.match(w.document.querySelector('[role="alert"]').textContent, /File too large/);
});

test('variables inside nested input wrappers get usable chips and keyboard-operable removal buttons', async () => {
  const dom = pageDom('https://chatwoot.test/app/accounts/1/campaigns/whatsapp');
  const w = dom.window;
  w.document.querySelector('main').innerHTML = '<div class="flex flex-col"><label>Variable</label><div><input placeholder="Enter 1 value" value="{{contact.name}}"></div></div>';
  await runInjector(dom);
  const input = w.document.querySelector('input');
  assert.ok(w.document.querySelector('.drip-var-chips button'));
  const remove = w.document.querySelector('.drip-token-pill button');
  assert.ok(remove?.getAttribute('aria-label'));
  remove.click();
  assert.equal(input.value, '');
});

test('returning to the same account rejects old media and custom-field requests from its previous visit', async () => {
  const dom = pageDom('https://chatwoot.test/app/accounts/1/campaigns/whatsapp');
  const w = dom.window;
  addTemplate(w);
  const variable = w.document.createElement('input');
  variable.placeholder = 'Enter 1 value';
  w.document.querySelector('main').appendChild(variable);
  const requests = [];
  w.fetch = (url) => new Promise((resolve) => requests.push({ url, resolve }));
  await runInjector(dom);
  for (const account of ['2', '1']) {
    w.history.pushState({}, '', `/app/accounts/${account}/campaigns/whatsapp`);
    w.document.body.appendChild(w.document.createElement('div'));
    await settle();
  }
  const media = requests.filter((request) => request.url.includes('account_id=1'));
  const fields = requests.filter((request) => request.url.includes('/accounts/1/custom_attribute'));
  assert.equal(media.length, 2);
  assert.equal(fields.length, 2);
  const fieldResponse = (name) => ({ ok: true, json: async () => [{ attribute_model: 'contact_attribute', attribute_key: name, attribute_display_name: name }] });
  media[1].resolve(response({ welcome: 'https://media.test/current.png' }));
  fields[1].resolve(fieldResponse('current-field'));
  await settle();
  media[0].resolve(response({ welcome: 'https://media.test/previous.png' }));
  fields[0].resolve(fieldResponse('previous-field'));
  await settle();
  assert.match(w.document.querySelector('.drip-var-chips').textContent, /current-field/);
  assert.doesNotMatch(w.document.querySelector('.drip-var-chips').textContent, /previous-field/);
  w.document.querySelector('main').innerHTML = '<input type="url" placeholder="Enter Image URL">';
  addTemplate(w);
  await settle();
  assert.equal(w.document.querySelector('input[type="url"]').value, 'https://media.test/current.png');
});
