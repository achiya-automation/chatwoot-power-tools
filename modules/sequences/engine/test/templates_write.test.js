/**
 * templates_write.test.js — Template Studio: create / edit / delete + audit + sync-back
 * (Task 6): tpl_create, tpl_edit, tpl_delete, tpl_flows on handleTemplatesAction.
 *
 * Pure mock-fetch + mock-query, same style as templates_graph.test.js: every call below
 * passes mock `reads`, `fetchImpl` and `query` directly, so neither db.js's real pool nor
 * a real Graph call is ever touched. Runs without DATABASE_URL_TEST.
 *
 * Run: DATABASE_URL_TEST=postgres://localhost:5432/drip_test node --test test/templates_write.test.js
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleTemplatesAction, _resetCapCacheForTests } from '../src/templates.js';

beforeEach(() => _resetCapCacheForTests());

// ── tpl_create ───────────────────────────────────────────────────────────────

test('tpl_create posts serialized template, audits, and syncs back', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (String(url).includes('/message_templates') && opts.method === 'POST')
      return { ok: true, status: 200, json: async () => ({ id: '999', status: 'PENDING', category: 'MARKETING' }) };
    return { ok: true, status: 200, json: async () => ({ data: [] }) }; // sync-back list fetch
  };
  const sql = [];
  const query = async (text, params) => { sql.push({ text, params }); return []; };
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, name: 'A', phone: '+1', token: 'tok', phoneId: 'p', wabaId: 'W1' }] };
  const res = await handleTemplatesAction(1, 'tpl_create', {
    inbox_id: 1,
    template: { name: 'x_1', language: 'he', category: 'MARKETING', allow_category_change: true, components: [{ type: 'BODY', text: 'hi' }] },
    __actor: { uid: 'u@x', name: 'U' },
  }, { reads, fetchImpl, query });
  assert.equal(res.data.id, '999');
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.body.name, 'x_1');
  assert.ok(sql.some((s) => s.text.includes('INSERT INTO drip.template_audit')));
  assert.ok(sql.some((s) => s.text.includes('UPDATE public.channel_whatsapp')));
});

test('tpl_create rejects a template the server-side schema refuses', async () => {
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 't', wabaId: 'W1' }] };
  await assert.rejects(
    handleTemplatesAction(1, 'tpl_create', { inbox_id: 1, template: { name: 'Bad Name', components: [] } },
      { reads, fetchImpl: async () => { throw new Error('must not reach Graph'); }, query: async () => [] }),
    /name/i
  );
});

test('tpl_create validation blocks bad category and empty components before Graph', async () => {
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 't', wabaId: 'W1' }] };
  const fetchImpl = async () => { throw new Error('must not reach Graph'); };
  const query = async () => { throw new Error('must not reach DB'); };

  await assert.rejects(
    handleTemplatesAction(1, 'tpl_create',
      { inbox_id: 1, template: { name: 'ok_name', category: 'BOGUS', components: [{ type: 'BODY', text: 'hi' }] } },
      { reads, fetchImpl, query }),
    /category/i
  );
  await assert.rejects(
    handleTemplatesAction(1, 'tpl_create',
      { inbox_id: 1, template: { name: 'ok_name', category: 'MARKETING', components: [] } },
      { reads, fetchImpl, query }),
    /components/i
  );
});

// ── tpl_delete ───────────────────────────────────────────────────────────────

test('tpl_delete builds the right query string and audits', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET' });
    if (opts.method === 'DELETE') return { ok: true, status: 200, json: async () => ({ success: true }) };
    return { ok: true, status: 200, json: async () => ({ data: [] }) }; // sync-back list fetch
  };
  const sql = [];
  const query = async (text, params) => { sql.push({ text, params }); return []; };
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 'tok', wabaId: 'W1' }] };

  const res = await handleTemplatesAction(1, 'tpl_delete', {
    inbox_id: 1, name: 'promo_a', hsm_id: 'hsm123', __actor: { uid: 'u@x', name: 'U' },
  }, { reads, fetchImpl, query });

  assert.deepEqual(res.data, { success: true });
  const del = calls.find((c) => c.method === 'DELETE');
  assert.ok(del, 'a DELETE call must be made');
  assert.ok(del.url.includes('/W1/message_templates?'), 'DELETE hits the WABA message_templates endpoint');
  assert.ok(del.url.includes('name=promo_a'), 'query string carries the template name');
  assert.ok(del.url.includes('hsm_id=hsm123'), 'query string carries hsm_id when given');

  const audit = sql.find((s) => s.text.includes('INSERT INTO drip.template_audit'));
  assert.ok(audit, 'delete must be audited');
  assert.equal(audit.params[3], 'delete', 'action column');
  assert.equal(audit.params[4], 'W1', 'waba_id column');
  assert.equal(audit.params[5], 'promo_a', 'template_name column');
  assert.ok(sql.some((s) => s.text.includes('UPDATE public.channel_whatsapp')), 'delete also syncs back');
});

// ── Graph errors ─────────────────────────────────────────────────────────────

test('meta error surfaces verbatim and is still audited with ok:false detail', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Template name taken' } }) });
  const sql = [];
  const query = async (text, params) => { sql.push({ text, params }); return []; };
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 'tok', wabaId: 'W1' }] };

  await assert.rejects(
    handleTemplatesAction(1, 'tpl_create', {
      inbox_id: 1,
      template: { name: 'dup_name', language: 'he', category: 'MARKETING', components: [{ type: 'BODY', text: 'hi' }] },
    }, { reads, fetchImpl, query }),
    /taken/
  );

  const audit = sql.find((s) => s.text.includes('INSERT INTO drip.template_audit'));
  assert.ok(audit, 'a failed Graph attempt must still be audited — attempt = action');
  const detail = JSON.parse(audit.params[7]);
  assert.equal(detail.ok, false);
  assert.match(detail.error, /taken/);
});

test('inbox not in account → rejects with 404-style error', async () => {
  const reads = { getWhatsappCredsAll: async () => [] };
  const fetchImpl = async () => { throw new Error('must not reach Graph'); };
  const query = async () => { throw new Error('must not reach DB'); };

  await assert.rejects(
    handleTemplatesAction(1, 'tpl_create', {
      inbox_id: 999,
      template: { name: 'x', category: 'MARKETING', components: [{ type: 'BODY', text: 'hi' }] },
    }, { reads, fetchImpl, query }),
    /inbox/i
  );
});

// ── tpl_edit ─────────────────────────────────────────────────────────────────

test('tpl_edit posts only the whitelisted changed fields to /{template_id}, audits, and syncs back', async () => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (String(url).includes('/999888') && opts.method === 'POST')
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    return { ok: true, status: 200, json: async () => ({ data: [] }) }; // sync-back list fetch
  };
  const sql = [];
  const query = async (text, params) => { sql.push({ text, params }); return []; };
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 'tok', wabaId: 'W1' }] };

  const res = await handleTemplatesAction(1, 'tpl_edit', {
    inbox_id: 1,
    template_id: '999888',
    changes: { category: 'UTILITY', components: [{ type: 'BODY', text: 'hi v2' }], not_allowed: 'drop-me' },
    __actor: { uid: 'u@x', name: 'U' },
  }, { reads, fetchImpl, query });

  assert.deepEqual(res.data, { success: true });
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post.url.includes('/999888'), 'edit posts straight to the template_id, not the WABA path');
  assert.deepEqual(post.body, { category: 'UTILITY', components: [{ type: 'BODY', text: 'hi v2' }] }, 'only whitelisted keys are forwarded, not_allowed is dropped');

  const audit = sql.find((s) => s.text.includes('INSERT INTO drip.template_audit'));
  assert.ok(audit, 'edit must be audited');
  assert.equal(audit.params[3], 'edit');
  assert.equal(audit.params[5], '999888', 'template_id stands in for template_name on edit — no name is given in the payload');
  assert.ok(sql.some((s) => s.text.includes('UPDATE public.channel_whatsapp')), 'edit also syncs back');
});

test('tpl_edit rejects path injection in template_id; fetch is never called', async () => {
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 'tok', wabaId: 'W1' }] };
  const fetchImpl = async () => { throw new Error('must not reach Graph'); };
  const query = async () => { throw new Error('must not reach DB'); };

  await assert.rejects(
    handleTemplatesAction(1, 'tpl_edit', {
      inbox_id: 1,
      template_id: '123/../evil',
      changes: { category: 'UTILITY' },
      __actor: { uid: 'u@x', name: 'U' },
    }, { reads, fetchImpl, query }),
    /invalid template_id/
  );
});

test('tpl_edit rejects empty changes with no editable fields; fetch is never called', async () => {
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 'tok', wabaId: 'W1' }] };
  const fetchImpl = async () => { throw new Error('must not reach Graph'); };
  const query = async () => { throw new Error('must not reach DB'); };

  await assert.rejects(
    handleTemplatesAction(1, 'tpl_edit', {
      inbox_id: 1,
      template_id: '999888',
      changes: {},
      __actor: { uid: 'u@x', name: 'U' },
    }, { reads, fetchImpl, query }),
    /no editable fields/
  );
});

// ── sync-back never fails the write ───────────────────────────────────────────

test('sync-back failure does not fail the write action (poll job catches up later)', async () => {
  const fetchImpl = async (url, opts = {}) => {
    if (String(url).includes('/message_templates') && opts.method === 'POST')
      return { ok: true, status: 200, json: async () => ({ id: '1', status: 'PENDING', category: 'MARKETING' }) };
    throw new Error('sync-back network down'); // the sync-back list fetch fails
  };
  const sql = [];
  const query = async (text, params) => { sql.push({ text, params }); return []; };
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 'tok', wabaId: 'W1' }] };

  const realConsoleError = console.error;
  const errs = [];
  console.error = (...args) => errs.push(args);
  let res;
  try {
    res = await handleTemplatesAction(1, 'tpl_create', {
      inbox_id: 1,
      template: { name: 'x_2', language: 'he', category: 'MARKETING', components: [{ type: 'BODY', text: 'hi' }] },
    }, { reads, fetchImpl, query });
  } finally {
    console.error = realConsoleError;
  }

  assert.equal(res.data.id, '1', 'the create result is returned even though sync-back failed');
  assert.ok(errs.some((a) => String(a[0]).includes('syncWabaToChatwoot failed')), 'sync-back failure is logged, not swallowed silently');
  assert.ok(sql.some((s) => s.text.includes('INSERT INTO drip.template_audit')), 'the write itself is still audited');
  assert.ok(!sql.some((s) => s.text.includes('UPDATE public.channel_whatsapp')), 'the sync-back UPDATE never runs because the list fetch threw first');
});

// ── tpl_flows ────────────────────────────────────────────────────────────────

test('tpl_flows returns the WABA flows list for the resolved inbox', async () => {
  const reads = { getWhatsappCredsAll: async () => [{ inboxId: 1, token: 'tok', wabaId: 'W1' }] };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/app?')) return { ok: true, status: 200, json: async () => ({ id: 'app1' }) };
    if (u.includes('/flows?')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'f1', name: 'Flow A', status: 'PUBLISHED', extra: 'drop-me' }] }) };
    throw new Error(`unexpected url: ${u}`);
  };
  const res = await handleTemplatesAction(1, 'tpl_flows', { inbox_id: 1 }, { reads, fetchImpl });
  assert.deepEqual(res.data, [{ id: 'f1', name: 'Flow A', status: 'PUBLISHED' }]);
});
