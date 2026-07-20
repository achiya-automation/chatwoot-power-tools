import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builderReducer, emptyCard } from '../src/lib/builderState.js';
import { emptyTemplate, deserializeTemplate, serializeTemplate } from '../src/lib/templateRules.js';

function withButtons(n, type) {
  return Array.from({ length: n }, () => ({ type, text: 'x' }));
}

// ---------------------------------------------------------------------------
// caps
// ---------------------------------------------------------------------------

test('add_button: total cap of 10 — the 11th button is a no-op', () => {
  const state = { ...emptyTemplate(), buttons: withButtons(10, 'QUICK_REPLY') };
  const next = builderReducer(state, { type: 'add_button', btnType: 'PHONE_NUMBER' });
  assert.equal(next, state); // reference-equal — a true no-op, not just same length
  assert.equal(next.buttons.length, 10);
});

test('add_button: per-type cap — a 3rd URL button is a no-op', () => {
  let state = emptyTemplate();
  state = builderReducer(state, { type: 'add_button', btnType: 'URL' });
  state = builderReducer(state, { type: 'add_button', btnType: 'URL' });
  assert.equal(state.buttons.length, 2);
  const next = builderReducer(state, { type: 'add_button', btnType: 'URL' });
  assert.equal(next, state);
  assert.equal(next.buttons.length, 2);
});

test('add_button: unknown button type is a no-op', () => {
  const state = emptyTemplate();
  const next = builderReducer(state, { type: 'add_button', btnType: 'NOT_A_TYPE' });
  assert.equal(next, state);
});

// ---------------------------------------------------------------------------
// category -> AUTHENTICATION
// ---------------------------------------------------------------------------

test('set_field category: switching to AUTHENTICATION clears header/footer/buttons, keeps name+language', () => {
  const state = {
    ...emptyTemplate(),
    name: 'promo',
    language: 'en',
    header: { format: 'TEXT', text: 'Hi', example: '', mediaHandle: '' },
    footer: 'Bye',
    buttons: [{ type: 'QUICK_REPLY', text: 'Go' }],
  };
  const next = builderReducer(state, { type: 'set_field', field: 'category', value: 'AUTHENTICATION' });
  assert.equal(next.category, 'AUTHENTICATION');
  assert.equal(next.name, 'promo');
  assert.equal(next.language, 'en');
  assert.equal(next.header.format, 'NONE');
  assert.equal(next.footer, '');
  assert.deepEqual(next.buttons, []);
});

test('set_field category: switching away from AUTHENTICATION restores empty standard fields', () => {
  const state = {
    ...emptyTemplate(),
    name: 'otp',
    category: 'AUTHENTICATION',
    header: { format: 'TEXT', text: 'stale', example: '', mediaHandle: '' },
    buttons: [{ type: 'QUICK_REPLY', text: 'stale' }],
  };
  const next = builderReducer(state, { type: 'set_field', field: 'category', value: 'MARKETING' });
  assert.equal(next.category, 'MARKETING');
  assert.equal(next.name, 'otp');
  assert.deepEqual(next.body, { text: '', examples: [] });
  assert.equal(next.header.format, 'NONE');
  assert.deepEqual(next.buttons, []);
});

test('set_field category: MARKETING <-> UTILITY preserves everything but clears ttlSeconds on MARKETING', () => {
  const state = { ...emptyTemplate(), category: 'UTILITY', ttlSeconds: 3600, footer: 'Bye' };
  const toMarketing = builderReducer(state, { type: 'set_field', field: 'category', value: 'MARKETING' });
  assert.equal(toMarketing.ttlSeconds, null);
  assert.equal(toMarketing.footer, 'Bye');
  const backToUtility = builderReducer(toMarketing, { type: 'set_field', field: 'category', value: 'UTILITY' });
  assert.equal(backToUtility.footer, 'Bye');
});

// ---------------------------------------------------------------------------
// header format switch
// ---------------------------------------------------------------------------

test('set_header: format switch clears text/example/mediaHandle', () => {
  const state = { ...emptyTemplate(), header: { format: 'TEXT', text: 'Deal for {{1}}', example: 'Dana', mediaHandle: '' } };
  const next = builderReducer(state, { type: 'set_header', field: 'format', value: 'IMAGE' });
  assert.deepEqual(next.header, { format: 'IMAGE', text: '', example: '', mediaHandle: '' });
});

test('set_header: non-format field patches in place', () => {
  const state = { ...emptyTemplate(), header: { format: 'TEXT', text: '', example: '', mediaHandle: '' } };
  const next = builderReducer(state, { type: 'set_header', field: 'text', value: 'Hello' });
  assert.equal(next.header.text, 'Hello');
  assert.equal(next.header.format, 'TEXT');
});

