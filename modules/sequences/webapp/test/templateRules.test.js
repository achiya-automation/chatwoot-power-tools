import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyTemplate,
  validateTemplate,
  serializeTemplate,
  deserializeTemplate,
  warningsFor,
  bodyVars,
  BUTTON_TYPES,
} from '../src/lib/templateRules.js';

// ---------------------------------------------------------------------------
// Brief golden suite (verbatim floor) — task-3-brief.md Step 1
// ---------------------------------------------------------------------------

test('serialize: text header + body vars + footer + url/phone/quick-reply buttons', () => {
  const t = { ...emptyTemplate(), name: 'august_offer', category: 'MARKETING',
    header: { format: 'TEXT', text: 'Deal for {{1}}', example: 'Dana', mediaHandle: '' },
    body: { text: 'Hi {{1}}, sale on {{2}}!', examples: ['Dana', 'Premium'] },
    footer: 'Reply STOP to opt out',
    buttons: [
      { type: 'URL', text: 'Our site', url: 'https://x.co/{{1}}', urlExample: 'https://x.co/promo' },
      { type: 'PHONE_NUMBER', text: 'Call us', phone: '+972501234567' },
      { type: 'QUICK_REPLY', text: 'Talk to me' },
    ] };
  const s = serializeTemplate(t);
  assert.equal(s.name, 'august_offer');
  assert.equal(s.allow_category_change, true);
  const header = s.components.find((c) => c.type === 'HEADER');
  assert.deepEqual(header, { type: 'HEADER', format: 'TEXT', text: 'Deal for {{1}}', example: { header_text: ['Dana'] } });
  const body = s.components.find((c) => c.type === 'BODY');
  assert.deepEqual(body.example, { body_text: [['Dana', 'Premium']] });
  const btns = s.components.find((c) => c.type === 'BUTTONS').buttons;
  assert.deepEqual(btns[0], { type: 'URL', text: 'Our site', url: 'https://x.co/{{1}}', example: ['https://x.co/promo'] });
  assert.deepEqual(btns[1], { type: 'PHONE_NUMBER', text: 'Call us', phone_number: '+972501234567' });
  assert.deepEqual(btns[2], { type: 'QUICK_REPLY', text: 'Talk to me' });
});

test('serialize: media header uses header_handle example', () => {
  const t = { ...emptyTemplate(), name: 'x', header: { format: 'IMAGE', text: '', example: '', mediaHandle: '4::aW1h...' }, body: { text: 'hi', examples: [] } };
  const h = serializeTemplate(t).components.find((c) => c.type === 'HEADER');
  assert.deepEqual(h, { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::aW1h...'] } });
});

test('serialize: authentication template has fixed structure', () => {
  const t = { ...emptyTemplate(), name: 'otp', category: 'AUTHENTICATION',
    auth: { otpType: 'copy_code', securityRecommendation: true, expirationMinutes: 5 } };
  const s = serializeTemplate(t);
  assert.deepEqual(s.components, [
    { type: 'BODY', add_security_recommendation: true },
    { type: 'FOOTER', code_expiration_minutes: 5 },
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'copy_code' }] },
  ]);
});

test('serialize: carousel cards', () => {
  const t = { ...emptyTemplate(), name: 'car', body: { text: 'Check these:', examples: [] },
    carousel: { cards: [
      { headerFormat: 'IMAGE', mediaHandle: 'h1', body: 'Card one', buttons: [{ type: 'QUICK_REPLY', text: 'Pick' }] },
      { headerFormat: 'IMAGE', mediaHandle: 'h2', body: 'Card two', buttons: [{ type: 'URL', text: 'See', url: 'https://x.co' }] },
    ] } };
  const car = serializeTemplate(t).components.find((c) => c.type === 'CAROUSEL');
  assert.equal(car.cards.length, 2);
  assert.deepEqual(car.cards[0].components.find((c) => c.type === 'HEADER'),
    { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['h1'] } });
});

test('serialize: limited-time offer', () => {
  const t = { ...emptyTemplate(), name: 'lto', body: { text: 'Sale!', examples: [] },
    lto: { text: 'Ends soon', hasExpiration: true },
    buttons: [
      { type: 'COPY_CODE', code: 'SAVE20' },
      { type: 'URL', text: 'Shop', url: 'https://x.co' },
    ] };
  const s = serializeTemplate(t);
  assert.deepEqual(s.components.find((c) => c.type === 'LIMITED_TIME_OFFER'),
    { type: 'LIMITED_TIME_OFFER', limited_time_offer: { text: 'Ends soon', has_expiration: true } });
  assert.deepEqual(s.components.find((c) => c.type === 'BUTTONS').buttons[0],
    { type: 'COPY_CODE', example: 'SAVE20' });
});

