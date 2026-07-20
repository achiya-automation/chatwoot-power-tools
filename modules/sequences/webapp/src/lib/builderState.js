/**
 * builderState.js — pure reducer for the Template Studio Builder (TemplateBuilder.jsx).
 * No React, no DOM: state shape is exactly templateRules.emptyTemplate(); actions are UI
 * events (set a field, add/remove a button, toggle carousel/LTO, ...). Business validation
 * and Graph serialization stay in templateRules.js — this reducer only shapes UI state, it
 * never decides whether a template is *valid* (that's validateTemplate, called live by
 * TemplateBuilder for the errors/warnings strips).
 */

import { emptyTemplate, bodyVars, BUTTON_TYPES, CAROUSEL_CARD_BUTTON_TYPES, LIMITS } from './templateRules.js';

// A carousel card isn't part of emptyTemplate() (carousel starts null) — this is the
// per-card shape templateRules.serializeCard/deserializeCard/validateCarousel expect.
export function emptyCard() {
  return { headerFormat: 'NONE', mediaHandle: '', body: '', examples: [], buttons: [] };
}

// templateRules.validateCarousel restricts carousel-card buttons to a *type* subset
// (CAROUSEL_CARD_BUTTON_TYPES) but never caps how many — Meta's carousel-card UI caps each
// card at 2 buttons, so that structural count cap lives here, reducer-local, since nothing
// in templateRules.js needs it. Exported so the Builder's "add button" menu can grey out
// the option at the same limit instead of duplicating the number.
export const CAROUSEL_CARD_BUTTONS_MAX = 2;

// name → slug as the user types: lowercase, non [a-z0-9] runs collapse to one underscore,
// no leading/trailing underscore. 'My Promo!' -> 'my_promo'.
function slugifyName(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// WhatsApp indexes {{n}} example slots by n (1-based), not by order of appearance in the
// text, so a slot's value must stay at its own index even as other variables are added or
// removed around it. NAMED params key by name instead (order is irrelevant there).
function recomputeBodyExamples(text, parameterFormat, prevExamples) {
  const vars = bodyVars(text);
  const prev = Array.isArray(prevExamples) ? prevExamples : [];
  if (parameterFormat === 'NAMED') {
    return vars.map((name) => {
      const found = prev.find((e) => e && e.param_name === name);
      return { param_name: name, example: found ? found.example || '' : '' };
    });
  }
  const nums = vars.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0);
  const maxN = nums.length ? Math.max(...nums) : 0;
  const out = [];
  for (let i = 0; i < maxN; i += 1) out.push(prev[i] != null ? prev[i] : '');
  return out;
}

function makeButton(type) {
  switch (type) {
    case 'URL': return { type, text: '', url: '', urlExample: '' };
    case 'PHONE_NUMBER': return { type, text: '', phone: '' };
    case 'COPY_CODE': return { type, code: '' };
    // ponytail: templateRules.serializeButton's FLOW case only emits {type, text} — flowId
    // isn't part of the Graph payload today. Kept on the button so the Builder's FLOW
    // <select> has a controlled value; harmless extra field, matches the existing
    // (pre-existing, out of scope here) serialize behavior rather than fighting it.
    case 'FLOW': return { type, text: '', flowId: '' };
    default: return { type, text: '' }; // QUICK_REPLY, VOICE_CALL, CATALOG, MPM
  }
}

