import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from '../src/chatwoot.js';

test('patchAttrs merges with existing custom_attributes (preserves sequence) via POST', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    // GET conversation → return existing attrs incl. the agent's `sequence` input
    if (!opts || opts.method !== 'POST') return { ok: true, json: async () => ({ custom_attributes: { sequence: 'welcome' } }) };
    return { ok: true, json: async () => ({}) };
  };
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  await c.patchAttrs(42, { seq_step: 2 });
  const post = calls.find((x) => x.opts && x.opts.method === 'POST');
  assert.match(post.url, /\/api\/v1\/accounts\/1\/conversations\/42\/custom_attributes$/);
  const attrs = JSON.parse(post.opts.body).custom_attributes;
  assert.equal(attrs.sequence, 'welcome', 'existing sequence input must be preserved');
  assert.equal(attrs.seq_step, 2, 'new reflected attr merged in');
  assert.equal(post.opts.headers.api_access_token, 'T');
});

test('setSequence assigns the sequence key, preserving other attributes', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (!opts || opts.method !== 'POST') return { ok: true, json: async () => ({ custom_attributes: { seq_step: 2, foo: 'bar' } }) };
    return { ok: true, json: async () => ({}) };
  };
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  await c.setSequence(42, 'welcome');
  const post = calls.find((x) => x.opts && x.opts.method === 'POST');
  const attrs = JSON.parse(post.opts.body).custom_attributes;
  assert.equal(attrs.sequence, 'welcome', 'sequence assigned');
  assert.equal(attrs.seq_step, 2, 'preserves other attrs');
  assert.equal(attrs.foo, 'bar');
});

test('setSequence with falsy key REMOVES the sequence attribute (opt-out)', async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (!opts || opts.method !== 'POST') return { ok: true, json: async () => ({ custom_attributes: { sequence: 'welcome', seq_step: 2 } }) };
    return { ok: true, json: async () => ({}) };
  };
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  await c.setSequence(42, null);
  const post = calls.find((x) => x.opts && x.opts.method === 'POST');
  const attrs = JSON.parse(post.opts.body).custom_attributes;
  assert.equal('sequence' in attrs, false, 'sequence key removed entirely');
  assert.equal(attrs.seq_step, 2, 'other attrs preserved');
});

test('sendTemplate sends correct body shape (n8n-authoritative)', async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ id: 99 }) };
  };
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  const res = await c.sendTemplate(7, { name: 'hello_world', language: 'en', category: 'MARKETING', params: ['Alice'] });
  assert.match(captured.url, /\/api\/v1\/accounts\/1\/conversations\/7\/messages$/);
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.template_params.name, 'hello_world');
  assert.equal(body.template_params.language, 'en');
  assert.equal(body.template_params.category, 'MARKETING');
  assert.deepEqual(body.template_params.processed_params, { '1': 'Alice' });
  assert.equal(captured.opts.headers.api_access_token, 'T');
  assert.equal(res.id, 99); // returns { id, content } now
});

test('sendTemplate renders the body into content (visible in the conversation thread)', async () => {
  let sendBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith('/inboxes')) {
      return { ok: true, json: async () => ({ payload: [{ message_templates: [
        { name: 'welcome', language: 'he', status: 'APPROVED', components: [{ type: 'BODY', text: 'היי {{1}}, תודה!' }] },
      ] }] }) };
    }
    sendBody = JSON.parse(opts.body); // the /messages POST
    return { ok: true, json: async () => ({ id: 7 }) };
  };
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  const res = await c.sendTemplate(5, { name: 'welcome', language: 'he', category: 'MARKETING', params: ['דנה'] });
  assert.equal(res.id, 7);
  assert.equal(res.content, 'היי דנה, תודה!', 'returned content = rendered body (for send history)');
  assert.equal(sendBody.content, 'היי דנה, תודה!', 'content = rendered body so the agent sees the message');
  assert.deepEqual(sendBody.template_params.processed_params, { '1': 'דנה' });
});

test('sendTemplate stays body-only for image-header templates when NO mediaUrl is given', async () => {
  // Without a media_url for the step we cannot attach the header → send body-only
  // (the template's example.header_handle is NOT usable as media_url — 403 → 131053).
  let sendBody = null;
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith('/inboxes')) {
      return { ok: true, json: async () => ({ payload: [{ message_templates: [
        { name: 'promo', language: 'he', status: 'APPROVED', components: [
          { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://cdn/x.jpg'] } },
          { type: 'BODY', text: 'היי {{1}}' },
          { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'כן' }] },
        ] },
      ] }] }) };
    }
    sendBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: 8 }) };
  };
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  await c.sendTemplate(5, { name: 'promo', language: 'he', category: 'MARKETING', params: ['דנה'] });
  const pp = sendBody.template_params.processed_params;
  assert.deepEqual(pp, { '1': 'דנה' }, 'body-only — no header attached without mediaUrl');
  assert.equal(sendBody.content, 'היי דנה', 'body still rendered into content for display');
});

// ── media header (enhanced format) ──
const imageTplFetch = (sendBodyRef) => async (url, opts) => {
  if (String(url).endsWith('/inboxes')) {
    return { ok: true, json: async () => ({ payload: [{ message_templates: [
      { name: 'promo_img', language: 'he', status: 'APPROVED', components: [
        { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['https://scontent.whatsapp.net/x.jpg'] } },
        { type: 'BODY', text: 'היי {{1}}' },
      ] },
    ] }] }) };
  }
  sendBodyRef.body = JSON.parse(opts.body);
  return { ok: true, json: async () => ({ id: 9 }) };
};

