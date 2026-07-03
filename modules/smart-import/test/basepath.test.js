import { test } from 'node:test';
import assert from 'node:assert';
import { vendorUrl } from '../lib/basepath.js';

test('vendorUrl derives from injected base', () => {
  assert.strictEqual(vendorUrl('/chatwoot-addons'), '/chatwoot-addons/smart-import/xlsx.mini.min.js');
});

test('vendorUrl falls back to default base', () => {
  assert.ok(vendorUrl(undefined).startsWith('/chatwoot-addons/smart-import/'));
});
