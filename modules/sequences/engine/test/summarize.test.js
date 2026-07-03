import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEnrollments } from '../../webapp/src/lib/summarize.js';

test('summarizeEnrollments: per-sequence counts + totals + completion %', () => {
  const sequences = [
    { key: 'welcome', name: 'ברוכים', enabled: true, steps: [{}, {}, {}, {}] }, // 4 steps
    { key: 'followup', name: 'מעקב', enabled: true, steps: [{}, {}] },
    { key: 'empty', name: 'ריק', enabled: false, steps: [{}] },
  ];
  const enrollments = [
    { sequence_key: 'welcome', status: 'active' },
    { sequence_key: 'welcome', status: 'active' },
    { sequence_key: 'welcome', status: 'completed' },
    { sequence_key: 'welcome', status: 'stopped' },
    { sequence_key: 'welcome', status: 'failed' },
    { sequence_key: 'followup', status: 'completed' },
  ];
  const { totals, perSequence } = summarizeEnrollments(enrollments, sequences);
  assert.deepEqual(totals, { total: 6, active: 2, completed: 2, stopped: 1, failed: 1 });

  const welcome = perSequence.find((s) => s.key === 'welcome');
  assert.equal(welcome.total, 5);
  assert.equal(welcome.active, 2);
  assert.equal(welcome.completed, 1);
  assert.equal(welcome.stopped, 1);
  assert.equal(welcome.failed, 1, 'failed (stuck) sends are counted per sequence');
  assert.equal(welcome.steps, 4, 'steps come from the sequence definition');
  assert.equal(welcome.completionPct, 20); // 1 completed / 5 total

  const empty = perSequence.find((s) => s.key === 'empty');
  assert.equal(empty.total, 0, 'sequences with no enrollments still appear');
  assert.equal(empty.completionPct, 0);

  assert.equal(perSequence[0].key, 'welcome', 'sorted by enrolled count desc');
});

test('summarizeEnrollments: unknown sequence_key bucketed; empty inputs safe', () => {
  const { totals, perSequence } = summarizeEnrollments(
    [{ sequence_key: 'ghost', sequence_name: 'רפאים', status: 'active' }],
    []
  );
  assert.equal(totals.total, 1);
  assert.equal(perSequence.length, 1);
  assert.equal(perSequence[0].key, 'ghost');
  assert.equal(perSequence[0].name, 'רפאים');

  const empty = summarizeEnrollments([], []);
  assert.deepEqual(empty.totals, { total: 0, active: 0, completed: 0, stopped: 0, failed: 0 });
  assert.deepEqual(empty.perSequence, []);
});

test('summarizeEnrollments: no args → empty summary (no throw)', () => {
  const r = summarizeEnrollments();
  assert.equal(r.totals.total, 0);
  assert.deepEqual(r.perSequence, []);
});
