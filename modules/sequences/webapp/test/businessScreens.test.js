import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, after, test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { emptyTemplate } from '../src/lib/templateRules.js';
import { builderReducer } from '../src/lib/builderState.js';
import { duplicateSequence, templateParamCount } from '../src/lib/sequenceDraft.js';

const h = React.createElement;
const webapp = fileURLToPath(new URL('..', import.meta.url));
let dom, createRoot, components, tempDir, root;
const sequence = (name = 'Welcome') => ({ id: name, key: name.toLowerCase(), name, steps: [
  { id: `${name}-1`, template: 'hello', language: 'en', params: [], waitDays: 0, waitHours: 0 },
] });
const templates = [{ name: 'hello', language: 'en', params_count: 0, body: 'Hello!' }];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const api = (name, fn) => { globalThis.__businessApi[name] = fn; };

before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/?locale=en', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'MutationObserver', 'localStorage', 'getComputedStyle']) {
    globalThis[key] = key === 'getComputedStyle' ? dom.window[key].bind(dom.window) : dom.window[key];
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  URL.createObjectURL = () => 'blob:test-upload';
  URL.revokeObjectURL = () => {};
  ({ createRoot } = await import('react-dom/client'));
  tempDir = await mkdtemp(join(webapp, 'node_modules', '.business-screens-test-'));
  const outfile = join(tempDir, 'screens.mjs');
  const screens = ['SequenceEditor', 'TemplateAccessModal', 'TemplateBuilder', 'TemplatesView', 'AssignSequenceModal', 'BulkEnrollModal', 'EnrollmentsView', 'journeys/JourneysScreen', 'journeys/JourneyEditor', 'journeys/RunsModal'];
  await build({
    stdin: { contents: screens.map((path) => `export {default as ${path.split('/').at(-1)}} from './src/components/${path}.jsx';`).join('\n') + '\nexport {ToastProvider} from "./src/components/ui/Toast.jsx"; export {default as App} from "./src/App.jsx";', resolveDir: webapp },
    outfile, bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'business-api-boundaries', setup(b) {
      b.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty-css', namespace: 'css-test' }));
      b.onLoad({ filter: /.*/, namespace: 'css-test' }, () => ({ contents: '' }));
      b.onLoad({ filter: /src\/useVersionCheck\.js$/ }, () => ({ contents: 'export default () => ({updateAvailable:false,enabledModules:null,modulesReady:true});' }));
      b.onLoad({ filter: /src\/useChatwootContext\.js$/ }, () => ({ contents: 'export default () => ({conversation:null,contact:null,agent:null,isEmbedded:false});' }));
      b.onLoad({ filter: /src\/api\/(sequencesApi|templatesApi|journeysApi)\.js$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8');
        const module = path.split('/').at(-1).replace('.js', '');
        return { contents: [...source.matchAll(/export async function (\w+)/g)].map(([, name]) =>
          `export async function ${name}(...args) { return globalThis.__businessApi[${JSON.stringify(`${module}.${name}`)}](...args); }`).join('\n') };
      });
      // The browser graph renderer needs layout. Keep business editor/state real,
      // replacing only the canvas with selectable nodes; pure graph tests cover edges.
      b.onResolve({ filter: /^@xyflow\/react$/ }, () => ({ path: 'graph-test-adapter', namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ resolveDir: webapp, contents: `
        import React from 'react';
        export function ReactFlow({nodes,onNodesChange,children}) { return React.createElement('div',null,
          nodes.map(n=>React.createElement('button',{key:n.id,'aria-label':'flow-node-'+n.id,onClick:()=>onNodesChange(nodes.map(x=>({id:x.id,type:'select',selected:x.id===n.id})))},n.id)),children); }
        export const Background=()=>null, Controls=()=>null, Handle=()=>null;
        export const Position={Top:'top',Bottom:'bottom'}, MarkerType={ArrowClosed:'arrowclosed'};
        export const applyNodeChanges=(changes,nodes)=>nodes.map(n=>({...n,...changes.find(c=>c.id===n.id),type:n.type}));
        export const applyEdgeChanges=(_,edges)=>edges;
        export const addEdge=(edge,edges)=>[...edges,edge];
      ` }));
    } }],
  });
  components = await import(pathToFileURL(outfile).href);
});