test('sendTemplate attaches ENHANCED media header for IMAGE-header template + mediaUrl', async () => {
  const ref = {};
  globalThis.fetch = imageTplFetch(ref);
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  const res = await c.sendTemplate(5, {
    name: 'promo_img', language: 'he', category: 'MARKETING',
    params: ['דנה'], mediaUrl: 'https://mycdn.example/ad.jpg',
  });
  assert.equal(res.id, 9);
  const pp = ref.body.template_params.processed_params;
  assert.deepEqual(pp.body, { '1': 'דנה' }, 'body params nested under body key (enhanced)');
  assert.deepEqual(pp.header, { media_url: 'https://mycdn.example/ad.jpg', media_type: 'image' },
    'media header attached with our public url + resolved type');
  assert.equal(ref.body.content, 'היי דנה');
});

test('sendTemplate stays flat when a media-header template has NO mediaUrl', async () => {
  const ref = {};
  globalThis.fetch = imageTplFetch(ref);
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  await c.sendTemplate(5, { name: 'promo_img', language: 'he', category: 'MARKETING', params: ['דנה'] });
  const pp = ref.body.template_params.processed_params;
  assert.deepEqual(pp, { '1': 'דנה' }, 'no mediaUrl → flat body-only (cannot attach media)');
});

test('sendTemplate ignores mediaUrl when the template header is NOT media (TEXT)', async () => {
  const ref = {};
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith('/inboxes')) {
      return { ok: true, json: async () => ({ payload: [{ message_templates: [
        { name: 'text_hdr', language: 'he', status: 'APPROVED', components: [
          { type: 'HEADER', format: 'TEXT', text: 'כותרת' },
          { type: 'BODY', text: 'היי {{1}}' },
        ] },
      ] }] }) };
    }
    ref.body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ id: 10 }) };
  };
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  await c.sendTemplate(5, { name: 'text_hdr', language: 'he', category: 'MARKETING', params: ['דנה'], mediaUrl: 'https://x.example/a.jpg' });
  const pp = ref.body.template_params.processed_params;
  assert.deepEqual(pp, { '1': 'דנה' }, 'text header → mediaUrl ignored, stays flat body-only');
});

test('getContact extracts name/phone/email from conversation meta', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ meta: { sender: { name: 'Dana', phone_number: '+972501234567', email: 'd@x.com' } } }),
  });
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  const contact = await c.getContact(5);
  assert.equal(contact.name, 'Dana');
  assert.equal(contact.phone, '+972501234567');
  assert.equal(contact.email, 'd@x.com');
});

test('incomingSince returns true when there is a newer incoming message', async () => {
  const ts = Math.floor(new Date('2026-06-20T10:00:00Z').getTime() / 1000);
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ payload: [{ message_type: 0, created_at: ts }] }),
  });
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  const result = await c.incomingSince(3, '2026-06-19T00:00:00Z');
  assert.equal(result, true);
});

test('incomingSince returns false when no incoming message after sinceISO', async () => {
  const ts = Math.floor(new Date('2026-06-18T10:00:00Z').getTime() / 1000);
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ payload: [{ message_type: 0, created_at: ts }] }),
  });
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  const result = await c.incomingSince(3, '2026-06-19T00:00:00Z');
  assert.equal(result, false);
});

test('listTemplates: case-insensitive APPROVED filter and dedup across inboxes', async () => {
  // inbox 1: one APPROVED (uppercase), one approved (lowercase), one PENDING
  // inbox 2: duplicate of the first APPROVED template (same name+language)
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      payload: [
        {
          message_templates: [
            { name: 'welcome', language: 'en', status: 'APPROVED', category: 'MARKETING' },
            { name: 'followup', language: 'he', status: 'approved', category: 'MARKETING' },
            { name: 'draft_tpl', language: 'en', status: 'PENDING', category: 'MARKETING' },
          ],
        },
        {
          message_templates: [
            { name: 'welcome', language: 'en', status: 'APPROVED', category: 'MARKETING' }, // duplicate
            { name: 'promo', language: 'en', status: 'APPROVED', category: 'MARKETING' },
          ],
        },
      ],
    }),
  });
  const c = makeClient({ baseUrl: 'http://r:3000', token: 'T', accountId: 1 });
  const templates = await c.listTemplates();

  // Only approved templates, no PENDING
  assert.ok(templates.every((t) => String(t.status || '').toUpperCase() === 'APPROVED'), 'all returned templates are APPROVED');

  // Deduplication: welcome+en appears in both inboxes but must appear only once
  const welcomeTemplates = templates.filter((t) => t.name === 'welcome' && t.language === 'en');
  assert.equal(welcomeTemplates.length, 1, 'duplicate welcome|en collapsed to one');

  // Case-insensitive: lowercase 'approved' is included
  const followup = templates.find((t) => t.name === 'followup');
  assert.ok(followup, 'lowercase approved status is accepted');

  // Total: welcome (deduped) + followup + promo = 3
  assert.equal(templates.length, 3, 'exactly 3 unique approved templates returned');
});
