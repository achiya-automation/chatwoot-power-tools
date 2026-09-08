import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';

const h = React.createElement;
const webapp = fileURLToPath(new URL('..', import.meta.url));
let dom, createRoot, Modal, Dropdown, TemplatePicker, Input, ConfirmDialog, ToastProvider, useToast;
let root;
let tempDir;

before(async () => {
  dom = new JSDOM('<!doctype html><html dir="rtl"><body></body></html>', { url: 'http://localhost/?locale=en', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'getComputedStyle']) {
    globalThis[key] = typeof dom.window[key] === 'function' && key === 'getComputedStyle'
      ? dom.window[key].bind(dom.window) : dom.window[key];
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import('react-dom/client'));
  // Compile production JSX with the same esbuild runtime Vite uses; React stays external
  // so the mounted components and test renderer share a single hook dispatcher.
  tempDir = await mkdtemp(join(webapp, 'node_modules', '.ui-controls-test-'));
  const outfile = join(tempDir, 'components.mjs');
  await build({
    stdin: {
      contents: ['Modal', 'Dropdown', 'TemplatePicker', 'Input', 'ConfirmDialog']
        .map((name) => `export { default as ${name} } from './src/components/ui/${name}.jsx';`).join('\n')
        + '\nexport { ToastProvider, useToast } from "./src/components/ui/Toast.jsx";',
      resolveDir: webapp,
    },
    outfile, bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic',
  });
  ({ Modal, Dropdown, TemplatePicker, Input, ConfirmDialog, ToastProvider, useToast } = await import(pathToFileURL(outfile).href));
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  document.body.replaceChildren();
  document.body.style.overflow = '';
});