beforeEach(() => {
  globalThis.__businessApi = new Proxy({}, { get: (target, name) => target[name] || (async () => []) });
  localStorage.clear();
  window.history.replaceState(null, '', '/?locale=en');
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  document.body.replaceChildren();
});
after(async () => {
  dom?.window.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});
async function render(name, props, strict = false) {
  if (!root) { const el = document.createElement('div'); document.body.append(el); root = createRoot(el); }
  const element = h(components.ToastProvider, null, h(components[name], props));
  await act(async () => root.render(strict ? h(React.StrictMode, null, element) : element));
  await flush();
}
async function flush(ms = 10) { await act(async () => new Promise((resolve) => setTimeout(resolve, ms))); }
async function settle(request, value, reject = false) { await act(async () => request[reject ? 'reject' : 'resolve'](value)); await flush(); }
const button = (name) => [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === name || el.textContent.trim() === name);
async function click(el) { assert.ok(el, 'control exists'); await act(async () => (el.querySelector('button') || el).click()); }
async function type(el, value) {
  const prototype = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })); });
}
async function upload(file = new window.File(['data'], 'photo.jpg', { type: 'image/jpeg' })) {
  const input = document.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new window.Event('change', { bubbles: true })));
}
const validTemplate = () => ({ ...emptyTemplate(), name: 'welcome', language: 'en', body: { text: 'Hello friend!', examples: [] } });
const wabaCtx = { wabaId: 'w1', inboxes: [{ inboxId: 1 }] };

test('duplicating a sequence never reuses an upsert key and keeps the original independent', () => {
  const original = { ...sequence(), enabled: true, enrollEnabled: true, sendEnabled: true };
  const a = duplicateSequence(original, 'copy');
  const b = duplicateSequence(original, 'copy');
  assert.equal(a.key, ''); assert.equal(b.key, ''); assert.equal(a.id, null);
  assert.equal(a.enabled, false); assert.equal(a.enrollEnabled, false); assert.equal(a.sendEnabled, false);
  a.steps[0].template = 'changed';
  assert.equal(original.steps[0].template, 'hello');
});

test('reselecting the current header or authentication category preserves entered content', () => {
  const tpl = { ...validTemplate(), category: 'AUTHENTICATION', auth: { otpType: 'one_tap', packageName: 'app.example' }, header: { format: 'TEXT', text: 'Keep me' } };
  assert.equal(builderReducer(tpl, { type: 'set_header', field: 'format', value: 'TEXT' }).header.text, 'Keep me');
  assert.equal(builderReducer(tpl, { type: 'set_field', field: 'category', value: 'AUTHENTICATION' }).auth.packageName, 'app.example');
});

test('sequence parameter fallback counts positional slots, including repeated and reordered placeholders', () => {
  assert.equal(templateParamCount({ body: 'Hello {{1}}, again {{1}}' }), 1);
  assert.equal(templateParamCount({ body: '{{2}} comes before {{1}}' }), 2);
  assert.equal(templateParamCount({ body: '{{3}}' }), 3);
  assert.equal(templateParamCount({ params_count: 0, body: '{{1}}' }), 0);
});

test('failed permission loading cannot replace existing grants, and Retry recovers', async () => {
  let saves = 0;
  api('templatesApi.listAccountAgents', async () => { throw new Error('offline'); });
  api('templatesApi.listTemplateAccess', async () => ({ user_ids: [7] }));
  api('templatesApi.saveTemplateAccess', async () => { saves++; });
  await render('TemplateAccessModal', { open: true, accountId: 1 });
  assert.equal(button('Save').disabled, true);
  await click(button('Save')); assert.equal(saves, 0);
  api('templatesApi.listAccountAgents', async () => [{ id: 7, name: 'Agent', role: 'agent' }]);
  await click(button('Retry'));
  assert.equal(button('Save').disabled, false);
  assert.equal(document.querySelector('[role=switch]').getAttribute('aria-checked'), 'true');
});

