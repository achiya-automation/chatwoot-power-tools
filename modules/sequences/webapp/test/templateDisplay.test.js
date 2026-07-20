import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusChip, qualityDot, canEdit, groupLabel } from '../src/lib/templateDisplay.js';

// ---------------------------------------------------------------------------
// statusChip — every status the brief names, plus the unknown fallback.
// ---------------------------------------------------------------------------

test('statusChip: APPROVED is teal', () => {
  assert.deepEqual(statusChip('APPROVED'), { cls: 'teal', he: 'מאושרת', en: 'Approved' });
});

test('statusChip: PENDING is amber', () => {
  const s = statusChip('PENDING');
  assert.equal(s.cls, 'amber');
  assert.ok(s.he && s.en);
});

test('statusChip: REJECTED is ruby', () => {
  const s = statusChip('REJECTED');
  assert.equal(s.cls, 'ruby');
  assert.ok(s.he && s.en);
});

test('statusChip: PAUSED is ruby (matches ComplianceView\'s "won\'t send" precedent)', () => {
  const s = statusChip('PAUSED');
  assert.equal(s.cls, 'ruby');
  assert.ok(s.he && s.en);
});

test('statusChip: DISABLED is ruby (matches ComplianceView\'s "won\'t send" precedent)', () => {
  const s = statusChip('DISABLED');
  assert.equal(s.cls, 'ruby');
  assert.ok(s.he && s.en);
});

test('statusChip: IN_APPEAL is slate (grey per design spec)', () => {
  const s = statusChip('IN_APPEAL');
  assert.equal(s.cls, 'slate');
  assert.ok(s.he && s.en);
});

test('statusChip: unrecognized status falls back to slate and echoes the raw value', () => {
  const s = statusChip('LOCKED');
  assert.equal(s.cls, 'slate');
  assert.equal(s.he, 'LOCKED');
  assert.equal(s.en, 'LOCKED');
});

test('statusChip: missing/empty status falls back to slate with a generic label', () => {
  for (const bad of [undefined, null, '']) {
    const s = statusChip(bad);
    assert.equal(s.cls, 'slate');
    assert.equal(s.he, 'לא ידוע');
    assert.equal(s.en, 'Unknown');
  }
});

// ---------------------------------------------------------------------------
// qualityDot — GREEN/YELLOW/RED/UNKNOWN, both wire shapes ({score} and bare
// string), and "no data at all" (distinct copy from Meta's own UNKNOWN).
// ---------------------------------------------------------------------------

test('qualityDot: {score:"GREEN"} object shape', () => {
  const q = qualityDot({ score: 'GREEN' });
  assert.equal(q.color, 'bg-n-teal-9');
  assert.ok(q.he && q.en);
});

test('qualityDot: {score:"YELLOW"} object shape', () => {
  const q = qualityDot({ score: 'YELLOW' });
  assert.equal(q.color, 'bg-n-amber-9');
});

test('qualityDot: {score:"RED"} object shape', () => {
  const q = qualityDot({ score: 'RED' });
  assert.equal(q.color, 'bg-n-ruby-9');
});

test('qualityDot: {score:"UNKNOWN"} object shape — Meta\'s own "not enough volume" value', () => {
  const q = qualityDot({ score: 'UNKNOWN' });
  assert.equal(q.color, 'bg-n-slate-8');
  assert.ok(q.he && q.en);
});

test('qualityDot: bare string "GREEN" (cached/older copies)', () => {
  const q = qualityDot('GREEN');
  assert.deepEqual(q, qualityDot({ score: 'GREEN' }));
});

test('qualityDot: bare string "YELLOW"', () => {
  assert.deepEqual(qualityDot('YELLOW'), qualityDot({ score: 'YELLOW' }));
});

test('qualityDot: bare string "RED"', () => {
  assert.deepEqual(qualityDot('RED'), qualityDot({ score: 'RED' }));
});

test('qualityDot: bare string "UNKNOWN"', () => {
  assert.deepEqual(qualityDot('UNKNOWN'), qualityDot({ score: 'UNKNOWN' }));
});

