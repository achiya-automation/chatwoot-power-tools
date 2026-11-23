import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../lib/apiClient.js';

test('non-ok response throws ApiError with status', async () => {
  const fakeFetch = async () => ({ ok: false, status: 422, text: async () => 'Title taken' });
  const api = createApiClient(6, {}, fakeFetch);
  await assert.rejects(() => api.createLabel('x'), (e) => e instanceof ApiError && e.status === 422);
});

test('smartImportArm posts the options with the session headers', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const api = createApiClient(6, { 'access-token': 'AT' }, fakeFetch);
  await api.smartImportArm({ sha256: 'ab', email_summary: true });
  assert.equal(calls[0].url, '/api/v1/accounts/6/smart_import/arm');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['access-token'], 'AT');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { sha256: 'ab', email_summary: true });
});

test('listCustomAttributes filters by contact_attribute model', async () => {
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => [] }; };
  const api = createApiClient(6, {}, fakeFetch);
  await api.listCustomAttributes();
  assert.match(calls[0], /custom_attribute_definitions\?attribute_model=contact_attribute/);
});

test('createLabel wraps title in the label object required by Chatwoot', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ id: 9, title: 'לקוחות-חדשים' }) };
  };
  const api = createApiClient(6, {}, fakeFetch);

  await api.createLabel('לקוחות-חדשים');

  assert.equal(calls[0].url, '/api/v1/accounts/6/labels');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    label: { title: 'לקוחות-חדשים' },
  });
});