test('serialize: named parameters set parameter_format and named examples', () => {
  const t = { ...emptyTemplate(), name: 'n', parameterFormat: 'NAMED',
    body: { text: 'Hi {{first_name}}', examples: [{ param_name: 'first_name', example: 'Dana' }] } };
  const s = serializeTemplate(t);
  assert.equal(s.parameter_format, 'NAMED');
  assert.deepEqual(s.components.find((c) => c.type === 'BODY').example,
    { body_text_named_params: [{ param_name: 'first_name', example: 'Dana' }] });
});

test('validate: name slug, var without example, body required, button caps', () => {
  const bad = { ...emptyTemplate(), name: 'Bad Name!', body: { text: 'Hi {{1}}', examples: [] } };
  const errs = validateTemplate(bad).map((e) => e.field);
  assert.ok(errs.includes('name'));
  assert.ok(errs.includes('body.examples'));
  const manyUrls = { ...emptyTemplate(), name: 'ok_name', body: { text: 'x', examples: [] },
    buttons: [1, 2, 3].map(() => ({ type: 'URL', text: 'a', url: 'https://x.co' })) };
  assert.ok(validateTemplate(manyUrls).some((e) => e.field === 'buttons'));
});

test('warnings: near-duplicate name and single-var body', () => {
  const t = { ...emptyTemplate(), name: 'promo_2', body: { text: '{{1}}', examples: ['x'] } };
  const w = warningsFor(t, [{ name: 'promo_1', components: [] }]).map((x) => x.kind);
  assert.ok(w.includes('near_duplicate'));
  assert.ok(w.includes('single_var_body'));
});

test('bodyVars: positional and named', () => {
  assert.deepEqual(bodyVars('Hi {{1}} and {{2}}'), ['1', '2']);
  assert.deepEqual(bodyVars('Hi {{first_name}}'), ['first_name']);
});

test('deserialize round-trips a standard graph template into UI state', () => {
  const g = { name: 'p', language: 'he', category: 'MARKETING', components: [
    { type: 'HEADER', format: 'TEXT', text: 'T {{1}}', example: { header_text: ['a'] } },
    { type: 'BODY', text: 'B {{1}}', example: { body_text: [['a']] } },
    { type: 'FOOTER', text: 'F' },
    { type: 'BUTTONS', buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phone_number: '+9725' }] },
  ] };
  const ui = deserializeTemplate(g);
  assert.equal(ui.header.format, 'TEXT');
  assert.equal(ui.footer, 'F');
  assert.equal(ui.buttons[0].type, 'PHONE_NUMBER');
  assert.equal(serializeTemplate(ui).components.length, 4);
});

// ---------------------------------------------------------------------------
// Extensions — Task 0 live-verification corrections (2026-07-20-template-studio-verification.md)
// ---------------------------------------------------------------------------

test('serialize: VOICE_CALL button (verification 6a — new button type, no phone field)', () => {
  const t = { ...emptyTemplate(), name: 'call_me', body: { text: 'Ready to chat?', examples: [] },
    buttons: [{ type: 'VOICE_CALL', text: 'Call on WhatsApp' }] };
  const btns = serializeTemplate(t).components.find((c) => c.type === 'BUTTONS').buttons;
  assert.deepEqual(btns[0], { type: 'VOICE_CALL', text: 'Call on WhatsApp' });
});

test('BUTTON_TYPES: VOICE_CALL caps at 1 and combines cleanly with URL', () => {
  assert.equal(BUTTON_TYPES.VOICE_CALL.max, 1);
  const t = { ...emptyTemplate(), name: 'vc', body: { text: 'x', examples: [] },
    buttons: [{ type: 'VOICE_CALL', text: 'Call' }, { type: 'URL', text: 'Site', url: 'https://x.co' }] };
  assert.deepEqual(validateTemplate(t), []);
});

