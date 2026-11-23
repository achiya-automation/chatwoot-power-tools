// The smart import lives inside Chatwoot's own New import dialog (Settings › Data). These tests
// mount a stand-in for that dialog with the same DOM contract NewImportDialog.vue has: the
// #contact-csv-file input whose change handler keeps only .csv files, the drop zone around it,
// the CsvPreview <section> that appears once a file is chosen, and the form whose submit starts
// the upload. The stand-in records what Chatwoot itself would have received.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

let bundle;
let loader;
const windows = [];
before(async () => {
  const result = await build({
    entryPoints: [new URL('../../../smart-import/ui/entry.js', import.meta.url).pathname],
    bundle: true, format: 'iife', globalName: '__cwImport', write: false,
  });
  bundle = result.outputFiles[0].text;
  loader = (await readFile(new URL('../../../smart-import/inject/import-button.js', import.meta.url), 'utf8'))
    .replace('__CWI_VER__', 'test');
});
after(() => windows.forEach((window) => window.close()));
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
// The box mounts after the file is read; a cold first run can take longer than one settle().
async function boxed(w) {
  for (const end = Date.now() + 3000; !w.document.querySelector('.cwi-box');) {
    if (Date.now() > end) throw new Error('the box never opened');
    await settle(10);
  }
  await settle();
}
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const MONTH = new Intl.DateTimeFormat('he', { month: 'long' }).format(new Date());

const ROUTES = {
  'GET /labels': () => ({ payload: [{ id: 1, title: 'לקוחות' }] }),
  'GET /custom_attribute_definitions?attribute_model=contact_attribute': () => [
    { attribute_key: 'policy', attribute_display_name: 'מספר פוליסה' },
  ],
  'POST /labels': (body) => ({ id: 2, title: body.label.title }),
  'POST /custom_attribute_definitions': (body) => ({ id: 3, ...body.custom_attribute_definition }),
  'POST /smart_import/preview': (body) => ({
    total: body.contacts.length, new: body.contacts.length, existing: 0, dup_in_file: 0, no_phone: 0, whatsapp: true,
  }),
  'POST /smart_import/arm': () => ({ ok: true }),
};

function mockApi(w) {
  const calls = [];
  w.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const path = url.replace('/api/v1/accounts/1', '');
    calls.push({ method, path, body, headers: opts.headers });
    const route = ROUTES[`${method} ${path}`];
    if (!route) return { ok: false, status: 404, text: async () => 'not found' };
    return { ok: true, status: 200, json: async () => route(body) };
  };
  return calls;
}

// NewImportDialog.vue, CSV source selected, as Vue renders it.
function mountNative(w, { open = true } = {}) {
  const d = w.document;
  d.getElementById('app').innerHTML = `
    <dialog ${open ? 'open' : ''}><form>
      <fieldset><label><input type="radio" name="import-source" value="csv" checked><span>CSV file</span></label></fieldset>
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-2"><label for="contact-csv-file">Contact CSV file</label></div>
        <div id="zone" class="rounded-xl border border-dashed">
          <input id="contact-csv-file" type="file" accept=".csv,text/csv" class="sr-only">
          <label for="contact-csv-file">Click to upload</label>
        </div>
        <p id="help">help</p>
      </div>
      <button type="submit">Import</button>
    </form></dialog>`;
  const native = { files: [], alerts: 0, drops: [], submits: 0, submitted: null };
  const zone = d.getElementById('zone');
  const input = d.getElementById('contact-csv-file');
  native.render = (file) => {
    native.file = file;
    zone.querySelector('.file-row, label')?.remove();
    d.querySelector('section')?.remove();
    if (file) {
      zone.insertAdjacentHTML('beforeend', '<div class="file-row flex items-center gap-3 p-4"><div><span class="truncate"></span><span class="size"></span></div><button type="button" class="remove">x</button></div>');
      zone.querySelector('.truncate').textContent = file.name;
      zone.querySelector('.size').textContent = `${file.size} Bytes`;
      zone.querySelector('.remove').addEventListener('click', () => native.render(null));
      d.getElementById('help').insertAdjacentHTML('beforebegin', '<section>preview</section>');
    } else {
      zone.insertAdjacentHTML('beforeend', '<label for="contact-csv-file">Click to upload</label>');
    }
  };
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !file.name.toLowerCase().endsWith('.csv') || !file.size) { native.alerts += 1; native.render(null); return; }
    native.files.push(file);
    native.render(file);
  });
  zone.addEventListener('drop', (e) => { // useDropZone: onDrop(files) → selectFile(files?.[0])
    native.drops.push(e.dataTransfer || null);
    if (!e.dataTransfer) native.render(null);
  });
  d.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    native.submits += 1;
    native.submitted = native.file;
  });
  return native;
}

