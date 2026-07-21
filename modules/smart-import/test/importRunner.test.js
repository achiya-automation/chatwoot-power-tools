import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runImport, createImportJob } from '../lib/importRunner.js';

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

test('assigns a contact label when Chatwoot returns the real nested create response', async () => {
  const labeled = [];
  const api = fakeApi({
    createContact: async () => ({ payload: { contact: { id: 321 } } }),
    assignLabels: async (id, labels) => { labeled.push({ id, labels }); return {}; },
  });

  await runImport({
    contacts: [{ name: 'דנה', phone_number: '+97250', __row: 1 }],
    api,
    labelTitle: 'לקוחות-חדשים',
    sleep: async () => {},
  });

  assert.deepEqual(labeled, [{ id: 321, labels: ['לקוחות-חדשים'] }]);
});

test('bulk import labels all 320 contacts, including 310 newly created contacts', async () => {
  const labeled = [];
  let nextCreatedId = 2000;
  const contacts = Array.from({ length: 320 }, (_, i) => ({
    name: `Contact ${i + 1}`,
    phone_number: `+9725${String(i).padStart(7, '0')}`,
    __row: i + 2,
    __match: i < 10 ? { id: 1000 + i } : null,
  }));
  const api = fakeApi({
    createContact: async () => ({ payload: { contact: { id: nextCreatedId++ } } }),
    assignLabels: async (id, labels) => { labeled.push({ id, labels }); return {}; },
  });

  const log = await runImport({
    contacts,
    api,
    labelTitle: 'ייבוא-גדול',
    sleep: async () => {},
  });

  assert.deepEqual(log.summary(), { created: 310, updated: 10, skipped: 0, failed: 0, total: 320 });
  assert.equal(labeled.length, 320);
  assert.ok(labeled.every(({ labels }) => labels.includes('ייבוא-גדול')));
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

// ── Concurrency / backoff / cancel / dup-tail ────────────────────────────────

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('runs the pool concurrently, capped at the concurrency limit', async () => {
  let inFlight = 0;
  let peak = 0;
  const api = fakeApi({
    createContact: async (c) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await tick(5);
      inFlight--;
      return { id: 100, ...c };
    },
  });
  const contacts = Array.from({ length: 12 }, (_, i) => ({
    name: `c${i}`, phone_number: `+9725${i}`, __row: i + 2, __match: null,
  }));
  const log = await runImport({ contacts, api, concurrency: 4 });
  assert.equal(log.summary().created, 12);
  assert.equal(peak, 4); // all 4 workers claim a row in the same tick
});

test('429 pauses on the shared cooldown and retries the request', async () => {
  let calls = 0;
  const api = fakeApi({
    createContact: async (c) => {
      calls++;
      if (calls === 1) { const e = new Error('throttled'); e.status = 429; throw e; }
      return { id: 9, ...c };
    },
  });
  const log = await runImport({
    contacts: [{ name: 'x', phone_number: '+97250', __row: 2, __match: null }],
    api, sleep: async () => {},
  });
  assert.equal(calls, 2);
  assert.deepEqual(log.summary(), { created: 1, updated: 0, skipped: 0, failed: 0, total: 1 });
});

test('non-429 errors are not retried', async () => {
  let calls = 0;
  const api = fakeApi({
    createContact: async () => { calls++; const e = new Error('nope'); e.status = 422; e.body = 'invalid'; throw e; },
  });
  const log = await runImport({
    contacts: [{ name: 'x', phone_number: '+97250', __row: 2, __match: null }],
    api, sleep: async () => {},
  });
  assert.equal(calls, 1);
  assert.equal(log.summary().failed, 1);
});

test('cancel stops claiming new rows; finished rows stay logged', async () => {
  let cancelled = false;
  const api = fakeApi({
    createContact: async (c) => { cancelled = true; return { id: 100, ...c }; },
  });
  const contacts = Array.from({ length: 10 }, (_, i) => ({
    name: `c${i}`, phone_number: `+9725${i}`, __row: i + 2, __match: null,
  }));
  const log = await runImport({ contacts, api, concurrency: 1, isCancelled: () => cancelled });
  assert.equal(log.rows.length, 1);
  assert.equal(log.summary().created, 1);
});

test('__dupTail rows run serially after the pool with a fresh filter', async () => {
  const order = [];
  const api = fakeApi({
    filterContacts: async () => { order.push('filter'); return { payload: [{ id: 42, phone_number: '+97250' }] }; },
    createContact: async (c) => { order.push('create'); return { id: 42, ...c }; },
    updateContact: async (id) => { order.push(`update:${id}`); return { id }; },
  });
  const log = await runImport({
    contacts: [
      { name: 'א', phone_number: '+97250', __row: 2, __match: null },
      { name: 'ב', phone_number: '+97250', __row: 3, __dupTail: true },
    ],
    api,
  });
  assert.deepEqual(order, ['create', 'filter', 'update:42']);
  assert.equal(log.summary().created, 1);
  assert.equal(log.summary().updated, 1);
});

test('createImportJob: live progress, summary counts, done state', async () => {
  const api = fakeApi();
  const job = createImportJob({
    contacts: [
      { name: 'א', phone_number: '+97250', __row: 2, __match: null },
      { name: 'ב', phone_number: '+97251', __row: 3, __match: { id: 7 } },
    ],
    api,
  });
  const states = [];
  job.onUpdate((p) => states.push({ done: p.done, state: p.state }));
  const log = await job.promise;
  assert.equal(job.progress.state, 'done');
  assert.equal(job.progress.created, 1);
  assert.equal(job.progress.updated, 1);
  assert.equal(job.progress.done, 2);
  assert.equal(log, job.log);
  assert.equal(states[states.length - 1].state, 'done');
});

test('createImportJob: cancel mid-run ends in cancelled state with partial counts', async () => {
  const api = fakeApi({
    createContact: async (c) => { await tick(2); return { id: 100, ...c }; },
  });
  const contacts = Array.from({ length: 6 }, (_, i) => ({
    name: `c${i}`, phone_number: `+9725${i}`, __row: i + 2, __match: null,
  }));
  const job = createImportJob({ contacts, api, concurrency: 1 });
  const un = job.onUpdate(() => { job.cancel(); un(); }); // cancel on the first progress event
  await job.promise;
  assert.equal(job.progress.state, 'cancelled');
  assert.ok(job.progress.done >= 1 && job.progress.done < 6, `done=${job.progress.done}`);
  assert.equal(job.log.rows.length, job.progress.done);
});

test('createImportJob: a listener that throws does not break the job', async () => {
  const job = createImportJob({
    contacts: [{ name: 'א', phone_number: '+97250', __row: 2, __match: null }],
    api: fakeApi(),
  });
  job.onUpdate(() => { throw new Error('bad listener'); });
  await job.promise;
  assert.equal(job.progress.state, 'done');
  assert.equal(job.progress.created, 1);
});

test('links the imported contact to the WhatsApp inbox with a digits-only source_id', async () => {
  const links = [];
  const api = fakeApi({ createContactInbox: async (id, body) => { links.push({ id, body }); return {}; } });
  await runImport({
    contacts: [{ name: 'דנה', phone_number: '+972501234567', __row: 1 }],
    api, waInboxId: 7, sleep: async () => {},
  });
  assert.deepEqual(links, [{ id: 100, body: { inbox_id: 7, source_id: '972501234567' } }]);
});

test('skips inbox linking when no WhatsApp inbox was resolved', async () => {
  const links = [];
  const api = fakeApi({ createContactInbox: async (...a) => { links.push(a); return {}; } });
  await runImport({ contacts: [{ name: 'דנה', phone_number: '+972501234567', __row: 1 }], api, sleep: async () => {} });
  assert.equal(links.length, 0);
});

test('a contact already linked to the inbox never fails the imported row', async () => {
  const api = fakeApi({ createContactInbox: async () => { const e = new Error('taken'); e.status = 422; throw e; } });
  const log = await runImport({
    contacts: [{ name: 'דנה', phone_number: '+972501234567', __row: 1 }],
    api, waInboxId: 7, sleep: async () => {},
  });
  assert.deepEqual(log.summary(), { created: 1, updated: 0, skipped: 0, failed: 0, total: 1 });
});
