import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerMedia, isLoadableMedia, mediaFileName } from '../src/lib/headerMedia.js';

// ---------------------------------------------------------------------------
// isLoadableMedia — the whole point: a Meta upload handle is not a URL.
// ---------------------------------------------------------------------------

test('isLoadableMedia: https / http / blob / data are loadable', () => {
  assert.equal(isLoadableMedia('https://scontent.whatsapp.net/v/t61.29466-34/x.jpg?oe=6A9C6C92'), true);
  assert.equal(isLoadableMedia('http://engine.local/media/x.mp4'), true);
  assert.equal(isLoadableMedia('blob:http://localhost:5173/9f8a-4c'), true);
  assert.equal(isLoadableMedia('data:image/png;base64,iVBOR'), true);
});

test("isLoadableMedia: Meta's opaque upload handle is not loadable", () => {
  assert.equal(isLoadableMedia('4::aW1hZ2UvanBlZw==:ARZ8x9'), false);
});

test('isLoadableMedia: empty / missing / whitespace is not loadable', () => {
  for (const bad of ['', '   ', null, undefined]) assert.equal(isLoadableMedia(bad), false);
});

test('isLoadableMedia: surrounding whitespace is tolerated', () => {
  assert.equal(isLoadableMedia('  https://cdn/x.jpg  '), true);
});

test('isLoadableMedia: javascript: and other schemes are rejected', () => {
  assert.equal(isLoadableMedia('javascript:alert(1)'), false);
  assert.equal(isLoadableMedia('file:///etc/passwd'), false);
  assert.equal(isLoadableMedia('/media/x.jpg'), false); // relative — never produced here
});

// ---------------------------------------------------------------------------
// headerMedia — kind detection + first loadable source wins.
// ---------------------------------------------------------------------------

test('headerMedia: approved template header_handle renders directly', () => {
  const url = 'https://scontent.whatsapp.net/v/t61.29466-34/abc.jpg?oe=6A9C6C92';
  assert.deepEqual(headerMedia('IMAGE', url), { kind: 'IMAGE', url });
});

test('headerMedia: a fresh upload handle gives the kind but no url (→ placeholder)', () => {
  assert.deepEqual(headerMedia('IMAGE', '4::aW1hZ2UvanBlZw=='), { kind: 'IMAGE', url: '' });
});

test('headerMedia: the local object URL wins over the stored handle', () => {
  const blob = 'blob:http://localhost:5173/9f8a-4c';
  assert.deepEqual(headerMedia('VIDEO', blob, '4::dmlkZW8='), { kind: 'VIDEO', url: blob });
});

test('headerMedia: falls through to the next source when the first is not loadable', () => {
  const url = 'https://cdn/x.mp4';
  assert.deepEqual(headerMedia('VIDEO', '', undefined, url), { kind: 'VIDEO', url });
});

test('headerMedia: VIDEO and DOCUMENT are media kinds too', () => {
  assert.equal(headerMedia('VIDEO', 'https://cdn/x.mp4').kind, 'VIDEO');
  assert.equal(headerMedia('DOCUMENT', 'https://cdn/x.pdf').kind, 'DOCUMENT');
});

test('headerMedia: non-media headers carry no kind at all', () => {
  for (const fmt of ['NONE', 'TEXT', 'LOCATION', '', null, undefined]) {
    assert.deepEqual(headerMedia(fmt, 'https://cdn/x.jpg'), { kind: '', url: '' });
  }
});

test('headerMedia: format is matched case-insensitively and trimmed', () => {
  assert.equal(headerMedia(' image ', 'https://cdn/x.jpg').kind, 'IMAGE');
});

test('headerMedia: no sources at all → kind only', () => {
  assert.deepEqual(headerMedia('IMAGE'), { kind: 'IMAGE', url: '' });
});

test('headerMedia: the returned url is trimmed', () => {
  assert.equal(headerMedia('IMAGE', '  https://cdn/x.jpg ').url, 'https://cdn/x.jpg');
});

// ---------------------------------------------------------------------------
// mediaFileName — the chip label for a DOCUMENT header.
// ---------------------------------------------------------------------------

test('mediaFileName: takes the last path segment, without query or hash', () => {
  assert.equal(mediaFileName('https://cdn/x/invoice_2026.pdf?oe=6A9C#p2'), 'invoice_2026.pdf');
});

test('mediaFileName: percent-encoded names are decoded', () => {
  assert.equal(mediaFileName('https://cdn/%D7%97%D7%A9%D7%91%D7%95%D7%A0%D7%99%D7%AA.pdf'), 'חשבונית.pdf');
});

test('mediaFileName: a malformed escape falls back to the raw segment', () => {
  assert.equal(mediaFileName('https://cdn/100%_off.pdf'), '100%_off.pdf');
});

test('mediaFileName: no extension → empty (caller shows the generic label)', () => {
  assert.equal(mediaFileName('https://cdn/media/9f8a4c'), '');
  assert.equal(mediaFileName('https://cdn/'), '');
  assert.equal(mediaFileName(''), '');
  assert.equal(mediaFileName(null), '');
});