test('validate: QUICK_REPLY buttons interleaved with other types is rejected (verification 6i)', () => {
  const t = { ...emptyTemplate(), name: 'grouped_bad', body: { text: 'x', examples: [] },
    buttons: [
      { type: 'QUICK_REPLY', text: 'Yes' },
      { type: 'URL', text: 'Site', url: 'https://x.co' },
      { type: 'QUICK_REPLY', text: 'No' },
    ] };
  assert.ok(validateTemplate(t).some((e) => e.field === 'buttons'));
});

test('validate: QUICK_REPLY buttons grouped together passes', () => {
  const t = { ...emptyTemplate(), name: 'grouped_ok', body: { text: 'x', examples: [] },
    buttons: [
      { type: 'URL', text: 'Site', url: 'https://x.co' },
      { type: 'QUICK_REPLY', text: 'Yes' },
      { type: 'QUICK_REPLY', text: 'No' },
    ] };
  assert.deepEqual(validateTemplate(t), []);
});

test('validate: carousel needs at least 2 cards (verification 6e)', () => {
  const t = { ...emptyTemplate(), name: 'car_one', body: { text: 'Check:', examples: [] },
    carousel: { cards: [{ headerFormat: 'IMAGE', mediaHandle: 'h1', body: 'Only card', buttons: [] }] } };
  assert.ok(validateTemplate(t).some((e) => e.field === 'carousel'));
});

test('validate: carousel card body over 160 chars is rejected (verification 6e)', () => {
  const t = { ...emptyTemplate(), name: 'car_long', body: { text: 'Check:', examples: [] },
    carousel: { cards: [
      { headerFormat: 'IMAGE', mediaHandle: 'h1', body: 'x'.repeat(161), buttons: [] },
      { headerFormat: 'IMAGE', mediaHandle: 'h2', body: 'short', buttons: [] },
    ] } };
  assert.ok(validateTemplate(t).some((e) => e.field === 'carousel'));
});

test('validate: carousel card buttons restricted to QUICK_REPLY/PHONE_NUMBER/URL (verification 6e)', () => {
  const t = { ...emptyTemplate(), name: 'car_flow', body: { text: 'Check:', examples: [] },
    carousel: { cards: [
      { headerFormat: 'IMAGE', mediaHandle: 'h1', body: 'One', buttons: [{ type: 'FLOW', text: 'Go' }] },
      { headerFormat: 'IMAGE', mediaHandle: 'h2', body: 'Two', buttons: [] },
    ] } };
  assert.ok(validateTemplate(t).some((e) => e.field === 'carousel'));
});

test('validate: LTO template cannot carry a footer (verification 6f)', () => {
  const t = { ...emptyTemplate(), name: 'lto_footer', body: { text: 'Sale!', examples: [] },
    footer: 'Reply STOP', lto: { text: 'Ends soon', hasExpiration: true } };
  assert.ok(validateTemplate(t).some((e) => e.field === 'footer'));
});

test('validate: MARKETING category rejects ttlSeconds (resolved open question 2)', () => {
  const t = { ...emptyTemplate(), name: 'mk_ttl', category: 'MARKETING',
    body: { text: 'x', examples: [] }, ttlSeconds: 86400 };
  assert.ok(validateTemplate(t).some((e) => e.field === 'ttlSeconds'));
});

test('serialize: UTILITY category serializes message_send_ttl_seconds', () => {
  const t = { ...emptyTemplate(), name: 'util_ttl', category: 'UTILITY',
    body: { text: 'Your order shipped', examples: [] }, ttlSeconds: 3600 };
  assert.deepEqual(validateTemplate(t), []);
  assert.equal(serializeTemplate(t).message_send_ttl_seconds, 3600);
});

test('serialize: MARKETING never emits message_send_ttl_seconds even if set', () => {
  const t = { ...emptyTemplate(), name: 'mk_ttl2', category: 'MARKETING',
    body: { text: 'x', examples: [] }, ttlSeconds: 86400 };
  assert.equal(serializeTemplate(t).message_send_ttl_seconds, undefined);
});

test('validate: standalone marketing COPY_CODE allows up to 20 chars (verification 6b)', () => {
  const t20 = { ...emptyTemplate(), name: 'coupon20', body: { text: 'Save big', examples: [] },
    buttons: [{ type: 'COPY_CODE', code: 'A'.repeat(20) }] };
  assert.deepEqual(validateTemplate(t20), []);
  const t21 = { ...t20, name: 'coupon21', buttons: [{ type: 'COPY_CODE', code: 'A'.repeat(21) }] };
  assert.ok(validateTemplate(t21).some((e) => e.field === 'buttons'));
});