test('late permission requests cannot show agents from the previous account', async () => {
  const old = deferred();
  api('templatesApi.listAccountAgents', (id) => id === 1 ? old.promise : Promise.resolve([{ id: 8, name: 'Current', role: 'agent' }]));
  await render('TemplateAccessModal', { open: true, accountId: 1 });
  await render('TemplateAccessModal', { open: true, accountId: 2 });
  await settle(old, [{ id: 7, name: 'Previous', role: 'agent' }]);
  assert.match(document.body.textContent, /Current/); assert.doesNotMatch(document.body.textContent, /Previous/);
});

test('removing a step creates one Undo in StrictMode and switching drafts retires it', async () => {
  const first = { ...sequence(), steps: [...sequence().steps, { ...sequence().steps[0], id: 'second' }] };
  await render('SequenceEditor', { open: true, sequence: first, templates }, true);
  await click(document.querySelector('[aria-label="Delete step"]'));
  assert.equal([...document.querySelectorAll('[data-modal-focus-scope] button')].filter((el) => el.textContent === 'Cancel').length, 1);
  await render('SequenceEditor', { open: true, sequence: sequence('Another'), templates }, true);
  assert.equal(document.querySelector('[data-modal-focus-scope]'), null);
  assert.match(document.querySelector('[role=dialog]').textContent, /Sequence steps \(1\)/);
  await render('SequenceEditor', { open: false, sequence: null, templates }, true);
  assert.equal(document.querySelector('[data-modal-focus-scope]'), null);
});

test('invalid media blocks sequence Save and a pending save disables editable controls', async () => {
  const saving = deferred(); let calls = 0;
  const seq = { ...sequence(), steps: [{ ...sequence().steps[0], mediaUrl: 'http://insecure.test/a.jpg' }] };
  const props = { open: true, sequence: seq, templates: [{ ...templates[0], header_format: 'IMAGE' }], onSave: () => { calls++; return saving.promise; } };
  await render('SequenceEditor', props);
  assert.equal(button('Save').disabled, true);
  await render('SequenceEditor', { ...props, sequence: { ...seq, steps: [{ ...seq.steps[0], mediaUrl: 'https://example.test/a.jpg' }] } });
  await click(button('Save'));
  assert.equal(calls, 1);
  assert.equal(document.querySelector('[role=dialog] fieldset').disabled, true);
  await settle(saving, {});
  assert.equal(document.querySelector('[role=dialog] fieldset').disabled, false);
});

test('template submission prevents cancel/edit races and retries with the preserved draft', async () => {
  const saving = deferred(); let cancels = 0;
  api('templatesApi.createTemplate', () => saving.promise);
  await render('TemplateBuilder', { accountId: 1, wabaCtx, initial: validTemplate(), onCancel: () => { cancels++; } });
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(document.querySelector('fieldset').disabled, true);
  await click(button('Cancel')); assert.equal(cancels, 0);
  await settle(saving, new Error('Create unavailable'), true);
  assert.equal(document.querySelector('fieldset').disabled, false);
  assert.match(document.body.textContent, /Create unavailable/);
  assert.equal(document.querySelector('input').value, 'welcome');
});

test('changing template header format discards a late media upload', async () => {
  const pending = deferred(); let payload;
  api('templatesApi.createTemplate', async (_account, _inbox, tpl) => { payload = tpl; });
  api('templatesApi.uploadExample', () => pending.promise);
  const initial = { ...validTemplate(), header: { format: 'IMAGE', text: '', example: '', mediaHandle: '' } };
  await render('TemplateBuilder', { accountId: 1, wabaCtx, initial });
  await upload();
  await click(button('Video'));
  await settle(pending, { handle: 'old-image-handle' });
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  const header = payload.components.find((c) => c.type === 'HEADER');
  assert.equal(header.format, 'VIDEO');
  assert.equal(header.example, undefined, 'the old image handle is not attached to the new video format');
  assert.doesNotMatch(document.body.textContent, /old-image-handle/);
  assert.ok(document.querySelector('input[type=file]'));
  assert.equal(document.querySelector('input[type=file]').accept.includes('video'), true);
});

