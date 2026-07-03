import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContactPayload } from '../lib/fieldMapper.js';

test('maps top-level + additional fields', () => {
  const row = ['דנה', 'כהן', '0501234567', 'd@x.com', 'אקמה', 'תל אביב'];
  const mapping = [
    { index: 0, field: 'first_name' }, { index: 1, field: 'last_name' },
    { index: 2, field: 'phone_number' }, { index: 3, field: 'email' },
    { index: 4, field: 'company_name' }, { index: 5, field: 'city' },
  ];
  const p = buildContactPayload(row, mapping, []);
  assert.equal(p.name, 'דנה כהן');
  assert.equal(p.phone_number, '+972501234567');
  assert.equal(p.email, 'd@x.com');
  assert.deepEqual(p.additional_attributes, { company_name: 'אקמה', city: 'תל אביב' });
});

test('explicit name field wins over first/last', () => {
  const row = ['דנה כהן', 'ignore'];
  const p = buildContactPayload(row, [{ index: 0, field: 'name' }, { index: 1, field: 'first_name' }], []);
  assert.equal(p.name, 'דנה כהן');
});

test('skips empty values (no empty keys sent)', () => {
  const row = ['', '0501234567'];
  const p = buildContactPayload(row, [{ index: 0, field: 'email' }, { index: 1, field: 'phone_number' }], []);
  assert.ok(!('email' in p));
  assert.equal(p.phone_number, '+972501234567');
});

test('maps custom attributes', () => {
  const row = ['VIP', 'גולד'];
  const p = buildContactPayload(row, [], [{ index: 0, attribute_key: 'tier' }, { index: 1, attribute_key: 'plan' }]);
  assert.deepEqual(p.custom_attributes, { tier: 'VIP', plan: 'גולד' });
});

test('invalid phone is dropped (not sent as null)', () => {
  const row = ['123'];
  const p = buildContactPayload(row, [{ index: 0, field: 'phone_number' }], []);
  assert.ok(!('phone_number' in p));
});