// ---------------------------------------------------------------------------
// body variables <-> examples
// ---------------------------------------------------------------------------

test('set_body: adding a variable appends an empty example slot, preserving existing ones', () => {
  let state = { ...emptyTemplate(), body: { text: 'Hi {{1}}', examples: ['Dana'] } };
  state = builderReducer(state, { type: 'set_body', text: 'Hi {{1}} and {{2}}' });
  assert.deepEqual(state.body.examples, ['Dana', '']);
});

test('set_body: removing a variable drops its slot, preserving the rest', () => {
  let state = { ...emptyTemplate(), body: { text: 'Hi {{1}} and {{2}}', examples: ['Dana', 'Cohen'] } };
  state = builderReducer(state, { type: 'set_body', text: 'Hi {{1}}' });
  assert.deepEqual(state.body.examples, ['Dana']);
});

test('set_body: NAMED format preserves examples by param_name', () => {
  let state = { ...emptyTemplate(), parameterFormat: 'NAMED', body: { text: 'Hi {{first_name}}', examples: [{ param_name: 'first_name', example: 'Dana' }] } };
  state = builderReducer(state, { type: 'set_body', text: 'Hi {{first_name}}, see {{item}}' });
  assert.deepEqual(state.body.examples, [
    { param_name: 'first_name', example: 'Dana' },
    { param_name: 'item', example: '' },
  ]);
});

test('set_body_example: positional index writes by array position', () => {
  let state = { ...emptyTemplate(), body: { text: 'Hi {{1}} and {{2}}', examples: ['', ''] } };
  state = builderReducer(state, { type: 'set_body_example', index: 1, value: 'Cohen' });
  assert.deepEqual(state.body.examples, ['', 'Cohen']);
});

test('set_body_example: named param writes/creates by name', () => {
  let state = { ...emptyTemplate(), parameterFormat: 'NAMED', body: { text: 'Hi {{first_name}}', examples: [] } };
  state = builderReducer(state, { type: 'set_body_example', name: 'first_name', value: 'Dana' });
  assert.deepEqual(state.body.examples, [{ param_name: 'first_name', example: 'Dana' }]);
});

test('set_field parameterFormat: switching to NAMED reshapes stale positional examples', () => {
  const state = { ...emptyTemplate(), body: { text: 'Hi {{first_name}}', examples: ['Dana'] } };
  const next = builderReducer(state, { type: 'set_field', field: 'parameterFormat', value: 'NAMED' });
  assert.deepEqual(next.body.examples, [{ param_name: 'first_name', example: '' }]);
});

// ---------------------------------------------------------------------------
// carousel
// ---------------------------------------------------------------------------

test('toggle_carousel: turning on inits 2 empty cards and clears header/footer/buttons', () => {
  const state = {
    ...emptyTemplate(),
    header: { format: 'TEXT', text: 'Hi', example: '', mediaHandle: '' },
    footer: 'Bye',
    buttons: [{ type: 'QUICK_REPLY', text: 'Go' }],
  };
  const next = builderReducer(state, { type: 'toggle_carousel' });
  assert.equal(next.carousel.cards.length, 2);
  assert.deepEqual(next.carousel.cards[0], emptyCard());
  assert.deepEqual(next.carousel.cards[1], emptyCard());
  assert.equal(next.header.format, 'NONE');
  assert.equal(next.footer, '');
  assert.deepEqual(next.buttons, []);
});

test('toggle_carousel: turning off sets carousel back to null', () => {
  const state = { ...emptyTemplate(), carousel: { cards: [emptyCard(), emptyCard()] } };
  const next = builderReducer(state, { type: 'toggle_carousel' });
  assert.equal(next.carousel, null);
});

test('carousel_add_card: respects the 10-card ceiling and inherits the shared header format', () => {
  let state = builderReducer(emptyTemplate(), { type: 'toggle_carousel' });
  state = builderReducer(state, { type: 'carousel_update_card', index: 0, patch: { headerFormat: 'IMAGE' } });
  state = builderReducer(state, { type: 'carousel_add_card' });
  assert.equal(state.carousel.cards.length, 3);
  assert.equal(state.carousel.cards[2].headerFormat, 'IMAGE');
  for (let i = 0; i < 7; i += 1) state = builderReducer(state, { type: 'carousel_add_card' });
  assert.equal(state.carousel.cards.length, 10);
  const next = builderReducer(state, { type: 'carousel_add_card' });
  assert.equal(next, state); // no-op past the ceiling
});

test('carousel_remove_card: respects the 2-card floor', () => {
  let state = builderReducer(emptyTemplate(), { type: 'toggle_carousel' });
  const next = builderReducer(state, { type: 'carousel_remove_card', index: 0 });
  assert.equal(next, state); // no-op — already at the floor of 2
});

