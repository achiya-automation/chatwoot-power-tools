/**
 * media_validate.test.js — WhatsApp media validation (size + format per template header type).
 * Meta rejects oversized / wrong-format media at send; we validate BEFORE upload so the
 * user gets an immediate, clear error instead of a silent delivery failure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWhatsAppMedia, extForMime, formatBytes } from '../src/media.js';

const MB = 1024 * 1024;

test('IMAGE: jpeg/png under 5MB is accepted', () => {
  assert.equal(validateWhatsAppMedia({ format: 'IMAGE', mime: 'image/jpeg', byteSize: 3 * MB }).ok, true);
  assert.equal(validateWhatsAppMedia({ format: 'IMAGE', mime: 'image/png', byteSize: 1 * MB }).ok, true);
});

test('IMAGE: over 5MB is rejected with a size error', () => {
  const r = validateWhatsAppMedia({ format: 'IMAGE', mime: 'image/jpeg', byteSize: 6 * MB });
  assert.equal(r.ok, false);
  assert.match(r.error, /גדול|מקס/);
});

test('IMAGE: wrong format (mp4) is rejected', () => {
  const r = validateWhatsAppMedia({ format: 'IMAGE', mime: 'video/mp4', byteSize: 1 * MB });
  assert.equal(r.ok, false);
  assert.match(r.error, /פורמט/);
});

test('VIDEO: mp4 under 16MB accepted, over rejected', () => {
  assert.equal(validateWhatsAppMedia({ format: 'VIDEO', mime: 'video/mp4', byteSize: 10 * MB }).ok, true);
  assert.equal(validateWhatsAppMedia({ format: 'VIDEO', mime: 'video/mp4', byteSize: 20 * MB }).ok, false);
});

test('DOCUMENT: pdf under 100MB accepted', () => {
  assert.equal(validateWhatsAppMedia({ format: 'DOCUMENT', mime: 'application/pdf', byteSize: 50 * MB }).ok, true);
});

test('mime parameters are ignored (charset etc.)', () => {
  assert.equal(validateWhatsAppMedia({ format: 'IMAGE', mime: 'image/jpeg; charset=binary', byteSize: 1 * MB }).ok, true);
});

test('unknown format / empty file are rejected', () => {
  assert.equal(validateWhatsAppMedia({ format: 'AUDIO', mime: 'audio/mpeg', byteSize: 1 * MB }).ok, false);
  assert.equal(validateWhatsAppMedia({ format: 'IMAGE', mime: 'image/jpeg', byteSize: 0 }).ok, false);
});

test('extForMime maps known mimes, falls back to bin', () => {
  assert.equal(extForMime('image/jpeg'), 'jpg');
  assert.equal(extForMime('image/png'), 'png');
  assert.equal(extForMime('video/mp4'), 'mp4');
  assert.equal(extForMime('application/pdf'), 'pdf');
  assert.equal(extForMime('weird/thing'), 'bin');
});

test('formatBytes is human-readable', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.match(formatBytes(5 * MB), /5(\.0)? MB/);
  assert.match(formatBytes(1536), /1\.5 KB/);
});