test('contact search failures are distinct from empty results and offer Retry', async () => {
  api('sequencesApi.searchContacts', async () => { throw new Error('offline'); });
  await render('AssignSequenceModal', { open: true, accountId: 1 });
  await flush(280);
  assert.match(document.querySelector('[role=alert]').textContent, /Contact search failed/);
  assert.doesNotMatch(document.body.textContent, /No contacts found/);
  api('sequencesApi.searchContacts', async () => [{ contact_id: 9, name: 'Found contact' }]);
  await click(button('Retry')); await flush(280);
  assert.match(document.body.textContent, /Found contact/);
});

test('refreshing the same contact object does not erase a chosen sequence', async () => {
  const props = { open: true, accountId: 1, contact: { contact_id: 9, name: 'Lead' }, sequences: [{ key: 'welcome', name: 'Welcome', enrollEnabled: true }] };
  await render('AssignSequenceModal', props);
  await click(button('Select sequence')); await click(document.querySelector('[role=option][data-value="welcome"]') || [...document.querySelectorAll('[role=option]')].find(el => el.textContent.includes('Welcome')));
  await render('AssignSequenceModal', { ...props, contact: { ...props.contact } });
  assert.match(button('Select sequence').textContent, /Welcome/);
});

test('bulk assignment locks dialog dismissal and rejects late label responses', async () => {
  const old = deferred(), running = deferred(); let closes = 0;
  api('sequencesApi.listLabels', (id) => id === 1 ? old.promise : Promise.resolve([{ label: 'Current label', count: 4 }]));
  api('sequencesApi.bulkEnroll', () => running.promise);
  const props = { open: true, accountId: 1, sequences: [{ key: 'welcome', name: 'Welcome', enrollEnabled: true }], onClose: () => { closes++; } };
  await render('BulkEnrollModal', props);
  await render('BulkEnrollModal', { ...props, accountId: 2 });
  await settle(old, [{ label: 'Previous label', count: 8 }]);
  await click(button('Select label')); await click([...document.querySelectorAll('[role=option]')].find(el => el.textContent.includes('Current label')));
  await click(button('Select sequence')); await click([...document.querySelectorAll('[role=option]')].find(el => el.textContent.includes('Welcome')));
  await click(button('Assign 4 contacts'));
  await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  assert.equal(closes, 0); assert.equal(button('Select label').disabled, true);
  await settle(running, { count: 4, total: 4 });
  assert.match(document.body.textContent, /4 contacts were assigned/);
});

test('flow open locks competing navigation and ignores a previous account response', async () => {
  const pending = deferred();
  api('journeysApi.listJourneys', (id) => Promise.resolve([{ id, name: id === 1 ? 'First' : 'Current', status: 'draft' }]));
  api('journeysApi.getJourney', () => pending.promise);
  await render('JourneysScreen', { accountId: 1 });
  await click(button('Edit First'));
  assert.equal(button('New flow').disabled, true);
  await render('JourneysScreen', { accountId: 2 });
  await settle(pending, { id: 1, name: 'First', graph: { nodes: [], start: null } });
  assert.ok(button('Edit Current')); assert.equal(document.querySelector('input[placeholder="Flow name…"]'), null);
});

test('failed flow deletion returns an actionable visible error with its row intact', async () => {
  api('journeysApi.listJourneys', async () => [{ id: 1, name: 'First', status: 'draft' }]);
  api('journeysApi.deleteJourney', async () => { throw new Error('Delete unavailable'); });
  await render('JourneysScreen', { accountId: 1 });
  await click(button('Delete First')); await click(button('Delete'));
  assert.equal(document.querySelector('[role=dialog]'), null);
  assert.match(document.body.textContent, /Delete unavailable/); assert.ok(button('Edit First'));
});