function page({ dir = 'rtl' } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><div id="app" dir="${dir}"></div></body></html>`, {
    url: 'https://chatwoot.test/app/accounts/1/settings/data', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  windows.push(w);
  Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
  w.document.cookie = 'cw_d_session_info=' + encodeURIComponent(JSON.stringify({
    'access-token': 'AT', client: 'CL', uid: 'agent@example.com', 'token-type': 'Bearer', expiry: '9',
  }));
  const calls = mockApi(w);
  w.eval(bundle); // the dashboard loads it on demand; jsdom cannot fetch the <script>
  w.eval(loader);
  return { w, calls };
}

function pick(w, file) {
  const input = w.document.getElementById('contact-csv-file');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
}

const HEB_FILE = 'שם פרטי,שם משפחה,נייד,טלפון בבית,דוא״ל,חברה,עיר,מספר פוליסה,הערות\n'
  + 'דנה,כהן,052-765-4321,03-555-1234,dana@example.com,סטודיו דנה,חיפה,P-1,ותיקה\n'
  + 'יוסי,לוי,,077-123-4567,yossi@example.com,,תל אביב,P-2,\n';

function selectFor(w, header) {
  return [...w.document.querySelectorAll('.cwi-box select')]
    .find((s) => (s.getAttribute('aria-label') || '').includes(header));
}

test('smart import: a picked file reaches Chatwoot as its own CSV, and the box opens under it', async () => {
  const { w } = page();
  const native = mountNative(w);
  await settle();
  assert.match(w.document.getElementById('contact-csv-file').accept, /\.xlsx/, 'Excel must be selectable');

  pick(w, new w.File([HEB_FILE], 'לקוחות.csv', { type: 'text/csv' }));
  await boxed(w);

  assert.equal(native.alerts, 0);
  assert.equal(native.files.length, 1, 'Chatwoot receives one file: ours, never the original');
  const fed = native.files[0];
  assert.equal(fed.name, 'לקוחות.csv');
  const [head, first, second] = (await fed.text()).trim().split('\n');
  // The new label does not exist until Import, so it is not in this first copy yet.
  assert.equal(head, 'name,email,identifier,phone_number,cwpt:company_name,cwpt:city,cwpt:custom:policy,cwpt:row');
  assert.equal(first, 'דנה כהן,dana@example.com,,+972527654321,סטודיו דנה,חיפה,P-1,2');
  assert.equal(second, 'יוסי לוי,yossi@example.com,,+972771234567,,תל אביב,P-2,3',
    'the fallback phone column fills an empty main phone');

  const box = w.document.querySelector('.cwi-box');
  assert.ok(box, 'the mapping/label/check box sits in the dialog');
  assert.equal(box.previousElementSibling.id, 'zone', 'right under the file row');
  assert.equal(w.getComputedStyle(w.document.querySelector('section')).display, 'none', 'native CSV preview hidden');
  assert.equal(selectFor(w, 'מספר פוליסה').value, 'custom:policy', 'a custom field named like the column wins');
  assert.equal(selectFor(w, 'הערות').value, '', 'unknown columns start ignored');
  assert.match(box.textContent, /2 חדשים|חדשים/);
  assert.equal(w.document.querySelector('.truncate').textContent, 'לקוחות.csv');
  assert.match(w.document.querySelector('.size').textContent, /^2 שורות · /);
});

test('smart import: Import creates the new field and label, arms the exact file, then Chatwoot uploads it', async () => {
  const { w, calls } = page();
  const native = mountNative(w);
  await settle();
  pick(w, new w.File([HEB_FILE], 'לקוחות.csv', { type: 'text/csv' }));
  await boxed(w);
  const notes = selectFor(w, 'הערות');
  notes.value = 'new:הערות';
  notes.dispatchEvent(new w.Event('change', { bubbles: true }));

  w.document.querySelector('button[type="submit"]').click();
  await settle(120);

  assert.equal(native.submits, 1, 'Chatwoot starts its own import once');
  const writes = calls.filter((c) => c.method === 'POST' && c.path !== '/smart_import/preview').map((c) => c.path);
  assert.deepEqual(writes, ['/custom_attribute_definitions', '/labels', '/smart_import/arm']);
  assert.equal(calls.find((c) => c.path === '/labels' && c.method === 'POST').body.label.title, `ייבוא-${MONTH}`);
  const text = await native.submitted.text();
  assert.match(text.split('\n')[0], /cwpt:custom:הערות/);
  const arm = calls.find((c) => c.path === '/smart_import/arm').body;
  assert.equal(arm.sha256, sha256(text), 'armed for exactly the bytes Chatwoot uploads');
  assert.equal(arm.email_summary, true);
  assert.equal(arm.label, `ייבוא-${MONTH}`);
  assert.equal(arm.locale, 'he');
});

test('smart import: a column that does not fit its field blocks Import with a message', async () => {
  const { w, calls } = page();
  const native = mountNative(w);
  await settle();
  pick(w, new w.File(['שם,אימייל\nדנה,לקוחה ותיקה\nיוסי,מגיע בימי שני\n'], 'x.csv', { type: 'text/csv' }));
  await boxed(w);
  w.document.querySelector('button[type="submit"]').click();
  await settle();
  assert.equal(native.submits, 0);
  assert.equal(calls.some((c) => c.path === '/smart_import/arm'), false);
  assert.match(w.document.querySelector('.cwi-box [role="alert"]').textContent, /אימייל/);
});

test('smart import: removing the file in Chatwoot removes the box', async () => {
  const { w } = page();
  mountNative(w);
  await settle();
  pick(w, new w.File([HEB_FILE], 'לקוחות.csv', { type: 'text/csv' }));
  await boxed(w);
  w.document.querySelector('.remove').click();
  await settle();
  assert.equal(w.document.querySelector('.cwi-box'), null);
});

test('smart import: the latest picked file wins when an earlier read finishes late', async () => {
  const { w } = page();
  const native = mountNative(w);
  await settle();
  let finishOld;
  const old = { name: 'old.csv', size: 10, text: () => new Promise((resolve) => { finishOld = resolve; }) };
  pick(w, old);
  pick(w, new w.File(['Name,Email\nNew Person,new@example.com\n'], 'new.csv', { type: 'text/csv' }));
  await boxed(w);
  finishOld('Name,Email\nOld Person,old@example.com\n');
  await settle();
  assert.equal(native.files.length, 1);
  assert.match(await native.files[0].text(), /New Person/);
  assert.equal(w.document.querySelectorAll('.cwi-box').length, 1);
});

test('smart import: a dropped file is taken over and the drop highlight still resets', async () => {
  const { w } = page();
  const native = mountNative(w);
  await settle();
  const drop = new w.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: { files: [new w.File([HEB_FILE], 'd.csv', { type: 'text/csv' })] } });
  w.document.getElementById('zone').dispatchEvent(drop);
  await boxed(w);
  assert.deepEqual(native.drops, [null], 'Chatwoot saw only an empty drop (clears its highlight)');
  assert.equal(native.files.length, 1);
  assert.ok(w.document.querySelector('.cwi-box'));
});

test('smart import: the CSV card is named for Excel too, and comes back after a stock merge', async () => {
  const { w } = page();
  const messages = { he: {}, en: {} };
  const merges = [];
  const sym = Symbol('i18n');
  const global = {
    getLocaleMessage: (locale) => messages[locale],
    mergeLocaleMessage: (locale, msg) => { merges.push(locale); messages[locale] = { DATA_IMPORTS: { CSV: { ...msg.DATA_IMPORTS.CSV } } }; },
  };
  mountNative(w);
  w.document.getElementById('app').__vue_app__ = { __VUE_I18N_SYMBOL__: sym, _context: { provides: { [sym]: { global } } } };
  w.document.body.append(w.document.createElement('i'));
  await settle();
  assert.equal(messages.he.DATA_IMPORTS.CSV.SOURCE, 'קובץ CSV או Excel');
  assert.equal(messages.en.DATA_IMPORTS.CSV.SOURCE, 'CSV or Excel file');
  assert.equal(messages.he.DATA_IMPORTS.CSV.FILE_LIMIT, 'CSV או Excel · עד 50 MiB');
  w.document.body.append(w.document.createElement('i'));
  await settle();
  assert.deepEqual(merges, ['he', 'en'], 'merged once while current');
  messages.he = { DATA_IMPORTS: { CSV: { SOURCE: 'קובץ CSV' } } }; // native-i18n-he.js, later
  w.document.body.append(w.document.createElement('i'));
  await settle();
  assert.equal(messages.he.DATA_IMPORTS.CSV.SOURCE, 'קובץ CSV או Excel');
});

test('smart import: Chatwoot\'s rejected-rows file and files it cannot read reach Chatwoot untouched', async () => {
  const { w } = page();
  const native = mountNative(w);
  await settle();
  const rejected = new w.File(['__chatwoot_csv_format,name,errors\n1,Dana,Unknown labels: x\n'], 'rejected.csv', { type: 'text/csv' });
  pick(w, rejected);
  await settle();
  assert.equal(native.files[0], rejected);
  assert.equal(w.document.querySelector('.cwi-box'), null);
  pick(w, new w.File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' }));
  await settle();
  assert.equal(native.alerts, 1, 'Chatwoot itself turns it down, as before');
});

test('smart import: English dashboard gets the English box', async () => {
  const { w } = page({ dir: 'ltr' });
  mountNative(w);
  await settle();
  pick(w, new w.File(['Name,Phone\nDana,0527654321\n'], 'c.csv', { type: 'text/csv' }));
  await boxed(w);
  assert.match(w.document.querySelector('.cwi-box').textContent, /Map columns/);
  assert.match(w.document.querySelector('.size').textContent, /^1 row · /);
});