test('carousel_update_card: body change recomputes that card examples (POSITIONAL, always)', () => {
  let state = builderReducer(emptyTemplate(), { type: 'toggle_carousel' });
  state = builderReducer(state, { type: 'carousel_update_card', index: 0, patch: { body: 'Hi {{1}}' } });
  assert.deepEqual(state.carousel.cards[0].examples, ['']);
});

// ---------------------------------------------------------------------------
// carousel card buttons — caps + restricted types
// ---------------------------------------------------------------------------

test('card_add_button: caps at 2 buttons per card', () => {
  let state = builderReducer(emptyTemplate(), { type: 'toggle_carousel' });
  state = builderReducer(state, { type: 'card_add_button', index: 0, btnType: 'URL' });
  state = builderReducer(state, { type: 'card_add_button', index: 0, btnType: 'PHONE_NUMBER' });
  assert.equal(state.carousel.cards[0].buttons.length, 2);
  const next = builderReducer(state, { type: 'card_add_button', index: 0, btnType: 'QUICK_REPLY' });
  assert.equal(next, state);
  assert.equal(next.carousel.cards[0].buttons.length, 2);
});

test('card_add_button: only CAROUSEL_CARD_BUTTON_TYPES allowed — FLOW is a no-op', () => {
  const state = builderReducer(emptyTemplate(), { type: 'toggle_carousel' });
  const next = builderReducer(state, { type: 'card_add_button', index: 0, btnType: 'FLOW' });
  assert.equal(next, state);
  assert.equal(next.carousel.cards[0].buttons.length, 0);
});

test('card_update_button / card_remove_button: target the right card and button', () => {
  let state = builderReducer(emptyTemplate(), { type: 'toggle_carousel' });
  state = builderReducer(state, { type: 'card_add_button', index: 1, btnType: 'URL' });
  state = builderReducer(state, { type: 'card_update_button', index: 1, buttonIndex: 0, patch: { text: 'Shop' } });
  assert.equal(state.carousel.cards[1].buttons[0].text, 'Shop');
  assert.equal(state.carousel.cards[0].buttons.length, 0);
  state = builderReducer(state, { type: 'card_remove_button', index: 1, buttonIndex: 0 });
  assert.equal(state.carousel.cards[1].buttons.length, 0);
});

// ---------------------------------------------------------------------------
// LTO / AUTH
// ---------------------------------------------------------------------------

test('toggle_lto: on seeds an empty offer with expiration on; off clears it', () => {
  const on = builderReducer(emptyTemplate(), { type: 'toggle_lto' });
  assert.deepEqual(on.lto, { text: '', hasExpiration: true });
  const off = builderReducer(on, { type: 'toggle_lto' });
  assert.equal(off.lto, null);
});

test('set_auth: patches the auth sub-object', () => {
  const next = builderReducer(emptyTemplate(), { type: 'set_auth', patch: { expirationMinutes: 5 } });
  assert.equal(next.auth.expirationMinutes, 5);
  assert.equal(next.auth.otpType, 'copy_code'); // untouched fields survive
});

// ---------------------------------------------------------------------------
// name auto-slug
// ---------------------------------------------------------------------------

test('set_field name: auto-slugs on every keystroke', () => {
  const next = builderReducer(emptyTemplate(), { type: 'set_field', field: 'name', value: 'My Promo!' });
  assert.equal(next.name, 'my_promo');
});

// ---------------------------------------------------------------------------
// deserializeCard fix (Task 3 review gap) — per-card examples now round-trip
// ---------------------------------------------------------------------------

test('deserializeTemplate: carousel card body example round-trips into card.examples', () => {
  const g = {
    name: 'car_deser', language: 'he', category: 'MARKETING',
    components: [
      { type: 'BODY', text: 'Check these:' },
      { type: 'CAROUSEL', cards: [
        { components: [
          { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['h1'] } },
          { type: 'BODY', text: 'Hi {{1}}', example: { body_text: [['Dana']] } },
        ] },
        { components: [
          { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['h2'] } },
          { type: 'BODY', text: 'Card two' },
        ] },
      ] },
    ],
  };

  const ui = deserializeTemplate(g);
  assert.deepEqual(ui.carousel.cards[0].examples, ['Dana']);
  assert.deepEqual(ui.carousel.cards[1].examples, []);

  // Round-trip: re-serializing the deserialized UI state must reproduce the same example.
  const reser = serializeTemplate(ui);
  const car = reser.components.find((c) => c.type === 'CAROUSEL');
  const body0 = car.cards[0].components.find((c) => c.type === 'BODY');
  assert.deepEqual(body0, { type: 'BODY', text: 'Hi {{1}}', example: { body_text: [['Dana']] } });
});
