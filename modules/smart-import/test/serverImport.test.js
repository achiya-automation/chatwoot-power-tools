import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServerJob, wireRow } from '../lib/serverImport.js';

// api.smartImportStatus scripted per call; sleep resolves instantly so the poll loop
// spins through the script without real timers.
function scriptedApi(statuses, overrides = {}) {
  let i = 0;
  return {
    calls: { cancel: 0 },
    smartImportStatus: async function () {
      const s = statuses[Math.min(i++, statuses.length - 1)];
      if (s instanceof Error) throw s;
      return s;
    },
    smartImportCancel: async function () { this.calls.cancel++; },
    ...overrides,
  };
}

function err(status) {
  const e = new Error(`API ${status}`);
  e.status = status;
  return e;
}

test('wireRow strips wizard meta and renames row/phone keys', () => {
  const out = wireRow({
    name: 'דנה', phone_number: '+972501234567',
    __row: 7, __match: { id: 3 }, __dupTail: true, __phoneRaw: '050-123',
  });
  assert.deepEqual(out, { name: 'דנה', phone_number: '+972501234567', row_num: 7, phone_raw: '050-123' });
  assert.equal(wireRow({ name: 'x', __row: 2 }).phone_raw, undefined);
});

test('polls to done, exposes counts, email and a working ImportLog', async () => {
  const api = scriptedApi([
    { state: 'queued', done: 0, total: 3, created: 0, updated: 0, skipped: 0, failed: 0, email: 'a@b.co' },
    { state: 'running', done: 2, total: 3, created: 1, updated: 1, skipped: 0, failed: 0, email: 'a@b.co' },
    { state: 'done', done: 3, total: 3, created: 2, updated: 1, skipped: 0, failed: 0, email: 'a@b.co',
      log: [
        { row: 2, name: 'דנה', status: 'created', contact_id: 5, reason: '' },
        { row: 3, name: 'רון', status: 'created', contact_id: 6, reason: '' },
        { row: 4, name: 'גיל', status: 'updated', contact_id: 7, reason: '' },
      ] },
  ]);
  const seen = [];
  const job = createServerJob({ api, jobId: 'aa', total: 3, sleep: async () => {} });
  job.onUpdate((p) => seen.push(p.state + ':' + p.done));
  await job.promise;
  assert.equal(job.progress.state, 'done');
  assert.equal(job.progress.created, 2);
  assert.equal(job.emailTo, 'a@b.co');
  assert.equal(job.log.summary().total, 3);
  assert.match(job.log.toCsv(), /דנה/);
  assert.ok(seen.includes('running:2'));
});

test('tolerates transient poll errors, then finishes', async () => {
  const api = scriptedApi([
    err(502), err(502),
    { state: 'done', done: 1, total: 1, created: 1, updated: 0, skipped: 0, failed: 0, log: [] },
  ]);
  const job = createServerJob({ api, jobId: 'bb', total: 1, sleep: async () => {} });
  await job.promise;
  assert.equal(job.progress.state, 'done');
});

test('a 404 is terminal — the server does not know this job', async () => {
  const api = scriptedApi([err(404)]);
  const job = createServerJob({ api, jobId: 'cc', total: 1, sleep: async () => {} });
  await job.promise;
  assert.equal(job.progress.state, 'error');
  assert.equal(job.error.status, 404);
});

test('persistent failures give up after maxErrors', async () => {
  let calls = 0;
  const api = {
    smartImportStatus: async () => { calls++; throw err(500); },
    smartImportCancel: async () => {},
  };
  const job = createServerJob({ api, jobId: 'dd', total: 1, maxErrors: 4, sleep: async () => {} });
  await job.promise;
  assert.equal(job.progress.state, 'error');
  assert.equal(calls, 4);
});

test('cancel shows cancelling until the server confirms cancelled', async () => {
  const statuses = [
    { state: 'running', done: 1, total: 9, created: 1, updated: 0, skipped: 0, failed: 0 },
    { state: 'running', done: 3, total: 9, created: 3, updated: 0, skipped: 0, failed: 0 },
    { state: 'cancelled', done: 4, total: 9, created: 4, updated: 0, skipped: 0, failed: 0, log: [] },
  ];
  let polls = 0;
  const job = createServerJob({
    jobId: 'ee', total: 9,
    api: {
      calls: { cancel: 0 },
      smartImportStatus: async () => statuses[Math.min(polls++, statuses.length - 1)],
      async smartImportCancel() { this.calls.cancel++; },
    },
    sleep: async () => {
      if (polls === 1) job.cancel(); // cancel after the first successful poll
      if (polls === 2) assert.equal(job.progress.state, 'cancelling'); // running polls must not flip it back
    },
  });
  await job.promise;
  assert.equal(job.progress.state, 'cancelled');
});
