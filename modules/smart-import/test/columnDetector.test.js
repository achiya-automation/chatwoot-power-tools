import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectColumns, SYSTEM_FIELDS } from '../lib/columnDetector.js';
import { buildContactPayload } from '../lib/fieldMapper.js';

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
    'name', 'first_name', 'last_name', 'phone_number', 'phone_number_alt',
    'email', 'identifier', 'company_name', 'city', 'country'
  ]);
});

test('a second phone column becomes a fallback instead of being dropped', () => {
  const headers = ['שם', 'נייד', 'טלפון'];
  const rows = [['דנה', '', '03-6123456'], ['רון', '0501234567', '']];
  const cols = detectColumns(headers, rows);
  assert.equal(cols[1].field, 'phone_number');
  assert.equal(cols[2].field, 'phone_number_alt');

  // The row whose primary phone column is empty still imports with a number.
  const mapping = cols.map(({ index, field }) => ({ index, field }));
  assert.equal(buildContactPayload(rows[0], mapping, []).phone_number, '+97236123456');
  assert.equal(buildContactPayload(rows[1], mapping, []).phone_number, '+972501234567');
});

test('an unusable number is reported as __phoneRaw, not silently dropped', () => {
  const mapping = [{ index: 0, field: 'name' }, { index: 1, field: 'phone_number' }];
  const bad = buildContactPayload(['דנה', '050-123'], mapping, []);
  assert.equal(bad.phone_number, undefined);
  assert.equal(bad.__phoneRaw, '050-123');

  // Nothing in the file at all → no raw value to show, so the two cases stay distinct.
  const empty = buildContactPayload(['רון', ''], mapping, []);
  assert.equal(empty.phone_number, undefined);
  assert.equal(empty.__phoneRaw, undefined);
});

// Real-world insurance-export format (בני הבוט.xlsx): every header carries a
// "לקוח" filler word, and the ת"ז column holds 9-digit IDs that look like
// normalizable phone numbers. The header must win so the ID column never
// steals the phone_number slot from the real cellular column.
test('insurance export: filler word stripped, ID column not mistaken for phone', () => {
  const headers = ['שם פרטי לקוח', 'שם משפחה לקוח', 'מספר ת.ז', 'סלולרי לקוח', 'דוא"ל לקוח', 'יישוב'];
  const rows = [
    ['אסף', 'זיו', '039420658', '054-464-7987', 'ziv@example.com', 'הרצליה'],
    ['אלון', 'כהן', '039720008', '050-930-0569', 'alon@example.com', 'פתח תקווה'],
  ];
  const res = detectColumns(headers, rows);
  const f = (h) => res.find((r) => r.header === h).field;
  assert.equal(f('שם פרטי לקוח'), 'first_name');
  assert.equal(f('שם משפחה לקוח'), 'last_name');
  assert.equal(f('מספר ת.ז'), 'identifier');
  assert.equal(f('סלולרי לקוח'), 'phone_number');
  assert.equal(f('דוא"ל לקוח'), 'email');
  assert.equal(f('יישוב'), 'city');
});

// ── validateMapping — blocks a mapping whose column content contradicts the field ──
import { validateMapping } from '../lib/columnDetector.js';

const NOTE_ROWS = [
  ['דנה', 'הזמנה whatsapp', '+972501234567'],
  ['רון', 'הזמנה sms+whatsapp', '+972529876543'],
  ['גיל', 'הזמנה whatsapp', '+972541112223'],
];

test('validateMapping blocks a notes column mapped to email', () => {
  const mapping = [
    { index: 0, field: 'first_name' },
    { index: 1, field: 'email' },       // ← the Hana bug: note column mapped to email
    { index: 2, field: 'phone_number' },
  ];
  const blockers = validateMapping(['שם', 'הערה', 'טלפון'], NOTE_ROWS, mapping);
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].header, 'הערה');
  assert.equal(blockers[0].field, 'email');
  assert.equal(blockers[0].valid, 0);
  assert.equal(blockers[0].total, 3);
});

test('validateMapping blocks a notes column mapped to phone', () => {
  const mapping = [{ index: 1, field: 'phone_number' }];
  const blockers = validateMapping(['שם', 'הערה', 'טלפון'], NOTE_ROWS, mapping);
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].field, 'phone_number');
});

test('validateMapping passes correct email and phone mappings', () => {
  const rows = [
    ['a@b.com', '0501234567'],
    ['c@d.com', '0529876543'],
    ['לא אימייל', ''],           // one bad value + one empty — still ≥50% valid
  ];
  const mapping = [{ index: 0, field: 'email' }, { index: 1, field: 'phone_number' }];
  assert.deepEqual(validateMapping(['מייל', 'נייד'], rows, mapping), []);
});

test('validateMapping ignores empty columns and non-validated fields', () => {
  const rows = [['', 'הזמנה'], ['', 'הזמנה']];
  const mapping = [
    { index: 0, field: 'email' },      // column is entirely empty — nothing to validate
    { index: 1, field: 'identifier' }, // identifier accepts any string
  ];
  assert.deepEqual(validateMapping(['מייל', 'הערה'], rows, mapping), []);
});