test('validate: COPY_CODE inside an LTO template caps at 15 chars (conservative bound, docs conflict)', () => {
  const t16 = { ...emptyTemplate(), name: 'lto_code16', body: { text: 'Sale!', examples: [] },
    lto: { text: 'Ends soon', hasExpiration: true },
    buttons: [{ type: 'COPY_CODE', code: 'A'.repeat(16) }] };
  assert.ok(validateTemplate(t16).some((e) => e.field === 'buttons'));
  const t15 = { ...t16, name: 'lto_code15', buttons: [{ type: 'COPY_CODE', code: 'A'.repeat(15) }] };
  assert.deepEqual(validateTemplate(t15), []);
});

test('validate: at most one FLOW button, even under the 10-button total cap (verification 6c)', () => {
  const t = { ...emptyTemplate(), name: 'two_flows', body: { text: 'x', examples: [] },
    buttons: [{ type: 'FLOW', text: 'Start' }, { type: 'FLOW', text: 'Other' }] };
  assert.ok(validateTemplate(t).some((e) => e.field === 'buttons'));
});

test('validate: AUTHENTICATION code_expiration_minutes must be 1..90', () => {
  const t = { ...emptyTemplate(), name: 'otp_bad', category: 'AUTHENTICATION',
    auth: { otpType: 'copy_code', securityRecommendation: true, expirationMinutes: 91 } };
  assert.ok(validateTemplate(t).some((e) => e.field === 'auth.expirationMinutes'));
});

test('BUTTON_TYPES: CATALOG and MPM are distinct components, each capped at 1 (verification 6d)', () => {
  assert.ok('CATALOG' in BUTTON_TYPES);
  assert.ok('MPM' in BUTTON_TYPES);
  assert.equal(BUTTON_TYPES.CATALOG.max, 1);
  assert.equal(BUTTON_TYPES.MPM.max, 1);
});

// ---------------------------------------------------------------------------
// Extensions — Task 3 review fixes: per-card carousel examples, carousel/
// top-level-component mutual exclusion (grounded against Meta's live carousel
// template docs), COPY_CODE alphanumeric check.
// ---------------------------------------------------------------------------

test('serialize: carousel card with a variable and matching example serializes body_text', () => {
  const t = { ...emptyTemplate(), name: 'car_var', body: { text: 'Check these:', examples: [] },
    carousel: { cards: [
      { headerFormat: 'IMAGE', mediaHandle: 'h1', body: 'Hi {{1}}', examples: ['Dana'], buttons: [] },
      { headerFormat: 'IMAGE', mediaHandle: 'h2', body: 'Card two', examples: [], buttons: [] },
    ] } };
  assert.deepEqual(validateTemplate(t), []);
  const car = serializeTemplate(t).components.find((c) => c.type === 'CAROUSEL');
  const body0 = car.cards[0].components.find((c) => c.type === 'BODY');
  assert.deepEqual(body0, { type: 'BODY', text: 'Hi {{1}}', example: { body_text: [['Dana']] } });
});

test('validate: carousel card variable without a matching example errors and names the card', () => {
  const t = { ...emptyTemplate(), name: 'car_no_ex', body: { text: 'Check:', examples: [] },
    carousel: { cards: [
      { headerFormat: 'IMAGE', mediaHandle: 'h1', body: 'Hi {{1}}', examples: [], buttons: [] },
      { headerFormat: 'IMAGE', mediaHandle: 'h2', body: 'Card two', examples: [], buttons: [] },
    ] } };
  const errs = validateTemplate(t);
  const carErr = errs.find((e) => e.field === 'carousel' && /card 1/i.test(e.msg_en) && /example/i.test(e.msg_en));
  assert.ok(carErr, 'expected a bilingual error naming card 1 for the missing example');
  assert.ok(/1/.test(carErr.msg_he));
});

