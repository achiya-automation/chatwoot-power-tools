/**
 * version.test.js — the build id the health endpoint reports so the SPA can spot a stale tab.
 *
 * The bundle filename ends in the 14-digit build id (vite.config: `[name]-[hash]-${BUILD_ID}`),
 * and index.html references it. The engine parses that id out of index.html once and returns it
 * on /drip-api/health; the SPA compares it against its own compiled-in __BUILD_ID__.
 *
 * Run: node --test test/version.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIdFromHtml } from '../src/api.js';

test('pulls the 14-digit build id out of the bundle reference', () => {
  const html = '<script type="module" src="/drip/assets/main-GDLof_IN-20260715100504.js"></script>';
  assert.equal(buildIdFromHtml(html), '20260715100504');
});

test('works off the css asset too (whichever appears first)', () => {
  const html = '<link rel="stylesheet" href="/drip/assets/main-BP8GkLZP-20260715100504.css">';
  assert.equal(buildIdFromHtml(html), '20260715100504');
});

test('empty (not a crash) when there is no bundle ref — dev server, missing dist', () => {
  assert.equal(buildIdFromHtml('<html><body>hi</body></html>'), '');
  assert.equal(buildIdFromHtml(''), '');
  assert.equal(buildIdFromHtml(null), '');
  assert.equal(buildIdFromHtml(undefined), '');
});

test('does not mistake an unrelated 14-digit number for a build id', () => {
  // must be the -<id>.<ext> suffix of an asset, not any 14 digits on the page
  assert.equal(buildIdFromHtml('<meta content="12345678901234">'), '');
});
