import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../../dashboard-enhancements/parts/template-media-upload.js', import.meta.url), 'utf8');

// The markup WhatsAppTemplateParser.vue renders for a media-header template (Chatwoot 4.19).
const parser = (name, format, withFileName) => `
  <div id="parser">
    <div class="bg-n-alpha-black2"><h3>${name}</h3></div>
    <div class="mb-4">
      <div class="flex items-center mb-2.5"><div class="flex-1"><input type="url" placeholder="הזן כתובת URL של ${format}"></div></div>
      ${withFileName ? '<div class="flex items-center mb-2.5"><div class="flex-1"><input type="text" id="file-name" placeholder="Invoice_2025.pdf"></div></div>' : ''}
    </div>
    <input type="url" id="other" placeholder="https://example.com">
  </div>`;

async function mount(t, html) {
  const dom = new JSDOM(`<!doctype html><div id="app" dir="rtl">${html}</div>`, {
    url: 'https://chatwoot.test/app/accounts/23/conversations/5', runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.__CW_ADDONS_BASE = '/drip';
  w.eval(source);
  await new Promise(resolve => setTimeout(resolve, 550));
  return w;
}
const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
const reply = (status, json) => ({ ok: status < 400, status, json: async () => json });
function pick(w, name, type) {
  const picker = w.document.querySelector('input[type="file"]');
  Object.defineProperty(picker, 'files', { configurable: true, value: [new w.File(['x'], name, { type })] });
  picker.dispatchEvent(new w.Event('change'));
}

test('adds one upload button beside the media field and leaves other url inputs alone', async t => {
  const w = await mount(t, parser('document', 'Document', true));
  const buttons = w.document.querySelectorAll('[data-cwpt-media-upload]');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, 'העלאת קובץ');
  assert.equal(buttons[0].parentElement, w.document.querySelector('input[type="url"]').closest('.flex.items-center'));
  assert.equal(w.document.getElementById('other').hasAttribute('data-cwpt-media'), false);
  w.eval(source);
  assert.equal(w.document.querySelectorAll('[data-cwpt-media-upload]').length, 1);
});

test('an uploaded document fills the url and the file name through input events', async t => {
  const w = await mount(t, parser('document', 'Document', true));
  let request;
  w.fetch = async (url, options) => { request = { url, options }; return reply(200, { ok: true, data: { url: 'https://cdn.test/media/a.pdf' } }); };
  const url = w.document.querySelector('input[type="url"]');
  const events = [];
  url.addEventListener('input', () => events.push(url.value));
  pick(w, 'פוליסה.pdf', 'application/pdf');
  await tick();
  assert.match(request.url, /^\/drip\/drip-api\/media\?account_id=23&format=DOCUMENT&locale=he$/);
  assert.equal(request.options.headers['x-filename'], encodeURIComponent('פוליסה.pdf'));
  assert.deepEqual(events, ['https://cdn.test/media/a.pdf']);
  assert.equal(w.document.getElementById('file-name').value, 'פוליסה.pdf');
  assert.equal(w.document.querySelector('[data-cwpt-media-upload]').disabled, false);
});

test('a rejected file shows the server reason and keeps the field as it was', async t => {
  const w = await mount(t, parser('photo', 'Image', false));
  w.fetch = async () => reply(400, { ok: false, error: 'הקובץ גדול מדי' });
  pick(w, 'big.png', 'image/png');
  await tick();
  const error = w.document.querySelector('[role="alert"]');
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, 'הקובץ גדול מדי');
  assert.equal(w.document.querySelector('input[type="url"]').value, '');
});

test('a file that finishes uploading after a template switch is not dropped into the new template', async t => {
  const w = await mount(t, parser('first', 'Image', false));
  let finish;
  w.fetch = () => new Promise(resolve => { finish = resolve; });
  pick(w, 'a.png', 'image/png');
  w.document.querySelector('h3').textContent = 'second';
  finish(reply(200, { ok: true, data: { url: 'https://cdn.test/media/first.png' } }));
  await tick();
  assert.equal(w.document.querySelector('input[type="url"]').value, '');
});