after(async () => {
  dom?.window.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function render(element) {
  if (!root) {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => {
    root.render(element);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  // Modal's initial focus intentionally happens after the portal is mounted.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
}

async function click(el) { await act(async () => el.click()); }
async function key(el, value, extra = {}) {
  const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra });
  await act(async () => el.dispatchEvent(event));
  return event;
}

test('modal retains text-field focus across parent rerenders and uses the newest close callback', async () => {
  let closed = '';
  await render(h(Modal, { open: true, onClose: () => { closed = 'old'; }, title: 'Edit' }, h('input', { id: 'name' })));
  const input = document.querySelector('#name');
  input.focus();
  await render(h(Modal, { open: true, onClose: () => { closed = 'new'; }, title: 'Edit' }, h('input', { id: 'name' })));
  assert.equal(document.activeElement, input);
  await key(input, 'Escape');
  assert.equal(closed, 'new');
});

test('modal contains forward/backward Tab and focus attempted outside its panel', async () => {
  await render(h('div', null, h('button', { id: 'outside' }, 'Outside'),
    h(Modal, { open: true, title: 'Edit', onClose() {} }, h('input', { id: 'name' }), h('button', { id: 'last' }, 'Save'))));
  const dialog = document.querySelector('[role="dialog"]');
  const first = dialog.querySelector('button');
  const last = dialog.querySelector('#last');
  last.focus();
  assert.equal((await key(last, 'Tab')).defaultPrevented, true);
  assert.equal(document.activeElement, first);
  await key(first, 'Tab', { shiftKey: true });
  assert.equal(document.activeElement, last);
  document.querySelector('#outside').focus();
  assert.equal(document.activeElement, dialog);
});

test('nested preview portals escape editor clipping; Escape closes only preview and preserves body lock', async () => {
  document.body.style.overflow = 'auto';
  function Harness() {
    const [editor, setEditor] = useState(true);
    const [preview, setPreview] = useState(false);
    return h(Modal, { open: editor, title: 'Editor', onClose: () => setEditor(false) },
      h('button', { id: 'preview', onClick: () => setPreview(true) }, 'Preview'),
      h(Modal, { open: preview, title: 'Preview', onClose: () => setPreview(false) }, 'Preview content'));
  }
  await render(h(Harness));
  const trigger = document.querySelector('#preview');
  trigger.focus();
  await click(trigger);
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  assert.equal(dialogs.length, 2);
  assert.equal(dialogs[0].contains(dialogs[1]), false);
  await key(document, 'Escape');
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.activeElement, trigger);
  await key(trigger, 'Escape');
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.equal(document.body.style.overflow, 'auto');
});

test('closing all stacked dialogs together restores the original scroll state', async () => {
  document.body.style.overflow = 'scroll';
  await render(h(Modal, { open: true, title: 'Outer', onClose() {} },
    h(Modal, { open: true, title: 'Inner', onClose() {} }, 'Body')));
  await render(null);
  assert.equal(document.body.style.overflow, 'scroll');
});

test('modal keyboard cycle includes an Undo toast while still excluding the background', async () => {
  let undone = false;
  function Harness() {
    const { toast } = useToast();
    return h(Modal, { open: true, title: 'Editor', onClose() {} },
      h('button', {
        id: 'remove-step',
        onClick: () => toast({ message: 'Step removed', duration: 0, action: { label: 'Undo', onClick: () => { undone = true; } } }),
      }, 'Remove step'));
  }
  await render(h(ToastProvider, null, h(Harness)));
  const remove = document.querySelector('#remove-step');
  await click(remove);
  remove.focus();
  await key(remove, 'Tab');
  const undo = document.querySelector('[data-modal-focus-scope] button');
  assert.equal(document.activeElement, undo);
  await key(undo, 'Tab', { shiftKey: true });
  assert.equal(document.activeElement, remove);
  await key(remove, 'Tab');
  await click(undo);
  assert.equal(undone, true);
});

test('confirm dialogs expose their title and cannot escape a pending operation', async () => {
  let closes = 0;
  await render(h(ConfirmDialog, { open: true, title: 'Save changes', loading: true, onClose: () => closes++ }));
  const dialog = document.querySelector('[role="dialog"]');
  assert.equal(dialog.getAttribute('aria-label'), 'Save changes');
  await key(dialog, 'Escape');
  assert.equal(closes, 0);
});

const options = [
  { value: 0, label: 'Unavailable', disabled: true },
  { value: 1, label: 'First' },
  { value: 2, label: 'Disabled middle', disabled: true },
  { value: 3, label: 'Last' },
];

test('dropdown skips disabled options, focuses its named list, and keeps IDs distinct between controls', async () => {
  let selected;
  await render(h('div', null,
    h(Dropdown, { options, onChange: (value) => { selected = value; }, ariaLabel: 'First dropdown' }),
    h(Dropdown, { options, ariaLabel: 'Second dropdown' })));
  const triggers = [...document.querySelectorAll('[aria-haspopup="listbox"]')];
  await key(triggers[0], 'ArrowDown');
  let list = document.querySelector('[role="listbox"]');
  assert.equal(document.activeElement, list);
  assert.equal(list.getAttribute('aria-label'), 'First dropdown');
  const firstListId = list.id;
  const activeOption = () => document.getElementById(list.getAttribute('aria-activedescendant'));
  assert.match(activeOption().textContent, /First/);
  await key(list, 'ArrowDown');
  assert.match(activeOption().textContent, /Last/);
  await key(list, 'Enter');
  assert.equal(selected, 3);
  assert.equal(document.activeElement, triggers[0]);
  await key(triggers[1], 'ArrowUp');
  list = document.querySelector('[role="listbox"]');
  assert.notEqual(list.id, firstListId);
  assert.match(activeOption().textContent, /Last/);
  assert.equal(list.querySelectorAll('button:not([tabindex="-1"])').length, 0);
});

test('Escape in an open dropdown closes the dropdown without dismissing the editor', async () => {
  let closed = 0;
  await render(h(Modal, { open: true, title: 'Editor', onClose: () => closed++ }, h(Dropdown, { options })));
  const trigger = document.querySelector('[aria-haspopup="listbox"]');
  await click(trigger);
  await key(document.querySelector('[role="listbox"]'), 'Escape');
  assert.equal(closed, 0);
  assert.equal(document.querySelector('[role="listbox"]'), null);
  assert.equal(document.activeElement, trigger);
});

test('dropdown Tab leaves the menu without adding all choices to Tab order', async () => {
  await render(h(Dropdown, { options }));
  const trigger = document.querySelector('button');
  await click(trigger);
  const event = await key(document.querySelector('[role="listbox"]'), 'Tab');
  assert.equal(event.defaultPrevented, false);
  assert.equal(document.querySelector('[role="listbox"]'), null);
  assert.equal(document.activeElement, trigger);
});

test('template picker supports keyboard selection and restores focus after choosing', async () => {
  let selected;
  await render(h(TemplatePicker, { templates: [{ name: 'welcome', body: 'Hello' }, { name: 'follow_up', body: 'Update' }], onChange: (value) => { selected = value; } }));
  const trigger = document.querySelector('button');
  await click(trigger);
  const search = document.querySelector('[role="combobox"]');
  assert.equal(document.activeElement, search);
  await key(search, 'ArrowDown');
  assert.match(document.getElementById(search.getAttribute('aria-activedescendant')).textContent, /follow_up/);
  await key(search, 'Enter');
  assert.equal(selected, 'follow_up');
  assert.equal(document.activeElement, trigger);
  assert.equal(document.querySelector('[role="listbox"]'), null);
});

test('template picker Escape preserves its containing dialog', async () => {
  let closed = 0;
  await render(h(Modal, { open: true, title: 'Editor', onClose: () => closed++ }, h(TemplatePicker, { templates: [] })));
  await click(document.querySelector('[aria-haspopup="listbox"]'));
  await key(document.querySelector('[role="combobox"]'), 'Escape');
  assert.equal(closed, 0);
  assert.equal(document.querySelector('[role="combobox"]'), null);
});

test('input descriptions preserve caller context and switch to the announced validation error', async () => {
  await render(h(Input, { label: 'Name', hint: 'Use a unique name', 'aria-describedby': 'external' }));
  let input = document.querySelector('input');
  let ids = input.getAttribute('aria-describedby').split(' ');
  assert.equal(ids[0], 'external');
  assert.equal(document.getElementById(ids[1]).textContent, 'Use a unique name');
  await render(h(Input, { label: 'Name', hint: 'Use a unique name', error: 'Name is required', 'aria-describedby': 'external' }));
  input = document.querySelector('input');
  ids = input.getAttribute('aria-describedby').split(' ');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.equal(document.getElementById(ids[1]).textContent, 'Name is required');
  assert.equal(document.getElementById(ids[1]).getAttribute('role'), 'alert');
});
