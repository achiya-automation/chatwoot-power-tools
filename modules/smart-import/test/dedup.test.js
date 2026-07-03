import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFilterPayload, pickMatch } from '../lib/dedup.js';

test('builds OR filter across available keys', () => {
  const fp = buildFilterPayload({ phone_number: '+972501234567', email: 'a@b.com' });
  assert.equal(fp.payload.length, 2);
  assert.equal(fp.payload[0].attribute_key, 'phone_number');
  assert.equal(fp.payload[0].filter_operator, 'equal_to');
  assert.deepEqual(fp.payload[0].values, ['+972501234567']);
  assert.equal(fp.payload[0].query_operator, 'or');
  assert.equal(fp.payload[1].query_operator, null); // last clause
});

test('returns null when no dedup key present', () => {
  assert.equal(buildFilterPayload({ name: 'דנה' }), null);
});

test('pickMatch prefers identifier match', () => {
  const contact = { identifier: 'X9', phone_number: '+97250', email: 'a@b.com' };
  const results = [
    { id: 1, phone_number: '+97250' },
    { id: 2, identifier: 'X9' },
  ];
  assert.equal(pickMatch(results, contact).id, 2);
});

test('pickMatch falls back to phone then email', () => {
  const contact = { phone_number: '+97250', email: 'a@b.com' };
  assert.equal(pickMatch([{ id: 5, email: 'a@b.com' }, { id: 6, phone_number: '+97250' }], contact).id, 6);
});

test('pickMatch returns null on empty', () => {
  assert.equal(pickMatch([], { email: 'a@b.com' }), null);
});

test('numeric 0 identifier is kept in filter', () => {
  const fp = buildFilterPayload({ identifier: 0 });
  assert.equal(fp.payload.length, 1);
  assert.equal(fp.payload[0].attribute_key, 'identifier');
  assert.deepEqual(fp.payload[0].values, [0]);
});
