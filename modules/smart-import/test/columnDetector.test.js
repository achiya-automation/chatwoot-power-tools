import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectColumns, SYSTEM_FIELDS } from '../lib/columnDetector.js';

const f = (res, header) => res.find((r) => r.header === header).field;

test('detects Hebrew headers', () => {
  const res = detectColumns(['שם פרטי', 'שם משפחה', 'טלפון', 'אימייל'], []);
  assert.equal(f(res, 'שם פרטי'), 'first_name');
  assert.equal(f(res, 'שם משפחה'), 'last_name');
  assert.equal(f(res, 'טלפון'), 'phone_number');
  assert.equal(f(res, 'אימייל'), 'email');
});

test('detects English headers case-insensitively', () => {
  const res = detectColumns(['Full Name', 'E-Mail', 'Mobile', 'Company'], []);
  assert.equal(f(res, 'Full Name'), 'name');
  assert.equal(f(res, 'E-Mail'), 'email');
  assert.equal(f(res, 'Mobile'), 'phone_number');
  assert.equal(f(res, 'Company'), 'company_name');
});

test('falls back to content detection when header is unknown', () => {
  const res = detectColumns(['col1', 'col2'], [
    ['0501234567', 'a@b.com'],
    ['0529876543', 'c@d.com'],
  ]);
  assert.equal(f(res, 'col1'), 'phone_number');
  assert.equal(f(res, 'col2'), 'email');
});

test('unknown column with non-matching content → null field', () => {
  const res = detectColumns(['random'], [['hello'], ['world']]);
  assert.equal(f(res, 'random'), null);
});

test('does not assign the same system field twice (first wins)', () => {
  const res = detectColumns(['טלפון', 'נייד'], []);
  const phones = res.filter((r) => r.field === 'phone_number');
  assert.equal(phones.length, 1);
});

test('SYSTEM_FIELDS contains exactly expected fields in order', () => {
  assert.deepEqual(SYSTEM_FIELDS, [
    'name', 'first_name', 'last_name', 'phone_number',
    'email', 'identifier', 'company_name', 'city', 'country'
  ]);
});
