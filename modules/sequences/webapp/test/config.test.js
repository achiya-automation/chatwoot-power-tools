import { test } from 'node:test';
import assert from 'node:assert';

test('API_BASE is relative and under addons base', async () => {
  const { API_BASE } = await import('../src/config.js');
  assert.ok(API_BASE.startsWith('/chatwoot-addons') || API_BASE.startsWith('./'), API_BASE);
  assert.ok(!API_BASE.includes('achiya'));
});
