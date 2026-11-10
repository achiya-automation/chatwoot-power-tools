import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../../dashboard-enhancements/parts/failed-message-email-settings.js', import.meta.url), 'utf8');

// The shape of Chatwoot's Settings -> Account page: a few sections, the account id last.
const page = `
  <main><div id="list">
    <div><section><header><h4>General</h4></header></section></div>
    <section id="restrict"><header><h4>Restrict agents</h4></header></section>
    <section id="account-id"><header><h4>Account ID</h4></header></section>
  </div></main>`;

async function mount(t, { path = '/app/accounts/7/settings/general', stored = [], status = 200 } = {}) {
  const dom = new JSDOM(`<!doctype html><div id="app" dir="rtl">${page}</div>`, {
    url: `https://chatwoot.test${path}`, runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.document.cookie = 'cw_d_session_info=' + encodeURIComponent(JSON.stringify({ 'access-token': 'x', client: 'c', uid: 'admin@example.com', expiry: 1, 'token-type': 'Bearer' }));
  const calls = [];
  let current = stored;
  w.accept = true;
  w.fetch = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null, uid: options.headers.uid });
    if (options.method === 'PATCH' && w.accept) current = JSON.parse(options.body).failed_message_email;
    return { ok: status < 400, status, json: async () => ({ id: 7, settings: { failed_message_email: current } }) };
  };
  w.eval(source);
  await new Promise(resolve => setTimeout(resolve, 600));
  const section = w.document.querySelector('[data-cwpt-failed-message-email]');
  return { w, calls, section, q: selector => section.querySelector(selector) };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 30));

test('the section sits before the account id and shows what the account has stored', async t => {
  const { w, calls, section, q } = await mount(t, { stored: ['sender', 'owner@example.com'] });
  assert.equal(section.nextElementSibling, w.document.getElementById('account-id'));
  assert.equal(section.previousElementSibling, w.document.getElementById('restrict'));
  assert.deepEqual(calls.map(c => [c.method, c.url, c.uid]), [['GET', '/api/v1/accounts/7', 'admin@example.com']]);
  assert.equal(q('[role="switch"]').getAttribute('aria-checked'), 'true');
  assert.equal(q('input[type="text"]').value, 'owner@example.com');
  assert.equal(q('input[type="checkbox"]').checked, true);
  w.eval(source);
  assert.equal(w.document.querySelectorAll('[data-cwpt-failed-message-email]').length, 1);
});

test('other pages get nothing, and a failed read hides the section', async t => {
  const other = await mount(t, { path: '/app/accounts/7/settings/agents/list' });
  assert.equal(other.section, null);
  const failed = await mount(t, { status: 401 });
  assert.equal(failed.section.hidden, true);
});

test('switching on offers the administrator address and stores only on save', async t => {
  const { calls, q } = await mount(t);
  assert.equal(q('[role="switch"]').getAttribute('aria-checked'), 'false');
  q('[role="switch"]').click();
  assert.equal(q('input[type="text"]').value, 'admin@example.com');
  assert.equal(calls.length, 1);
  q('input[type="text"]').value = 'Owner@example.com; second@example.com';
  q('input[type="checkbox"]').checked = true;
  q('button:not([role])').click();
  await tick();
  assert.deepEqual(calls[1], { url: '/api/v1/accounts/7', method: 'PATCH', uid: 'admin@example.com',
    body: { failed_message_email: ['sender', 'Owner@example.com', 'second@example.com'] } });
  assert.equal(q('[role="status"]').textContent, 'נשמר');
  assert.equal(q('[role="switch"]').getAttribute('aria-checked'), 'true');
});

test('a bad address or an empty list is refused before any request', async t => {
  const { calls, q } = await mount(t);
  q('[role="switch"]').click();
  q('input[type="text"]').value = 'owner@example.com, not-an-address';
  q('button:not([role])').click();
  assert.match(q('[role="status"]').textContent, /not-an-address/);
  q('input[type="text"]').value = '';
  q('button:not([role])').click();
  assert.equal(q('[role="status"]').textContent, 'צריך לפחות כתובת אחת, או לסמן את הנציג ששלח');
  assert.equal(calls.length, 1);
});

test('switching off stores an empty list, and a server that drops the setting is reported', async t => {
  const { w, calls, q } = await mount(t, { stored: ['owner@example.com'] });
  q('[role="switch"]').click();
  await tick();
  assert.deepEqual(calls[1].body, { failed_message_email: [] });
  assert.equal(q('[role="switch"]').getAttribute('aria-checked'), 'false');
  w.accept = false;
  q('[role="switch"]').click();
  q('button:not([role])').click();
  await tick();
  assert.equal(q('[role="status"]').textContent, 'השמירה נכשלה');
});
