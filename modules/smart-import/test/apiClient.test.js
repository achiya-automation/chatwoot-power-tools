import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthHeaders, createApiClient, ApiError } from '../lib/apiClient.js';

test('getAuthHeaders parses session cookie into 5 headers', () => {
  const session = { 'access-token': 'AT', client: 'CL', uid: 'u@x.com', 'token-type': 'Bearer', expiry: '999' };
  const cookie = 'foo=1; cw_d_session_info=' + encodeURIComponent(JSON.stringify(session)) + '; bar=2';
  const h = getAuthHeaders(cookie);
  assert.equal(h['access-token'], 'AT');
  assert.equal(h.uid, 'u@x.com');
  assert.equal(h['token-type'], 'Bearer');
});

test('getAuthHeaders returns null when cookie missing', () => {
  assert.equal(getAuthHeaders('foo=1'), null);
});

test('createContact POSTs to right URL with headers + body', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ id: 7 }) };
  };
  const api = createApiClient(6, { 'access-token': 'AT' }, fakeFetch);
  const res = await api.createContact({ name: 'דנה' });
  assert.equal(res.id, 7);
  assert.equal(calls[0].url, '/api/v1/accounts/6/contacts');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['access-token'], 'AT');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { name: 'דנה' });
});

test('non-ok response throws ApiError with status', async () => {
  const fakeFetch = async () => ({ ok: false, status: 422, text: async () => 'Email taken' });
  const api = createApiClient(6, {}, fakeFetch);
  await assert.rejects(() => api.createContact({}), (e) => e instanceof ApiError && e.status === 422);
});

test('filterContacts appends the page param only when given', async () => {
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ payload: [] }) }; };
  const api = createApiClient(6, {}, fakeFetch);
  await api.filterContacts({ payload: [] });
  await api.filterContacts({ payload: [] }, 2);
  assert.equal(calls[0], '/api/v1/accounts/6/contacts/filter');
  assert.equal(calls[1], '/api/v1/accounts/6/contacts/filter?page=2');
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

test('assignLabels writes labels to the contact endpoint, not a conversation', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ payload: ['לקוחות-חדשים'] }) };
  };
  const api = createApiClient(10, {}, fakeFetch);

  await api.assignLabels(321, ['לקוחות-חדשים']);

  assert.equal(calls[0].url, '/api/v1/accounts/10/contacts/321/labels');
  assert.doesNotMatch(calls[0].url, /conversations/);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { labels: ['לקוחות-חדשים'] });
});

test('createContactInbox POSTs the inbox link under the contact', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({}) }; };
  const api = createApiClient(6, { 'access-token': 'AT' }, fakeFetch);
  await api.createContactInbox(42, { inbox_id: 7, source_id: '972501234567' });
  assert.equal(calls[0].url, '/api/v1/accounts/6/contacts/42/contact_inboxes');
  assert.equal(calls[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { inbox_id: 7, source_id: '972501234567' });
});
