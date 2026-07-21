import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFilterPayload, pickMatch, batchDedup } from '../lib/dedup.js';

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

// ── batchDedup ───────────────────────────────────────────────────────────────

function contactsWithPhones(n) {
  return Array.from({ length: n }, (_, i) => ({
    name: `c${i}`, phone_number: `+9725${String(i).padStart(7, '0')}`, __row: i + 2,
  }));
}

test('batchDedup chunks values into OR clauses of 40 and matches by value', async () => {
  const calls = [];
  const api = {
    filterContacts: async (payload, page) => {
      calls.push({ clauses: payload.payload, page });
      return { meta: { count: 0 }, payload: [] };
    },
  };
  const contacts = contactsWithPhones(90);
  contacts[7].__match = 'stale'; // must be overwritten by the batch result
  await batchDedup(contacts, api);

  assert.equal(calls.length, 3); // 40 + 40 + 10
  assert.deepEqual(calls.map((c) => c.clauses.length), [40, 40, 10]);
  for (const { clauses } of calls) {
    clauses.forEach((cl, i) => {
      assert.equal(cl.attribute_key, 'phone_number');
      assert.equal(cl.filter_operator, 'equal_to');
      assert.equal(cl.values.length, 1); // server reads values[0] only
      assert.equal(cl.query_operator, i < clauses.length - 1 ? 'or' : null);
    });
  }
  assert.ok(contacts.every((c) => c.__match === null));
});

test('batchDedup walks result pages until meta.count is collected', async () => {
  const pageSize = 15;
  const existing = contactsWithPhones(20).map((c, i) => ({ id: 500 + i, phone_number: c.phone_number }));
  const pages = [];
  const api = {
    filterContacts: async (_payload, page) => {
      pages.push(page);
      const arr = existing.slice((page - 1) * pageSize, page * pageSize);
      return { meta: { count: existing.length }, payload: arr };
    },
  };
  const contacts = contactsWithPhones(20);
  await batchDedup(contacts, api);
  assert.deepEqual(pages, [1, 2]);
  contacts.forEach((c, i) => assert.equal(c.__match.id, 500 + i));
});

test('batchDedup matches by key priority and case-insensitively for email', async () => {
  const api = {
    filterContacts: async (payload) => {
      const key = payload.payload[0].attribute_key;
      if (key === 'identifier') return { meta: { count: 1 }, payload: [{ id: 1, identifier: 'x9' }] };
      if (key === 'phone_number') return { meta: { count: 1 }, payload: [{ id: 2, phone_number: '+972501111111' }] };
      return { meta: { count: 1 }, payload: [{ id: 3, email: 'dana@x.com' }] };
    },
  };
  const contacts = [
    { name: 'both', identifier: 'X9', phone_number: '+972501111111', __row: 2 }, // identifier wins
    { name: 'phone', phone_number: '+972501111111', __row: 3 },
    { name: 'mail', email: 'Dana@X.com', __row: 4 }, // server downcases → still matches
    { name: 'none', phone_number: '+972509999999', __row: 5 },
  ];
  await batchDedup(contacts, api);
  assert.equal(contacts[0].__match.id, 1);
  assert.equal(contacts[1].__match.id, 2);
  assert.equal(contacts[2].__match.id, 3);
  assert.equal(contacts[3].__match, null);
});

test('batchDedup marks later in-file duplicates for the serial tail', async () => {
  const api = { filterContacts: async () => ({ meta: { count: 0 }, payload: [] }) };
  const contacts = [
    { name: 'א', phone_number: '+972501111111', __row: 2 },
    { name: 'ב', phone_number: '+972501111111', __row: 3 }, // duplicate of row 2
    { name: 'ג', email: 'g@x.com', __row: 4 },
    { name: 'ד', email: 'G@X.com', __row: 5 },              // duplicate of row 4 (case)
    { name: 'ה', __row: 6 },                                // no key → plain create
  ];
  await batchDedup(contacts, api);
  assert.equal(contacts[0].__match, null);
  assert.equal(contacts[0].__dupTail, undefined);
  assert.equal(contacts[1].__dupTail, true);
  assert.equal('__match' in contacts[1], false);
  assert.equal(contacts[2].__match, null);
  assert.equal(contacts[3].__dupTail, true);
  assert.equal(contacts[4].__match, null);
  assert.equal(contacts[4].__dupTail, undefined);
});

test('batchDedup reports cumulative progress over distinct values', async () => {
  const seen = [];
  const api = { filterContacts: async () => ({ meta: { count: 0 }, payload: [] }) };
  await batchDedup(contactsWithPhones(50), api, (d, tot) => seen.push([d, tot]));
  assert.deepEqual(seen, [[40, 50], [50, 50]]);
});