test('qualityDot: missing field entirely (undefined) — distinct copy from Meta\'s UNKNOWN, same neutral color', () => {
  const q = qualityDot(undefined);
  assert.equal(q.color, 'bg-n-slate-8');
  const unknown = qualityDot('UNKNOWN');
  assert.equal(q.color, unknown.color);
  assert.notEqual(q.he, unknown.he); // different copy: "no data" vs Meta's explicit "unknown"
});

test('qualityDot: null is treated the same as missing', () => {
  assert.deepEqual(qualityDot(null), qualityDot(undefined));
});

test('qualityDot: empty object (no .score key) is treated as missing', () => {
  assert.deepEqual(qualityDot({}), qualityDot(undefined));
});

test('qualityDot: unrecognized score value falls back to the UNKNOWN entry, not "no data"', () => {
  const q = qualityDot({ score: 'PURPLE' });
  assert.deepEqual(q, qualityDot('UNKNOWN'));
});

// ---------------------------------------------------------------------------
// canEdit — true/false table (Meta only allows editing APPROVED/REJECTED/PAUSED).
// ---------------------------------------------------------------------------

test('canEdit: true for APPROVED, REJECTED, PAUSED', () => {
  assert.equal(canEdit('APPROVED'), true);
  assert.equal(canEdit('REJECTED'), true);
  assert.equal(canEdit('PAUSED'), true);
});

test('canEdit: false for PENDING, DISABLED, IN_APPEAL, unknown/missing', () => {
  assert.equal(canEdit('PENDING'), false);
  assert.equal(canEdit('DISABLED'), false);
  assert.equal(canEdit('IN_APPEAL'), false);
  assert.equal(canEdit('LOCKED'), false);
  assert.equal(canEdit(undefined), false);
  assert.equal(canEdit(null), false);
});

// ---------------------------------------------------------------------------
// groupLabel — "name1, name2 · +9725…", deduped names + first inbox's phone.
// ---------------------------------------------------------------------------

test('groupLabel: single inbox', () => {
  const waba = { inboxes: [{ name: 'Achiya Global', phone: '+972501234567' }] };
  assert.equal(groupLabel(waba), 'Achiya Global · +972501234567');
});

test('groupLabel: multiple distinct-name inboxes, comma-joined, first phone wins', () => {
  const waba = {
    inboxes: [
      { name: 'Achiya Global', phone: '+972501111111' },
      { name: 'Achiya Support', phone: '+972502222222' },
    ],
  };
  assert.equal(groupLabel(waba), 'Achiya Global, Achiya Support · +972501111111');
});

test('groupLabel: duplicate names are deduped (same name, two phones)', () => {
  const waba = {
    inboxes: [
      { name: 'Achiya Global', phone: '+972501111111' },
      { name: 'Achiya Global', phone: '+972502222222' },
    ],
  };
  assert.equal(groupLabel(waba), 'Achiya Global · +972501111111');
});

test('groupLabel: three inboxes with a duplicate in the middle keeps dedup + array order', () => {
  const waba = {
    inboxes: [
      { name: 'A', phone: 'p1' },
      { name: 'B', phone: 'p2' },
      { name: 'A', phone: 'p3' },
    ],
  };
  assert.equal(groupLabel(waba), 'A, B · p1');
});

test('groupLabel: missing/empty inboxes array returns empty string', () => {
  assert.equal(groupLabel({ inboxes: [] }), '');
  assert.equal(groupLabel({}), '');
  assert.equal(groupLabel(null), '');
  assert.equal(groupLabel(undefined), '');
});

test('groupLabel: inbox with blank name falls back to phone-only (no dangling separator)', () => {
  const waba = { inboxes: [{ name: '', phone: '+972501234567' }] };
  assert.equal(groupLabel(waba), '+972501234567');
});

test('groupLabel: inbox with no phone falls back to names-only (no dangling separator)', () => {
  const waba = { inboxes: [{ name: 'Achiya Global', phone: '' }] };
  assert.equal(groupLabel(waba), 'Achiya Global');
});