export function builderReducer(state, action) {
  switch (action.type) {
    case 'set_field': {
      const { field, value } = action;
      if (field === 'name') return { ...state, name: slugifyName(value) };
      if (field === 'category') {
        const wasAuth = state.category === 'AUTHENTICATION';
        const isAuth = value === 'AUTHENTICATION';
        if (isAuth || wasAuth) {
          // Into AUTHENTICATION: fixed structure replaces header/body/footer/buttons/
          // carousel/lto entirely — only name/language survive. Away from it: those same
          // standard fields come back empty (whatever they held while AUTH was active is
          // meaningless — AUTH never showed them).
          return { ...emptyTemplate(), name: state.name, language: state.language, category: value };
        }
        // MARKETING <-> UTILITY: everything else stays — except ttlSeconds, which only
        // applies to UTILITY/AUTHENTICATION (validateTemplate rejects it on MARKETING);
        // clearing it here avoids stranding the user with an invisible error once the
        // advanced accordion hides the TTL field for MARKETING.
        return { ...state, category: value, ttlSeconds: value === 'MARKETING' ? null : state.ttlSeconds };
      }
      if (field === 'parameterFormat') {
        return {
          ...state,
          parameterFormat: value,
          body: { ...state.body, examples: recomputeBodyExamples(state.body.text, value, state.body.examples) },
        };
      }
      return { ...state, [field]: value };
    }

    case 'set_header': {
      const { field, value } = action;
      if (field === 'format') {
        return { ...state, header: { format: value, text: '', example: '', mediaHandle: '' } };
      }
      return { ...state, header: { ...state.header, [field]: value } };
    }

    case 'set_body': {
      const text = action.text;
      return {
        ...state,
        body: { text, examples: recomputeBodyExamples(text, state.parameterFormat, state.body.examples) },
      };
    }

    case 'set_body_example': {
      const { index, name, value } = action;
      const examples = Array.isArray(state.body.examples) ? [...state.body.examples] : [];
      if (name != null) {
        const i = examples.findIndex((e) => e && e.param_name === name);
        if (i >= 0) examples[i] = { ...examples[i], example: value };
        else examples.push({ param_name: name, example: value });
        return { ...state, body: { ...state.body, examples } };
      }
      while (examples.length <= index) examples.push('');
      examples[index] = value;
      return { ...state, body: { ...state.body, examples } };
    }

    case 'add_button': {
      const spec = BUTTON_TYPES[action.btnType];
      if (!spec) return state;
      const buttons = state.buttons || [];
      if (buttons.length >= LIMITS.buttonsTotal) return state;
      if (buttons.filter((b) => b.type === action.btnType).length >= spec.max) return state;
      return { ...state, buttons: [...buttons, makeButton(action.btnType)] };
    }

    case 'update_button': {
      const buttons = state.buttons || [];
      if (action.index < 0 || action.index >= buttons.length) return state;
      const next = [...buttons];
      next[action.index] = { ...next[action.index], ...action.patch };
      return { ...state, buttons: next };
    }

    case 'remove_button': {
      const buttons = state.buttons || [];
      return { ...state, buttons: buttons.filter((_, i) => i !== action.index) };
    }

    case 'move_button': {
      const buttons = state.buttons || [];
      const { index, dir } = action;
      const target = index + dir;
      if (index < 0 || index >= buttons.length || target < 0 || target >= buttons.length) return state;
      const next = [...buttons];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...state, buttons: next };
    }

    case 'toggle_carousel': {
      if (state.carousel) return { ...state, carousel: null };
      // Meta: a CAROUSEL template's top-level components are BODY + CAROUSEL only — no
      // top-level header/footer/buttons (validateTemplate enforces this; see templateRules.js).
      return {
        ...state,
        header: { format: 'NONE', text: '', example: '', mediaHandle: '' },
        footer: '',
        buttons: [],
        carousel: { cards: [emptyCard(), emptyCard()] },
      };
    }

    case 'carousel_add_card': {
      if (!state.carousel) return state;
      const cards = state.carousel.cards || [];
      if (cards.length >= LIMITS.carouselCards) return state;
      // Every card must share one header format (validateCarousel) — start the new card
      // already matching the rest instead of an instant, surprising mismatch error.
      const fmt = cards[0]?.headerFormat || 'NONE';
      return { ...state, carousel: { ...state.carousel, cards: [...cards, { ...emptyCard(), headerFormat: fmt }] } };
    }

    case 'carousel_remove_card': {
      if (!state.carousel) return state;
      const cards = state.carousel.cards || [];
      if (cards.length <= LIMITS.carouselCardsMin) return state;
      return { ...state, carousel: { ...state.carousel, cards: cards.filter((_, i) => i !== action.index) } };
    }

    case 'carousel_update_card': {
      if (!state.carousel) return state;
      const cards = state.carousel.cards || [];
      const { index, patch } = action;
      if (index < 0 || index >= cards.length) return state;
      const card = cards[index];
      const next = { ...card, ...patch };
      // Card bodies are always POSITIONAL regardless of the template's own parameterFormat
      // (see templateRules.serializeCard) — same recompute as the top-level body.
      if ('body' in patch && !('examples' in patch)) {
        next.examples = recomputeBodyExamples(patch.body, 'POSITIONAL', card.examples);
      }
      const nextCards = [...cards];
      nextCards[index] = next;
      return { ...state, carousel: { ...state.carousel, cards: nextCards } };
    }

    case 'card_add_button': {
      if (!state.carousel) return state;
      const cards = state.carousel.cards || [];
      const { index, btnType } = action;
      if (index < 0 || index >= cards.length) return state;
      if (!CAROUSEL_CARD_BUTTON_TYPES.includes(btnType)) return state;
      const card = cards[index];
      const buttons = card.buttons || [];
      if (buttons.length >= CAROUSEL_CARD_BUTTONS_MAX) return state;
      const nextCards = [...cards];
      nextCards[index] = { ...card, buttons: [...buttons, makeButton(btnType)] };
      return { ...state, carousel: { ...state.carousel, cards: nextCards } };
    }

    case 'card_update_button': {
      if (!state.carousel) return state;
      const cards = state.carousel.cards || [];
      const { index, buttonIndex, patch } = action;
      if (index < 0 || index >= cards.length) return state;
      const card = cards[index];
      const buttons = card.buttons || [];
      if (buttonIndex < 0 || buttonIndex >= buttons.length) return state;
      const nextButtons = [...buttons];
      nextButtons[buttonIndex] = { ...nextButtons[buttonIndex], ...patch };
      const nextCards = [...cards];
      nextCards[index] = { ...card, buttons: nextButtons };
      return { ...state, carousel: { ...state.carousel, cards: nextCards } };
    }

    case 'card_remove_button': {
      if (!state.carousel) return state;
      const cards = state.carousel.cards || [];
      const { index, buttonIndex } = action;
      if (index < 0 || index >= cards.length) return state;
      const card = cards[index];
      const nextCards = [...cards];
      nextCards[index] = { ...card, buttons: (card.buttons || []).filter((_, i) => i !== buttonIndex) };
      return { ...state, carousel: { ...state.carousel, cards: nextCards } };
    }

    case 'toggle_lto': {
      return { ...state, lto: state.lto ? null : { text: '', hasExpiration: true } };
    }

    case 'set_auth': {
      return { ...state, auth: { ...state.auth, ...action.patch } };
    }

    default:
      return state;
  }
}
