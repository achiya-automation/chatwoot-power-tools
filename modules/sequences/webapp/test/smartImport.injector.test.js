import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

let source;
const windows = [];
before(async () => {
  const result = await build({
    entryPoints: [new URL('../../../smart-import/ui/entry.js', import.meta.url).pathname],
    bundle: true, format: 'iife', globalName: '__cwImport', write: false,
  });
  source = result.outputFiles[0].text;
});
after(() => windows.forEach((window) => window.close()));
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function page() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app" dir="ltr"><button id="opener">Open import</button></div></body></html>', {
    url: 'https://chatwoot.test/app/accounts/1/contacts', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  windows.push(w);
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.fetch = async (url) => ({ ok: true, json: async () => url.includes('/inboxes') ? { payload: [] } : [] });
  w.eval(source);
  w.document.getElementById('opener').focus();
  w.__cwImport.openWizard({ accountId: '1', authHeaders: {}, assetBase: '/chatwoot-addons' });
  return w;
}

function pick(w, textOrPromise, name = 'contacts.csv') {
  const input = w.document.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name, text: () => Promise.resolve(textOrPromise) }] });
  input.dispatchEvent(new w.Event('change'));
}

function button(w, name) {
  return [...w.document.querySelectorAll('button')].find((node) => node.textContent === name);
}

test('smart import: dialog is named, singleton, and keyboard upload is available', async () => {
  const w = page();
  const dialog = w.document.querySelector('dialog');
  assert.equal(w.document.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'Import contacts');
  w.__cwImport.openWizard({ accountId: '1', authHeaders: {}, assetBase: '/chatwoot-addons' });
  assert.equal(w.document.querySelectorAll('dialog').length, 1);
  let clicks = 0;
  w.document.querySelector('input[type="file"]').click = () => clicks++;
  const drop = w.document.querySelector('[role="button"]');
  assert.equal(drop.tabIndex, 0);
  drop.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(clicks, 1);
  button(w, 'Cancel').click();
  assert.equal(w.document.activeElement.id, 'opener');
});

test('smart import: latest selected file wins when an earlier read finishes late', async () => {
  const w = page();
  let finishOldFile;
  const oldFile = new Promise((resolve) => { finishOldFile = resolve; });
  pick(w, oldFile, 'old.csv');
  pick(w, 'Name,Email\nNew Person,new@example.com', 'new.csv');
  await settle();
  assert.match(w.document.querySelector('table').textContent, /New Person/);
  finishOldFile('Name,Email\nOld Person,old@example.com');
  await settle();
  assert.match(w.document.querySelector('table').textContent, /New Person/);
  assert.doesNotMatch(w.document.querySelector('table').textContent, /Old Person/);
});

test('smart import: dropdown closes on Tab and restores trigger focus on Escape', async () => {
  const w = page();
  pick(w, 'Name,Email\nPerson,person@example.com');
  await settle();
  const trigger = w.document.querySelector('table button');
  trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.ok(w.document.querySelector('[role="option"][aria-selected="true"]'));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(w.document.querySelector('.cwi-cs-panel'), null);
  assert.equal(w.document.activeElement, trigger);
  trigger.click();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(w.document.querySelector('.cwi-cs-panel'), null);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('smart import: closing with an open dropdown removes document keyboard handlers', async () => {
  const w = page();
  pick(w, 'Name,Email\nPerson,person@example.com');
  await settle();
  w.document.querySelector('table button').click();
  w.document.querySelector('dialog').dispatchEvent(new w.Event('cancel', { cancelable: true }));
  assert.equal(w.document.querySelector('dialog'), null);
  const down = new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
  w.document.dispatchEvent(down);
  assert.equal(down.defaultPrevented, false, 'closed dropdown must not intercept the Chatwoot keyboard');
});

test('smart import: explicit Ignore survives returning from the label step', async () => {
  const w = page();
  w.fetch = async (url) => ({ ok: true, json: async () => url.includes('custom_attribute')
    ? [{ attribute_key: 'company', attribute_display_name: 'Company', attribute_model: 'contact_attribute' }] : [] });
  pick(w, 'Company,Email\nExample,person@example.com');
  await settle();
  const trigger = w.document.querySelector('table button');
  assert.equal(trigger.textContent, 'Company');
  trigger.click();
  [...w.document.querySelectorAll('[role="option"]')].find((node) => node.textContent.includes('Ignore')).click();
  button(w, 'Continue').click();
  await settle();
  button(w, 'Back').click();
  await settle();
  assert.match(w.document.querySelector('table button').textContent, /Ignore/);
});

test('smart import: reopening after switching language uses the current locale', () => {
  const w = page();
  button(w, 'Cancel').click();
  w.document.getElementById('app').dir = 'rtl';
  w.__cwImport.openWizard({ accountId: '1', authHeaders: {}, assetBase: '/chatwoot-addons' });
  assert.equal(w.document.querySelector('dialog').dir, 'rtl');
  assert.equal(w.document.querySelector('h3').textContent, 'ייבוא אנשי קשר');
});