test('activation does not publish an obsolete graph after edits made during its save', async () => {
  const pending = deferred(); let activations = 0;
  api('journeysApi.saveJourney', () => pending.promise);
  api('journeysApi.setJourneyStatus', async () => { activations++; return { status: 'active' }; });
  const journey = { id: 1, name: 'First', status: 'draft', graph: { nodes: [{ id: 'trigger', type: 'trigger', data: {} }, { id: 'm1', type: 'message', data: { text: 'Hello' } }], edges: [{ source: 'trigger', target: 'm1' }] } };
  await render('JourneyEditor', { accountId: 1, journey });
  const input = document.querySelector('input[placeholder="Flow name…"]');
  await type(input, 'Before save'); await click(button('Activate'));
  await type(input, 'After save');
  await settle(pending, { id: 1, status: 'draft' });
  assert.equal(activations, 0); assert.match(document.body.textContent, /changed while saving/);
  assert.match(document.body.textContent, /Unsaved changes/); assert.equal(input.value, 'After save');
});

test('run loading failure offers retry without claiming the flow has no runs', async () => {
  api('journeysApi.listJourneyRuns', async () => { throw new Error('Runs unavailable'); });
  await render('RunsModal', { open: true, accountId: 1, journey: { id: 1, name: 'Flow' } });
  assert.ok(button('Retry')); assert.doesNotMatch(document.body.textContent, /No runs for this flow/);
  api('journeysApi.listJourneyRuns', async () => [{ id: 9, display_id: 12, status: 'done' }]);
  await click(button('Retry')); assert.match(document.body.textContent, /#12/);
});

test('template list preserves per-account WABA selection and ignores old account responses', async () => {
  const old = deferred();
  let loads = 0;
  localStorage.setItem('tpl_waba_2', 'wanted');
  api('templatesApi.listTemplates', (id) => id === 1 ? (++loads === 1 ? Promise.resolve({ wabas: [{ wabaId: 'old', templates: [] }] }) : old.promise) : Promise.resolve({ wabas: [
    { wabaId: 'other', templates: [{ name: 'other_template', language: 'en', status: 'APPROVED' }] },
    { wabaId: 'wanted', templates: [{ name: 'wanted_template', language: 'en', status: 'APPROVED' }] },
  ] }));
  await render('TemplatesView', { accountId: 1 });
  await click(button('Refresh'));
  await render('TemplatesView', { accountId: 2 });
  await settle(old, { wabas: [{ wabaId: 'old', templates: [{ name: 'old_template', language: 'en' }] }] });
  assert.match(document.body.textContent, /wanted_template/); assert.doesNotMatch(document.body.textContent, /old_template/);
  assert.equal(localStorage.getItem('tpl_waba_2'), 'wanted');
});

test('sequence switches serialize full-document updates and recover correctly after failure', async () => {
  window.history.replaceState(null, '', '/?locale=en&tab=sequences&account_id=1');
  const pending = deferred(); let saves = 0;
  const original = { ...sequence(), enabled: true, enrollEnabled: true, sendEnabled: true };
  api('sequencesApi.listSequences', async () => [original]);
  api('sequencesApi.listTemplates', async () => templates);
  api('sequencesApi.saveSequence', () => { saves++; return pending.promise; });
  await render('App', {});
  const switches = [...document.querySelectorAll('[role=switch]')];
  assert.equal(switches.length, 2);
  await click(switches[0]); await click(switches[1]);
  assert.equal(saves, 1); assert.equal(switches[1].disabled, true);
  await settle(pending, new Error('Update failed'), true);
  assert.equal(switches[0].getAttribute('aria-checked'), 'true');
  assert.equal(switches[1].disabled, false);
  assert.match(document.body.textContent, /Update failed/);
});

test('duplicating the same listed sequence twice submits two distinct keys', async () => {
  window.history.replaceState(null, '', '/?locale=en&tab=sequences&account_id=1');
  const savedKeys = [];
  api('sequencesApi.listSequences', async () => [sequence()]);
  api('sequencesApi.listTemplates', async () => templates);
  api('sequencesApi.saveSequence', async (draft) => { savedKeys.push(draft.key); return { ...draft, id: savedKeys.length + 1 }; });
  await render('App', {});
  await click(button('Duplicate Welcome')); await click(button('Save'));
  await click(button('Duplicate Welcome')); await click(button('Save'));
  assert.equal(savedKeys.length, 2); assert.notEqual(savedKeys[0], savedKeys[1]);
  assert.ok(savedKeys.every((key) => key && key !== 'welcome_copy'));
});

test('a replacement template upload blocks submission until the new handle is ready', async () => {
  const pending = deferred(); let payload;
  api('templatesApi.uploadExample', () => pending.promise);
  api('templatesApi.createTemplate', async (_account, _inbox, template) => { payload = template; });
  await render('TemplateBuilder', { accountId: 1, wabaCtx, initial: { ...validTemplate(), header: { format: 'IMAGE', mediaHandle: 'old-handle' } } });
  await upload();
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(payload, undefined);
  await settle(pending, { handle: 'new-handle' });
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.deepEqual(payload.components.find((c) => c.type === 'HEADER').example.header_handle, ['new-handle']);
});

test('a carousel upload cannot overwrite the card now occupying a removed card index', async () => {
  const pending = deferred(); let payload;
  api('templatesApi.uploadExample', () => pending.promise);
  api('templatesApi.createTemplate', async (_account, _inbox, tpl) => { payload = tpl; });
  const card = (handle) => ({ headerFormat: 'IMAGE', mediaHandle: handle, body: 'Card content', examples: [], buttons: [{ type: 'QUICK_REPLY', text: 'Choose' }] });
  await render('TemplateBuilder', { accountId: 1, wabaCtx, initial: { ...validTemplate(), carousel: { cards: [card('first'), card('second'), card('third')] } } });
  await upload();
  await click(button('Remove'));
  await settle(pending, { handle: 'stale-first' });
  await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.deepEqual(payload.components.find((c) => c.type === 'CAROUSEL').cards.map((c) => c.components[0].example.header_handle[0]), ['second', 'third']);
});

test('enrollment loading errors recover with Refresh and old account data stays out', async () => {
  const pending = deferred(); let oldLoads = 0;
  api('sequencesApi.listEnrollments', (id) => {
    if (id === 1) return ++oldLoads === 1 ? Promise.reject(new Error('Contacts unavailable')) : pending.promise;
    return Promise.resolve([{ id: 2, contact_id: 8, contact_name: 'Current contact', status: 'active', steps_total: 1, step_index: 0 }]);
  });
  await render('EnrollmentsView', { accountId: 1 });
  assert.match(document.querySelector('[role=alert]').textContent, /Contacts unavailable/);
  await click(button('Refresh'));
  await render('EnrollmentsView', { accountId: 2 });
  await settle(pending, [{ id: 1, contact_name: 'Previous contact', status: 'active' }]);
  assert.match(document.body.textContent, /Current contact/); assert.doesNotMatch(document.body.textContent, /Previous contact/);
});

test('flow media upload preserves text edited while it was pending and respects later manual URLs', async () => {
  let pending = deferred(), saved;
  api('sequencesApi.uploadMedia', () => pending.promise);
  api('journeysApi.saveJourney', async (_account, value) => { saved = value; return { id: 1, status: 'draft' }; });
  const journey = { id: 1, name: 'First', status: 'draft', graph: { nodes: [{ id: 'trigger', type: 'trigger', data: {} }, { id: 'm1', type: 'message', data: { text: 'Old text' } }], edges: [{ source: 'trigger', target: 'm1' }] } };
  await render('JourneyEditor', { accountId: 1, journey });
  await click(button('flow-node-m1')); await upload();
  assert.equal(button('Save').disabled, true);
  await type(document.querySelector('aside textarea'), 'Text entered while uploading');
  await settle(pending, { url: 'https://example.test/new.jpg' });
  await click(button('Save'));
  assert.equal(saved.graph.nodes.find((n) => n.id === 'm1').data.text, 'Text entered while uploading');
  assert.equal(saved.graph.nodes.find((n) => n.id === 'm1').data.mediaUrl, 'https://example.test/new.jpg');

  pending = deferred(); await upload();
  await type(document.querySelector('aside input[placeholder="https://…"]'), 'https://example.test/manual.jpg');
  await settle(pending, { url: 'https://example.test/late.jpg' });
  await click(button('Save'));
  assert.equal(saved.graph.nodes.find((n) => n.id === 'm1').data.mediaUrl, 'https://example.test/manual.jpg');
});
