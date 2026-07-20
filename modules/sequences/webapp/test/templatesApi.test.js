import { test } from 'node:test';
import assert from 'node:assert';
import * as templatesApi from '../src/api/templatesApi.js';
import * as sequencesApi from '../src/api/sequencesApi.js';

// Store the original fetch and a hook for setting the mock
const originalFetch = global.fetch;
let mockFetch;

// Override global fetch for all tests
global.fetch = async (...args) => {
  if (mockFetch) return mockFetch(...args);
  return originalFetch(...args);
};

test('templatesApi.listTemplates posts correct action and payload', async () => {
  let fetchedUrl = null;
  let fetchedBody = null;
  mockFetch = async (url, options) => {
    fetchedUrl = url;
    fetchedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, data: [] }));
  };

  const result = await templatesApi.listTemplates(7, 123);

  assert.ok(fetchedUrl.includes('?account_id=7'));
  assert.strictEqual(fetchedBody.action, 'tpl_list');
  assert.deepStrictEqual(fetchedBody.payload, { inbox_id: 123 });
  assert.deepStrictEqual(result, []);
});

test('templatesApi.listTemplates without inboxId sends empty payload', async () => {
  let fetchedBody = null;
  mockFetch = async (url, options) => {
    fetchedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, data: [] }));
  };

  const result = await templatesApi.listTemplates(7);

  assert.deepStrictEqual(fetchedBody.payload, {});
  assert.deepStrictEqual(result, []);
});

test('templatesApi.createTemplate sends correct payload shape', async () => {
  let fetchedBody = null;
  mockFetch = async (url, options) => {
    fetchedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, data: { id: 'tpl_1', name: 'test' } }));
  };

  const template = { name: 'test_tpl', category: 'MARKETING', language: 'he' };
  const result = await templatesApi.createTemplate(7, 123, template);

  assert.strictEqual(fetchedBody.action, 'tpl_create');
  assert.deepStrictEqual(fetchedBody.payload, {
    inbox_id: 123,
    template,
  });
  assert.deepStrictEqual(result, { id: 'tpl_1', name: 'test' });
});

test('templatesApi.editTemplate sends correct payload shape', async () => {
  let fetchedBody = null;
  mockFetch = async (url, options) => {
    fetchedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, data: { id: 'tpl_1' } }));
  };

  const changes = { category: 'TRANSACTIONAL' };
  const result = await templatesApi.editTemplate(7, 123, 'tpl_1', changes);

  assert.strictEqual(fetchedBody.action, 'tpl_edit');
  assert.deepStrictEqual(fetchedBody.payload, {
    inbox_id: 123,
    template_id: 'tpl_1',
    changes,
  });
});

test('templatesApi.deleteTemplate without hsmId sends correct payload', async () => {
  let fetchedBody = null;
  mockFetch = async (url, options) => {
    fetchedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, data: null }));
  };

  await templatesApi.deleteTemplate(7, 123, 'template_name');

  assert.strictEqual(fetchedBody.action, 'tpl_delete');
  assert.deepStrictEqual(fetchedBody.payload, {
    inbox_id: 123,
    name: 'template_name',
  });
  assert.ok(!('hsm_id' in fetchedBody.payload));
});

test('templatesApi.deleteTemplate with hsmId sends correct payload', async () => {
  let fetchedBody = null;
  mockFetch = async (url, options) => {
    fetchedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, data: null }));
  };

  await templatesApi.deleteTemplate(7, 123, 'template_name', 'hsm_123');

  assert.strictEqual(fetchedBody.action, 'tpl_delete');
  assert.deepStrictEqual(fetchedBody.payload, {
    inbox_id: 123,
    name: 'template_name',
    hsm_id: 'hsm_123',
  });
});

test('templatesApi.listFlows posts correct action and payload', async () => {
  let fetchedBody = null;
  mockFetch = async (url, options) => {
    fetchedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, data: [] }));
  };

  const result = await templatesApi.listFlows(7, 123);

  assert.strictEqual(fetchedBody.action, 'tpl_flows');
  assert.deepStrictEqual(fetchedBody.payload, { inbox_id: 123 });
  assert.deepStrictEqual(result, []);
});

test('templatesApi.uploadExample sends raw file with correct headers', async () => {
  let capturedUrl = null;
  let capturedOptions = null;
  mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return new Response(JSON.stringify({ ok: true, data: { handle: 'ex_123' } }));
  };

  const file = new File(['test content'], 'example.txt', { type: 'text/plain' });
  const result = await templatesApi.uploadExample(7, 123, file);

  assert.ok(capturedUrl.includes('/template-example?'));
  assert.ok(capturedUrl.includes('account_id=7'));
  assert.ok(capturedUrl.includes('inbox_id=123'));
  assert.ok(capturedUrl.includes('locale='));
  assert.strictEqual(capturedOptions.method, 'POST');
  assert.strictEqual(capturedOptions.headers['Content-Type'], 'text/plain');
  assert.ok(capturedOptions.headers['x-filename'].includes('example.txt'));
  assert.deepStrictEqual(result, { handle: 'ex_123' });
});

test('templatesApi.uploadExample returns .forbidden=true on 403', async () => {
  mockFetch = async (url, options) => {
    return new Response(JSON.stringify({ error: 'Admin only' }), { status: 403 });
  };

  const file = new File(['test'], 'test.txt');

  try {
    await templatesApi.uploadExample(7, 123, file);
    assert.fail('Expected error to be thrown');
  } catch (err) {
    assert.strictEqual(err.forbidden, true);
    assert.ok(err.message.includes('Admin') || err.message.includes('403'));
  }
});

test('templatesApi.uploadExample throws on !res.ok', async () => {
  mockFetch = async (url, options) => {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  };

  const file = new File(['test'], 'test.txt');

  try {
    await templatesApi.uploadExample(7, 123, file);
    assert.fail('Expected error to be thrown');
  } catch (err) {
    assert.ok(!err.forbidden);
    assert.ok(err.message.includes('Server error') || err.message.includes('500'));
  }
});

test('call.js shared by sequencesApi: listSequences still works unchanged', async () => {
  let fetchedUrl = null;
  let fetchedBody = null;
  mockFetch = async (url, options) => {
    fetchedUrl = url;
    fetchedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, data: [
      {
        id: 'seq_1',
        key: 'key1',
        display_name: 'Sequence 1',
        enabled: true,
        enroll_enabled: true,
        send_enabled: true,
        stop_on_reply: false,
        skip_shabbat: false,
        quiet_start: '',
        quiet_end: '',
        steps: [],
      },
    ] }));
  };

  const result = await sequencesApi.listSequences(7);

  // Verify call signature (shared call.js)
  assert.ok(fetchedUrl.includes('?account_id=7'));
  assert.strictEqual(fetchedBody.action, 'list');
  assert.deepStrictEqual(fetchedBody.payload, {});

  // Verify mapping to UI format
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, 'seq_1');
  assert.strictEqual(result[0].name, 'Sequence 1');
});

test('call.js returns .forbidden=true on 403 for sequencesApi', async () => {
  mockFetch = async (url, options) => {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  };

  try {
    await sequencesApi.listSequences(7);
    assert.fail('Expected error to be thrown');
  } catch (err) {
    assert.strictEqual(err.forbidden, true);
  }
});
