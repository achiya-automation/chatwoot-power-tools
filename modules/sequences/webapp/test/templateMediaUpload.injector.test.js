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
    url: 'https://chatwoot.test/app/accounts/7/conversations/5', runScripts: 'outside-only',
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
  assert.match(request.url, /^\/drip\/drip-api\/media\?account_id=7&format=DOCUMENT&locale=he$/);
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

// The markup TemplateFields.vue renders on the campaign form: no row, one <Input> column per field.
const campaign = (name, format) => `
  <div id="campaign-template"><button><span>${name} (he)</span></button><ul><li>other (he)</li></ul></div>
  <div class="flex flex-col gap-2">
    <label>כותרת עליונה</label>
    <div class="relative flex flex-col min-w-0 gap-1"><input type="url" placeholder="הזן כותרת עליונה מסוג ${format}"></div>
    <div class="relative flex flex-col min-w-0 gap-1"><input type="text" id="file-name" placeholder="הזן שם מסמך"></div>
  </div>
  <input type="url" id="sample" placeholder="https://example.com/image.jpg">`;

test('on the campaign form the button sits under the field and an upload fills both fields', async t => {
  const w = await mount(t, campaign('document', 'Document'));
  const url = w.document.querySelector('input[type="url"]');
  const button = w.document.querySelector('[data-cwpt-media-upload]');
  assert.equal(w.document.querySelectorAll('[data-cwpt-media-upload]').length, 1);
  assert.equal(button.parentElement, url.parentElement);
  assert.equal(w.document.getElementById('sample').hasAttribute('data-cwpt-media'), false);
  let request;
  w.fetch = async (address) => { request = address; return reply(200, { ok: true, data: { url: 'https://cdn.test/media/b.pdf' } }); };
  pick(w, 'terms.pdf', 'application/pdf');
  await tick();
  assert.match(request, /format=DOCUMENT/);
  assert.equal(url.value, 'https://cdn.test/media/b.pdf');
  assert.equal(w.document.getElementById('file-name').value, 'terms.pdf');
});

test('on the campaign form a template switch during the upload leaves the new template empty', async t => {
  const w = await mount(t, campaign('first', 'Image'));
  let finish;
  w.fetch = () => new Promise(resolve => { finish = resolve; });
  pick(w, 'a.png', 'image/png');
  w.document.querySelector('#campaign-template span').textContent = 'second (he)';
  finish(reply(200, { ok: true, data: { url: 'https://cdn.test/media/first.png' } }));
  await tick();
  assert.equal(w.document.querySelector('input[type="url"]').value, '');
});

// ── twins: one template that takes a picture or a document ──────────────────────────────
const tpl = (name, format, status = 'APPROVED') => ({ name, language: 'he', status, components: [{ type: 'HEADER', format }] });
async function mountWithInboxes(t, html, templates) {
  const dom = new JSDOM(`<!doctype html><div id="app" dir="rtl">${html}</div>`, {
    url: 'https://chatwoot.test/app/accounts/7/conversations/5', runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.__CW_ADDONS_BASE = '/drip';
  w.fetch = async () => reply(200, { payload: [{ id: 1, message_templates: templates }] });
  w.eval(source);
  await new Promise(resolve => setTimeout(resolve, 550));
  return w;
}

test('a document template with an approved image twin takes a picture and uploads it as an image', async t => {
  const w = await mountWithInboxes(t, parser('offer', 'Document', true), [tpl('offer', 'DOCUMENT'), tpl('offer__image', 'IMAGE')]);
  const picker = w.document.querySelector('input[type="file"]');
  w.document.querySelector('[data-cwpt-media-upload]').click();
  assert.match(picker.accept, /image\/jpeg/);
  assert.match(picker.accept, /\.pdf/);
  let request;
  w.fetch = async url => { request = url; return reply(200, { ok: true, data: { url: 'https://cdn.test/media/a.jpg' } }); };
  pick(w, 'flyer.jpg', 'image/jpeg');
  await tick();
  assert.match(request, /format=IMAGE/);
  assert.equal(w.document.querySelector('input[type="url"]').value, 'https://cdn.test/media/a.jpg');
});

test('without an approved twin the template keeps its own format only', async t => {
  const w = await mountWithInboxes(t, parser('offer', 'Document', true), [tpl('offer', 'DOCUMENT'), tpl('offer__image', 'IMAGE', 'PENDING')]);
  const picker = w.document.querySelector('input[type="file"]');
  w.document.querySelector('[data-cwpt-media-upload]').click();
  assert.doesNotMatch(picker.accept, /image\/jpeg/);
});

test('twins are hidden from the template lists and ordinary templates stay', async t => {
  const list = `
    <div id="list">
      <div><button id="base"><p>offer</p></button></div>
      <div><button id="twin"><p>offer__image</p></button></div>
      <div><button id="lookalike"><p>send_image</p></button></div>
      <ul><li id="label-twin" role="option"><span>Offer  Document (he)</span></li><li id="label-plain" role="option"><span>Send Image (he)</span></li></ul>
    </div>`;
  const w = await mountWithInboxes(t, list, []);
  const shown = id => w.document.getElementById(id).style.display !== 'none';
  assert.equal(shown('twin'), false);
  assert.equal(shown('label-twin'), false);
  assert.equal(shown('base'), true);
  assert.equal(shown('lookalike'), true);
  assert.equal(shown('label-plain'), true);
});