test('validate: carousel template rejects top-level header, footer and buttons (Meta docs: only BODY may coexist with CAROUSEL)', () => {
  const t = { ...emptyTemplate(), name: 'car_excl', body: { text: 'Check:', examples: [] },
    header: { format: 'TEXT', text: 'Hello', example: '', mediaHandle: '' },
    footer: 'Bye',
    buttons: [{ type: 'QUICK_REPLY', text: 'Go' }],
    carousel: { cards: [
      { headerFormat: 'IMAGE', mediaHandle: 'h1', body: 'One', examples: [], buttons: [] },
      { headerFormat: 'IMAGE', mediaHandle: 'h2', body: 'Two', examples: [], buttons: [] },
    ] } };
  const carErrs = validateTemplate(t).filter((e) => e.field === 'carousel');
  assert.equal(carErrs.length, 3, 'expected exactly 3 exclusion errors: header, footer, buttons');
});

test('validate: carousel template with only a body (no header/footer/buttons) passes mutual-exclusion', () => {
  const t = { ...emptyTemplate(), name: 'car_clean', body: { text: 'Check:', examples: [] },
    carousel: { cards: [
      { headerFormat: 'IMAGE', mediaHandle: 'h1', body: 'One', examples: [], buttons: [] },
      { headerFormat: 'IMAGE', mediaHandle: 'h2', body: 'Two', examples: [], buttons: [] },
    ] } };
  assert.deepEqual(validateTemplate(t), []);
});

test('validate: COPY_CODE code must be alphanumeric only', () => {
  const bad = { ...emptyTemplate(), name: 'coupon_bad', body: { text: 'Save big', examples: [] },
    buttons: [{ type: 'COPY_CODE', code: 'SAVE-20!' }] };
  assert.ok(validateTemplate(bad).some((e) => e.field === 'buttons'));
  const ok = { ...bad, name: 'coupon_ok', buttons: [{ type: 'COPY_CODE', code: 'SAVE20' }] };
  assert.deepEqual(validateTemplate(ok), []);
});

// ---------------------------------------------------------------------------
// Task 3: VOICE_CALL ttlMinutes support and textMax correction
// ---------------------------------------------------------------------------

test('serialize: VOICE_CALL with ttlMinutes includes ttl_minutes key', () => {
  const t = { ...emptyTemplate(), name: 'call_ttl', body: { text: 'Ready?', examples: [] },
    buttons: [{ type: 'VOICE_CALL', text: 'Call', ttlMinutes: 2880 }] };
  const btns = serializeTemplate(t).components.find((c) => c.type === 'BUTTONS').buttons;
  assert.deepEqual(btns[0], { type: 'VOICE_CALL', text: 'Call', ttl_minutes: 2880 });
});

test('serialize: VOICE_CALL without ttlMinutes omits ttl_minutes key', () => {
  const t = { ...emptyTemplate(), name: 'call_no_ttl', body: { text: 'Ready?', examples: [] },
    buttons: [{ type: 'VOICE_CALL', text: 'Call' }] };
  const btns = serializeTemplate(t).components.find((c) => c.type === 'BUTTONS').buttons;
  assert.deepEqual(btns[0], { type: 'VOICE_CALL', text: 'Call' });
});

test('validate: VOICE_CALL ttlMinutes outside 1440–43200 range is rejected', () => {
  const t100 = { ...emptyTemplate(), name: 'call_ttl_bad', body: { text: 'x', examples: [] },
    buttons: [{ type: 'VOICE_CALL', text: 'Call', ttlMinutes: 100 }] };
  assert.ok(validateTemplate(t100).some((e) => e.field === 'buttons'));
  const t1440 = { ...t100, name: 'call_ttl_ok_min', buttons: [{ type: 'VOICE_CALL', text: 'Call', ttlMinutes: 1440 }] };
  assert.deepEqual(validateTemplate(t1440), []);
  const t43200 = { ...t100, name: 'call_ttl_ok_max', buttons: [{ type: 'VOICE_CALL', text: 'Call', ttlMinutes: 43200 }] };
  assert.deepEqual(validateTemplate(t43200), []);
});

test('validate: VOICE_CALL text exceeding 20 chars is rejected', () => {
  const t21 = { ...emptyTemplate(), name: 'call_text_long', body: { text: 'x', examples: [] },
    buttons: [{ type: 'VOICE_CALL', text: 'A'.repeat(21) }] };
  assert.ok(validateTemplate(t21).some((e) => e.field === 'buttons'));
  const t20 = { ...t21, name: 'call_text_ok', buttons: [{ type: 'VOICE_CALL', text: 'A'.repeat(20) }] };
  assert.deepEqual(validateTemplate(t20), []);
});
