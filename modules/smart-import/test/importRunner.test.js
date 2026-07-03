import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runImport } from '../lib/importRunner.js';

function fakeApi(overrides = {}) {
  return {
    filterContacts: async () => ({ payload: [] }),
    createContact: async (c) => ({ id: 100, ...c }),
    updateContact: async (id, c) => ({ id, ...c }),
    assignLabels: async () => ({}),
    getContactLabels: async () => ({ payload: [] }),
    ...overrides,
  };
}

test('creates a new contact when filter finds nothing', async () => {
  const log = await runImport({
    contacts: [{ name: 'דנה', phone_number: '+97250', __row: 1 }],
    api: fakeApi(), sleep: async () => {},
  });
  assert.deepEqual(log.summary(), { created: 1, updated: 0, skipped: 0, failed: 0, total: 1 });
});

test('updates when filter finds an existing contact (merge)', async () => {
  let updated = null;
  const api = fakeApi({
    filterContacts: async () => ({ payload: [{ id: 55, phone_number: '+97250' }] }),
    updateContact: async (id, c) => { updated = { id, c }; return { id }; },
  });
  const log = await runImport({ contacts: [{ name: 'דנה', phone_number: '+97250', __row: 1 }], api, sleep: async () => {} });
  assert.equal(updated.id, 55);
  assert.equal(log.summary().updated, 1);
});

test('skips a contact with no name and no dedup key', async () => {
  const log = await runImport({ contacts: [{ __row: 1, additional_attributes: { city: 'חיפה' } }], api: fakeApi(), sleep: async () => {} });
  assert.equal(log.summary().skipped, 1);
});

test('records failure with reason on API error', async () => {
  const api = fakeApi({ createContact: async () => { const e = new Error('x'); e.status = 422; e.body = 'Email taken'; throw e; } });
  const log = await runImport({ contacts: [{ name: 'דנה', email: 'a@b.com', __row: 3 }], api, sleep: async () => {} });
  const s = log.summary();
  assert.equal(s.failed, 1);
  assert.match(log.rows[0].reason, /Email taken|422/);
});

test('assigns label to created/updated contacts', async () => {
  const labeled = [];
  const api = fakeApi({ assignLabels: async (id, labels) => { labeled.push({ id, labels }); return {}; } });
  await runImport({ contacts: [{ name: 'דנה', phone_number: '+97250', __row: 1 }], api, labelTitle: 'ייבוא-יוני', sleep: async () => {} });
  assert.deepEqual(labeled[0], { id: 100, labels: ['ייבוא-יוני'] });
});

test('reports progress', async () => {
  const seen = [];
  await runImport({ contacts: [{ name: 'a', phone_number: '+97250', __row: 1 }, { name: 'b', phone_number: '+97251', __row: 2 }], api: fakeApi(), onProgress: (d, t) => seen.push([d, t]), sleep: async () => {} });
  assert.deepEqual(seen[seen.length - 1], [2, 2]);
});

test('a failed contact does not abort the run', async () => {
  let n = 0;
  const api = fakeApi({
    createContact: async (c) => { n++; if (n === 1) { const e = new Error('x'); e.status = 422; e.body = 'Email taken'; throw e; } return { id: 200, ...c }; },
  });
  const log = await runImport({
    contacts: [{ name: 'גיל', email: 'g@x.com', __row: 1 }, { name: 'דנה', email: 'd@x.com', __row: 2 }],
    api, sleep: async () => {},
  });
  const s = log.summary();
  assert.equal(s.failed, 1);
  assert.equal(s.created, 1);
});

test('assigns label on the update path (union with existing labels)', async () => {
  const labeled = [];
  const api = fakeApi({
    filterContacts: async () => ({ payload: [{ id: 77, phone_number: '+97250' }] }),
    getContactLabels: async () => ({ payload: ['קיים'] }),
    assignLabels: async (id, labels) => { labeled.push({ id, labels }); return {}; },
  });
  await runImport({ contacts: [{ name: 'דנה', phone_number: '+97250', __row: 1 }], api, labelTitle: 'יבוא', sleep: async () => {} });
  assert.equal(labeled[0].id, 77);
  assert.ok(labeled[0].labels.includes('קיים'), 'existing label must be preserved');
  assert.ok(labeled[0].labels.includes('יבוא'), 'new label must be added');
  assert.equal(labeled[0].labels.length, 2);
});

test('update path: does not duplicate label if already present', async () => {
  const labeled = [];
  const api = fakeApi({
    filterContacts: async () => ({ payload: [{ id: 88, phone_number: '+97250' }] }),
    getContactLabels: async () => ({ payload: ['יבוא'] }),
    assignLabels: async (id, labels) => { labeled.push({ id, labels }); return {}; },
  });
  await runImport({ contacts: [{ name: 'דנה', phone_number: '+97250', __row: 1 }], api, labelTitle: 'יבוא', sleep: async () => {} });
  assert.equal(labeled[0].labels.length, 1);
  assert.deepEqual(labeled[0].labels, ['יבוא']);
});

test('update path: getContactLabels failure falls back to new label only', async () => {
  const labeled = [];
  const api = fakeApi({
    filterContacts: async () => ({ payload: [{ id: 99, phone_number: '+97250' }] }),
    getContactLabels: async () => { throw new Error('network error'); },
    assignLabels: async (id, labels) => { labeled.push({ id, labels }); return {}; },
  });
  await runImport({ contacts: [{ name: 'דנה', phone_number: '+97250', __row: 1 }], api, labelTitle: 'יבוא', sleep: async () => {} });
  assert.deepEqual(labeled[0].labels, ['יבוא']);
});

test('precomputed __match (existing contact) skips filterContacts and updates', async () => {
  let updated = null;
  const api = fakeApi({
    filterContacts: async () => { throw new Error('filterContacts must not be called when __match is precomputed'); },
    updateContact: async (id, c) => { updated = { id, c }; return { id }; },
  });
  const log = await runImport({
    contacts: [{ name: 'דנה', phone_number: '+97250', __row: 1, __match: { id: 99, phone_number: '+97250' } }],
    api, sleep: async () => {},
  });
  assert.equal(updated.id, 99);
  assert.equal(log.summary().updated, 1);
  assert.equal(log.summary().created, 0);
});

test('precomputed __match: null creates without calling filterContacts', async () => {
  let created = null;
  const api = fakeApi({
    filterContacts: async () => { throw new Error('filterContacts must not be called when __match is precomputed'); },
    createContact: async (c) => { created = c; return { id: 200, ...c }; },
  });
  const log = await runImport({
    contacts: [{ name: 'גיל', phone_number: '+97251', __row: 1, __match: null }],
    api, sleep: async () => {},
  });
  assert.ok(created);
  assert.equal(log.summary().created, 1);
  assert.equal(log.summary().updated, 0);
});
