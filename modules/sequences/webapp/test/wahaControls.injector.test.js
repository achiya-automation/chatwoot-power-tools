/*
 * WAHA controls injector — jsdom coverage for the integration-chat gate, command payloads,
 * confirmation safety and the assembled DASHBOARD_SCRIPTS artifact. No test reaches Chatwoot
 * or WAHA: every request is handled by the local fetch mock.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const SRC_URL = new URL('../../../dashboard-enhancements/parts/waha-controls.js', import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const OPEN_WINDOWS = [];

after(() => {
  for (const window of OPEN_WINDOWS) {
    try { window.close(); } catch (error) {}
  }
});

function pageDom(chatId = 'whatsapp.integration') {
  const cookie = encodeURIComponent(JSON.stringify({
    'access-token': 'test-token', 'token-type': 'Bearer', client: 'test-client', expiry: '999', uid: 'test@example.invalid',
  }));
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body><div id="app" dir="rtl"><main><div class="flex flex-col"><ul class="conversation-panel"><li><div class="message-bubble-container">הודעה קיימת</div></li></ul><div class="relative resizable-editor-wrapper"><div class="reply-box"></div></div></div></main></div></body></html>',
    {
      url: 'https://chatwoot.test/app/accounts/1/inbox/23/conversations/3289',
      runScripts: 'outside-only',
    }
  );
  dom.window.document.cookie = `cw_d_session_info=${cookie}`;
  dom.window.__CWPT_WAHA_DELAY_SCALE = 0;
  const calls = [];
  dom.window.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ url: String(url), method, body: options.body ? JSON.parse(options.body) : null });
    if (method === 'GET') {
      return {
        ok: true,
        json: async () => ({ meta: { sender: { custom_attributes: { waha_whatsapp_chat_id: chatId } } } }),
      };
    }
    return { ok: true, json: async () => ({ id: calls.length }) };
  };
  OPEN_WINDOWS.push(dom.window);
  return { dom, calls };
}

async function runInjector(dom) {
  const source = await readFile(SRC_URL, 'utf8');
  dom.window.eval(source);
  await new Promise((resolve) => setTimeout(resolve, 750));
  return dom.window;
}

async function clickAndSettle(window, selector) {
  const button = window.document.querySelector(selector);
  assert.ok(button, `missing button: ${selector}`);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 80));
}

test('renders only in the WAHA integration control conversation', async () => {
  const match = pageDom();
  await runInjector(match.dom);
  assert.ok(match.dom.window.document.getElementById('cwpt-waha-controls'));
  assert.match(match.dom.window.document.body.textContent, /מה תרצו לעשות/);
  assert.match(match.dom.window.document.body.textContent, /חיבור מחדש עם QR/);

  const controlMessage = match.dom.window.document.getElementById('cwpt-waha-controls');
  assert.equal(controlMessage.tagName, 'LI');
  assert.ok(controlMessage.parentElement.classList.contains('conversation-panel'));
  assert.ok(controlMessage.querySelector('.cwpt-waha-bubble'));
  assert.equal(controlMessage.previousElementSibling.textContent, 'הודעה קיימת');
  assert.equal(
    match.dom.window.document.querySelector('.resizable-editor-wrapper').previousElementSibling.className,
    'conversation-panel'
  );

  const ordinary = pageDom('972501234567@c.us');
  await runInjector(ordinary.dom);
  assert.equal(ordinary.dom.window.document.getElementById('cwpt-waha-controls'), null);
});

test('safe action button posts the exact WAHA command to the current Chatwoot conversation', async () => {
  const { dom, calls } = pageDom();
  const window = await runInjector(dom);
  await clickAndSettle(window, 'button[data-action="messages"]');
  const posts = calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/v1/accounts/1/conversations/3289/messages');
  assert.equal(posts[0].body.content, 'messages pull');
  assert.equal(posts[0].body.private, false);
  assert.match(window.document.querySelector('.cwpt-waha-status').textContent, /סנכרון ההודעות התחיל/);
});

test('keeps the bot choices after the latest reply in the conversation flow', async () => {
  const { dom } = pageDom();
  const window = await runInjector(dom);
  const list = window.document.querySelector('.conversation-panel');
  const reply = window.document.createElement('li');
  reply.textContent = 'תשובת הבוט';
  list.appendChild(reply);

  await new Promise((resolve) => setTimeout(resolve, 320));

  assert.equal(list.lastElementChild.id, 'cwpt-waha-controls');
  assert.equal(list.lastElementChild.previousElementSibling.textContent, 'תשובת הבוט');
});

test('reconnect requires confirmation and then sends logout, start and qr in order', async () => {
  const { dom, calls } = pageDom();
  const window = await runInjector(dom);
  await clickAndSettle(window, 'button[data-action="reconnect"]');
  assert.equal(calls.filter((call) => call.method === 'POST').length, 0, 'opening the warning must not send anything');
  const confirm = window.document.querySelector('.cwpt-waha-confirm');
  assert.equal(confirm.hidden, false);
  assert.match(confirm.textContent, /החשבון יתנתק זמנית/);

  await clickAndSettle(window, '.cwpt-waha-confirm-run');
  const commands = calls.filter((call) => call.method === 'POST').map((call) => call.body.content);
  assert.deepEqual(commands, ['logout', 'start', 'qr']);
});

test('cancel leaves the destructive reconnect action untouched', async () => {
  const { dom, calls } = pageDom();
  const window = await runInjector(dom);
  await clickAndSettle(window, 'button[data-action="reconnect"]');
  await clickAndSettle(window, '.cwpt-waha-confirm-cancel');
  assert.equal(calls.filter((call) => call.method === 'POST').length, 0);
  assert.equal(window.document.querySelector('.cwpt-waha-confirm').hidden, true);
});

test('enhancements artifact includes the WAHA controls part', () => {
  const html = execFileSync(
    'bash',
    ['-c', 'source lib/assemble-dashboard-script.sh && assemble_dashboard_script "/drip" enhancements'],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );
  assert.match(html, /part: modules\/dashboard-enhancements\/parts\/waha-controls\.js/);
  assert.match(html, /מה תרצו לעשות/);
});
