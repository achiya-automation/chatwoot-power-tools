/**
 * templateRules.js — capability map, validation, and serialization for WhatsApp
 * message templates (Meta Cloud API `POST /{waba}/message_templates`).
 * Pure JS: no React, no DOM. Shared by the Template Studio Builder and by tests.
 *
 * The component matrix below was corrected against a live spike run against
 * Meta's current docs on 2026-07-20 (see
 * docs/superpowers/plans/2026-07-20-template-studio-verification.md). Where
 * that file disagrees with the original task brief, this module follows the
 * verification file. Section comments below cite the finding numbers (6a-6j)
 * from that file so the reasoning stays traceable.
 */

export const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];

export const HEADER_FORMATS = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION'];

// Button type capability map.
export const BUTTON_TYPES = {
  QUICK_REPLY: { max: 10, textMax: 25 },
  URL: { max: 2, textMax: 25, urlMax: 2000, dynamicSuffix: true },
  PHONE_NUMBER: { max: 1, textMax: 25 },
  // verification 6a: button type missing from the original spec entirely. Places a
  // WhatsApp call (not PSTN) on tap; not configurable at send time (no per-message
  // parameter, unlike a dynamic URL suffix). No phone field — it rings the WABA's
  // own registered calling number. Per Meta calling docs: text max 20 chars, optional
  // ttl_minutes integer (1440–43200 range, per Meta calling docs).
  VOICE_CALL: { max: 1, textMax: 20 },
  // verification 6b: marketing coupon code cap raised from 15 to 20 chars by Meta in
  // 2026. This is a DIFFERENT limit from the AUTHENTICATION OTP code (verification 6g,
  // stays 15) — that value is supplied at message-send time, not template-definition
  // time, so it has no field on the template and is not modeled in this map.
  COPY_CODE: { max: 1, codeMax: 20 },
  // verification 6c: the brief already capped this at 1; live spike confirmed it.
  FLOW: { max: 1, textMax: 25 },
  // verification 6d: CATALOG (single product) and MPM (multi-product) are two
  // distinct Meta components, not one — kept as separate map entries.
  CATALOG: { max: 1 },
  MPM: { max: 1 },
};

// verification 6e: carousel card buttons are restricted to this subset — no
// FLOW/COPY_CODE/CATALOG/MPM/VOICE_CALL/OTP inside a card.
export const CAROUSEL_CARD_BUTTON_TYPES = ['QUICK_REPLY', 'PHONE_NUMBER', 'URL'];

export const LIMITS = {
  name: 512,
  headerText: 60,
  body: 1024,
  footer: 60,
  buttonsTotal: 10,
  carouselCardsMin: 2, // verification 6e: floor the brief didn't have (only a ceiling)
  carouselCards: 10,
  carouselBody: 160,
  ltoTitle: 16,
  ltoBody: 600, // verification 6f: LTO body cap is lower than the standard 1024
  // verification 6f: two official Meta docs disagree on the LTO offer-code length —
  // the LTO-specific page says 15, the general COPY_CODE changelog (6b) says 20.
  // Resolved conservatively: 15 here, so a template that validates client-side never
  // gets rejected server-side. Only applies to a COPY_CODE button on a template that
  // also carries an LTO; a standalone marketing COPY_CODE button uses codeMax (20).
  ltoCode: 15,
};

// Meta's documented WhatsApp template language codes — developers.facebook.com,
// message-templates/supported-languages, fetched live 2026-07-20.
export const LANGS = [
  'af', 'sq', 'ar', 'ar_EG', 'ar_AE', 'ar_LB', 'ar_MA', 'ar_QA', 'az', 'be_BY',
  'bn', 'bn_IN', 'bg', 'ca', 'zh_CN', 'zh_HK', 'zh_TW', 'hr', 'cs', 'da', 'prs_AF',
  'nl', 'nl_BE', 'en', 'en_GB', 'en_US', 'en_AE', 'en_AU', 'en_CA', 'en_GH', 'en_IE',
  'en_IN', 'en_JM', 'en_MY', 'en_NZ', 'en_QA', 'en_SG', 'en_UG', 'en_ZA', 'et', 'fil',
  'fi', 'fr', 'fr_BE', 'fr_CA', 'fr_CH', 'fr_CI', 'fr_MA', 'ka', 'de', 'de_AT', 'de_CH',
  'el', 'gu', 'ha', 'he', 'hi', 'hu', 'id', 'ga', 'it', 'ja', 'kn', 'kk', 'rw_RW', 'ko',
  'ky_KG', 'lo', 'lv', 'lt', 'mk', 'ms', 'ml', 'mr', 'nb', 'ps_AF', 'fa', 'pl', 'pt_BR',
  'pt_PT', 'pa', 'ro', 'ru', 'sr', 'si_LK', 'sk', 'sl', 'es', 'es_AR', 'es_CL', 'es_CO',
  'es_CR', 'es_DO', 'es_EC', 'es_HN', 'es_MX', 'es_PA', 'es_PE', 'es_ES', 'es_UY', 'sw',
  'sv', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'zu',
];

export function emptyTemplate() {
  return {
    name: '',
    language: 'he',
    category: 'MARKETING',
    parameterFormat: 'POSITIONAL',
    header: { format: 'NONE', text: '', example: '', mediaHandle: '' },
    body: { text: '', examples: [] },
    footer: '',
    buttons: [],
    carousel: null,
    lto: null,
    auth: { otpType: 'copy_code', securityRecommendation: true, expirationMinutes: 10 },
    ttlSeconds: null,
  };
}

// Extracts {{1}}, {{2}}, {{first_name}}, ... in order of first appearance, deduped.
export function bodyVars(text) {
  const seen = new Set();
  const out = [];
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

function err(field, msg_he, msg_en) {
  return { field, msg_he, msg_en };
}

// True when at least one variable in `text` has no matching example.
function hasMissingExample(text, parameterFormat, examples) {
  const vars = bodyVars(text);
  if (vars.length === 0) return false;
  const ex = Array.isArray(examples) ? examples : [];
  if (parameterFormat === 'NAMED') {
    return vars.some((name) => {
      const found = ex.find((e) => e && e.param_name === name);
      return !found || !found.example;
    });
  }
  return vars.some((v) => !ex[Number(v) - 1]);
}

function validateButtons(buttons, isLto) {
  const errors = [];
  const list = Array.isArray(buttons) ? buttons : [];

  if (list.length > LIMITS.buttonsTotal) {
    errors.push(err('buttons',
      `לא ניתן להגדיר יותר מ-${LIMITS.buttonsTotal} כפתורים`,
      `Cannot have more than ${LIMITS.buttonsTotal} buttons`));
  }

  const counts = {};
  for (const b of list) counts[b.type] = (counts[b.type] || 0) + 1;
  for (const [type, count] of Object.entries(counts)) {
    const spec = BUTTON_TYPES[type];
    if (!spec) {
      errors.push(err('buttons', `סוג כפתור לא מוכר: ${type}`, `Unknown button type: ${type}`));
      continue;
    }
    if (count > spec.max) {
      errors.push(err('buttons',
        `לכל היותר ${spec.max} כפתור/י ${type}`,
        `At most ${spec.max} ${type} button(s) allowed`));
    }
  }

  // verification 6i: QUICK_REPLY buttons must form one contiguous run, not
  // interleaved with other types — templates that violate this don't render on
  // WhatsApp Desktop.
  const qrIndexes = list.map((b, i) => (b.type === 'QUICK_REPLY' ? i : -1)).filter((i) => i >= 0);
  if (qrIndexes.length > 1) {
    const span = qrIndexes[qrIndexes.length - 1] - qrIndexes[0] + 1;
    if (span !== qrIndexes.length) {
      errors.push(err('buttons',
        'כפתורי מענה מהיר (QUICK_REPLY) חייבים להיות רצופים, ולא מעורבבים עם סוגי כפתור אחרים',
        'QUICK_REPLY buttons must be grouped together, not interleaved with other button types'));
    }
  }

  for (const b of list) {
    const spec = BUTTON_TYPES[b.type];
    if (!spec) continue;
    if (spec.textMax && b.text && b.text.length > spec.textMax) {
      errors.push(err('buttons',
        `טקסט הכפתור ארוך מ-${spec.textMax} תווים`,
        `Button text exceeds ${spec.textMax} characters`));
    }
    if (b.type === 'URL') {
      if (b.url && b.url.length > spec.urlMax) {
        errors.push(err('buttons',
          `כתובת ה-URL ארוכה מ-${spec.urlMax} תווים`,
          `URL exceeds ${spec.urlMax} characters`));
      }
      const urlVars = bodyVars(b.url);
      if (urlVars.length > 1) {
        errors.push(err('buttons',
          'כתובת URL יכולה להכיל משתנה דינמי יחיד בלבד',
          'A URL can contain at most one dynamic variable'));
      } else if (urlVars.length === 1 && !b.urlExample) {
        errors.push(err('buttons', 'כתובת URL דינמית חייבת דוגמה', 'A dynamic URL needs an example'));
      }
    }
    if (b.type === 'COPY_CODE') {
      // verification 6f: inside an LTO template the conservative 15-char bound
      // applies (see LIMITS.ltoCode comment); otherwise the general 20-char cap.
      const cap = isLto ? LIMITS.ltoCode : spec.codeMax;
      if (b.code && b.code.length > cap) {
        errors.push(err('buttons',
          `קוד הקופון ארוך מ-${cap} תווים${isLto ? ' (מוגבל יותר בתוך מבצע מוגבל-בזמן)' : ''}`,
          `Coupon code exceeds ${cap} characters${isLto ? ' (capped lower inside a Limited-Time-Offer)' : ''}`));
      }
      if (b.code && !/^[a-zA-Z0-9]+$/.test(b.code)) {
        errors.push(err('buttons',
          'קוד הקופון יכול להכיל אותיות וספרות באנגלית בלבד, ללא סימנים או רווחים',
          'Coupon code can only contain letters and digits, no symbols or spaces'));
      }
    }
    if (b.type === 'VOICE_CALL') {
      // per Meta calling docs: optional ttl_minutes integer, valid range 1440–43200 (1–30 days)
      if (typeof b.ttlMinutes === 'number' && (b.ttlMinutes < 1440 || b.ttlMinutes > 43200)) {
        errors.push(err('buttons',
          'זמן תוקף הקריאה חייב להיות בין 1440 ל-43200 דקות (1–30 ימים)',
          'Call TTL must be between 1440 and 43200 minutes (1–30 days)'));
      }
    }
  }

  return errors;
}

function validateCarousel(carousel) {
  const errors = [];
  const cards = Array.isArray(carousel.cards) ? carousel.cards : [];

  // verification 6e: floor of 2, ceiling of 10 (brief only had the ceiling).
  if (cards.length < LIMITS.carouselCardsMin || cards.length > LIMITS.carouselCards) {
    errors.push(err('carousel',
      `קרוסלה חייבת להכיל בין ${LIMITS.carouselCardsMin} ל-${LIMITS.carouselCards} כרטיסים`,
      `Carousel must have between ${LIMITS.carouselCardsMin} and ${LIMITS.carouselCards} cards`));
  }

  const firstFormat = cards[0]?.headerFormat;
  cards.forEach((card, i) => {
    if (!card.body || !card.body.trim()) {
      errors.push(err('carousel', 'לכל כרטיס בקרוסלה חייב להיות טקסט גוף', 'Every carousel card needs body text'));
    } else if (card.body.length > LIMITS.carouselBody) {
      errors.push(err('carousel',
        `גוף כרטיס ארוך מ-${LIMITS.carouselBody} תווים`,
        `Carousel card body exceeds ${LIMITS.carouselBody} characters`));
    }
    // Card bodies are always POSITIONAL (see serializeCard) regardless of the
    // template's own parameterFormat — same missing-example rule as the main body.
    if (hasMissingExample(card.body, 'POSITIONAL', card.examples)) {
      errors.push(err('carousel',
        `כרטיס ${i + 1} בקרוסלה: כל משתנה בגוף הכרטיס חייב דוגמה תואמת`,
        `Carousel card ${i + 1}: every variable in the card body needs a matching example`));
    }
    if (card.headerFormat !== firstFormat) {
      errors.push(err('carousel',
        'כל כרטיסי הקרוסלה חייבים להיות מאותו סוג כותרת',
        'All carousel cards must share the same header format'));
    }
    for (const b of card.buttons || []) {
      if (!CAROUSEL_CARD_BUTTON_TYPES.includes(b.type)) {
        errors.push(err('carousel',
          `סוג כפתור ${b.type} אינו נתמך בכרטיס קרוסלה`,
          `Button type ${b.type} is not allowed on a carousel card`));
      }
    }
  });

  return errors;
}

export function validateTemplate(tpl) {
  const t = tpl || {};
  const errors = [];
  const category = t.category || 'MARKETING';
  const isAuth = category === 'AUTHENTICATION';
  const isLto = !!t.lto;

  if (!/^[a-z0-9_]{1,512}$/.test(String(t.name || ''))) {
    errors.push(err('name',
      'שם התבנית חייב להכיל אותיות לועזיות קטנות, ספרות וקו תחתון בלבד (עד 512 תווים)',
      'Template name must contain only lowercase letters, digits and underscore (up to 512 chars)'));
  }

  // AUTHENTICATION templates ignore the free-form header/footer/buttons entirely —
  // serializeTemplate builds a fixed structure for them instead (see below) — so none
  // of those checks apply.
  if (!isAuth) {
    const body = t.body || { text: '', examples: [] };
    const bodyCap = isLto ? LIMITS.ltoBody : LIMITS.body; // verification 6f
    if (!body.text || !body.text.trim()) {
      errors.push(err('body', 'טקסט גוף ההודעה חובה', 'Body text is required'));
    } else if (body.text.length > bodyCap) {
      errors.push(err('body',
        `גוף ההודעה ארוך מ-${bodyCap} תווים${isLto ? ' (מוגבל יותר במבצע מוגבל-בזמן)' : ''}`,
        `Body text exceeds ${bodyCap} characters${isLto ? ' (a Limited-Time-Offer caps the body lower)' : ''}`));
    }
    if (hasMissingExample(body.text, t.parameterFormat, body.examples)) {
      errors.push(err('body.examples',
        'כל משתנה בגוף ההודעה חייב דוגמה תואמת',
        'Every variable in the body needs a matching example'));
    }

    const header = t.header || { format: 'NONE' };
    if (header.format === 'TEXT') {
      if (header.text && header.text.length > LIMITS.headerText) {
        errors.push(err('header.text',
          `כותרת ארוכה מ-${LIMITS.headerText} תווים`,
          `Header text exceeds ${LIMITS.headerText} characters`));
      }
      const hVars = bodyVars(header.text);
      if (hVars.length > 1) {
        errors.push(err('header.text',
          'כותרת יכולה להכיל משתנה יחיד בלבד',
          'Header can contain at most one variable'));
      } else if (hVars.length === 1 && !header.example) {
        errors.push(err('header.example',
          'כותרת עם משתנה חייבת דוגמה',
          'A header with a variable needs an example'));
      }
    }

    if (t.footer) {
      if (isLto) {
        // verification 6f: footer isn't supported at all on an LTO template.
        errors.push(err('footer',
          'תבנית עם מבצע מוגבל-בזמן (LTO) לא תומכת בהערת שוליים',
          'A Limited-Time-Offer template does not support a footer'));
      } else if (t.footer.length > LIMITS.footer) {
        errors.push(err('footer',
          `הערת שוליים ארוכה מ-${LIMITS.footer} תווים`,
          `Footer exceeds ${LIMITS.footer} characters`));
      }
    }

    errors.push(...validateButtons(t.buttons, isLto));
  }

  if (t.carousel) {
    errors.push(...validateCarousel(t.carousel));

    // Grounded 2026-07-20 against Meta's live carousel-template docs
    // (developers.facebook.com/documentation/business-messaging/whatsapp/templates/
    // marketing-templates/media-card-carousel-templates): every template-creation
    // example shows top-level `components` as [BODY, CAROUSEL] only — never a
    // top-level HEADER/FOOTER/BUTTONS alongside CAROUSEL. Card-level header/buttons
    // live on each card instead (see CAROUSEL_CARD_BUTTON_TYPES).
    const header = t.header || { format: 'NONE' };
    if (header.format && header.format !== 'NONE') {
      errors.push(err('carousel',
        'תבנית עם קרוסלה לא יכולה לכלול כותרת עליונה — כל כרטיס נושא כותרת משלו',
        'A carousel template cannot have a top-level header — each card carries its own header'));
    }
    if (t.footer) {
      errors.push(err('carousel',
        'תבנית עם קרוסלה לא יכולה לכלול הערת שוליים',
        'A carousel template cannot have a footer'));
    }
    if (Array.isArray(t.buttons) && t.buttons.length > 0) {
      errors.push(err('carousel',
        'תבנית עם קרוסלה לא יכולה לכלול כפתורים עליונים — הכפתורים נמצאים בתוך כל כרטיס',
        'A carousel template cannot have top-level buttons — buttons live on each card'));
    }
  }

  if (t.lto) {
    if (category !== 'MARKETING') {
      // verification 6f: Limited-Time-Offer is MARKETING-only.
      errors.push(err('lto',
        'מבצע מוגבל-בזמן זמין רק בקטגוריית MARKETING',
        'Limited-Time-Offer is only available for the MARKETING category'));
    }
    if (t.lto.text && t.lto.text.length > LIMITS.ltoTitle) {
      errors.push(err('lto',
        `טקסט ההצעה ארוך מ-${LIMITS.ltoTitle} תווים`,
        `Offer text exceeds ${LIMITS.ltoTitle} characters`));
    }
  }

  if (isAuth) {
    const min = t.auth?.expirationMinutes;
    if (typeof min !== 'number' || min < 1 || min > 90) {
      errors.push(err('auth.expirationMinutes',
        'זמן תפוגת הקוד חייב להיות בין 1 ל-90 דקות',
        'Code expiration must be between 1 and 90 minutes'));
    }
  }

  // Resolved open question: MARKETING TTL applicability is unclear per Meta's docs
  // (custom TTL for MARKETING needs the separate Marketing Messages Lite API, which
  // may not apply through the standard message_templates endpoint this module
  // targets) — so it's rejected outright here rather than silently accepted and
  // possibly no-op'd server-side. UTILITY/AUTHENTICATION have no such ambiguity.
  if (t.ttlSeconds != null && category === 'MARKETING') {
    errors.push(err('ttlSeconds',
      'לא ניתן להגדיר תוקף שליחה (TTL) לתבנית מסוג MARKETING',
      'message_send_ttl_seconds cannot be set for MARKETING templates'));
  }

  return errors;
}

// ---------------------------------------------------------------------------
// warnings
// ---------------------------------------------------------------------------

function stripVersionSuffix(name) {
  return String(name || '').replace(/(_v\d+|_?\d+)$/, '');
}

function normalizeForCompare(text) {
  return String(text || '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function bodyTextOf(graphTpl) {
  const c = (graphTpl.components || []).find((x) => x.type === 'BODY');
  return c ? c.text || '' : '';
}

export function warningsFor(tpl, existingTemplates) {
  const t = tpl || {};
  const existing = Array.isArray(existingTemplates) ? existingTemplates : [];
  const warnings = [];

  const base = stripVersionSuffix(t.name);
  const nameDup = !!t.name && existing.some((e) => e.name !== t.name && stripVersionSuffix(e.name) === base);
  const bodyText = (t.body && t.body.text) || '';
  const normBody = normalizeForCompare(bodyText);
  const bodyDup = !!normBody && existing.some((e) => normalizeForCompare(bodyTextOf(e)) === normBody);
  if (t.name && (nameDup || bodyDup)) {
    warnings.push({
      kind: 'near_duplicate',
      msg_he: 'קיימת כבר תבנית עם שם או תוכן דומה מאוד — ודאו שזו לא כפילות',
      msg_en: 'A template with a very similar name or content already exists — make sure this is not a duplicate',
    });
  }

  if (/^\{\{\s*[a-zA-Z0-9_]+\s*\}\}$/.test(bodyText.trim())) {
    warnings.push({
      kind: 'single_var_body',
      msg_he: 'גוף ההודעה מכיל רק משתנה בודד ללא טקסט נלווה — ודאו שזה מכוון',
      msg_en: 'The body is a single variable with no surrounding text — make sure this is intentional',
    });
  }

  if ((t.category || 'MARKETING') === 'MARKETING') {
    warnings.push({
      kind: 'category_price',
      msg_he: 'תבניות MARKETING מחויבות בתעריף גבוה יותר מ-UTILITY/AUTHENTICATION',
      msg_en: 'MARKETING templates are billed at a higher rate than UTILITY/AUTHENTICATION',
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// serialization
// ---------------------------------------------------------------------------

function serializeHeader(header) {
  const h = header || { format: 'NONE' };
  if (!h.format || h.format === 'NONE') return null;
  if (h.format === 'TEXT') {
    const out = { type: 'HEADER', format: 'TEXT', text: h.text };
    if (bodyVars(h.text).length > 0 && h.example) out.example = { header_text: [h.example] };
    return out;
  }
  if (h.format === 'IMAGE' || h.format === 'VIDEO' || h.format === 'DOCUMENT') {
    const out = { type: 'HEADER', format: h.format };
    if (h.mediaHandle) out.example = { header_handle: [h.mediaHandle] };
    return out;
  }
  return { type: 'HEADER', format: h.format }; // LOCATION (and any other flat format)
}

function serializeBody(body, parameterFormat) {
  const b = body || { text: '', examples: [] };
  const out = { type: 'BODY', text: b.text };
  if (bodyVars(b.text).length > 0) {
    out.example = parameterFormat === 'NAMED'
      ? { body_text_named_params: b.examples || [] }
      : { body_text: [b.examples || []] };
  }
  return out;
}

function serializeButton(b) {
  switch (b.type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: b.text };
    case 'URL': {
      const out = { type: 'URL', text: b.text, url: b.url };
      if (bodyVars(b.url).length > 0 && b.urlExample) out.example = [b.urlExample];
      return out;
    }
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone };
    case 'VOICE_CALL': {
      const out = { type: 'VOICE_CALL', text: b.text };
      if (typeof b.ttlMinutes === 'number' && isFinite(b.ttlMinutes)) {
        out.ttl_minutes = b.ttlMinutes;
      }
      return out;
    }
    case 'COPY_CODE':
      return { type: 'COPY_CODE', example: b.code };
    case 'FLOW':
      return { type: 'FLOW', text: b.text };
    case 'CATALOG':
      return b.text ? { type: 'CATALOG', text: b.text } : { type: 'CATALOG' };
    case 'MPM':
      return b.text ? { type: 'MPM', text: b.text } : { type: 'MPM' };
    default:
      return { ...b };
  }
}

// Grounded 2026-07-20 against Meta's live carousel-template creation docs: card
// objects in the creation payload are `{components: [...]}` only — no `card_index`
// field. (card_index is real, but only appears in the send-message payload, a
// different endpoint this module does not serialize for.)
function serializeCard(card) {
  const components = [];
  const header = serializeHeader({ format: card.headerFormat, mediaHandle: card.mediaHandle });
  if (header) components.push(header);
  components.push(serializeBody({ text: card.body, examples: card.examples || [] }, 'POSITIONAL'));
  if (card.buttons && card.buttons.length > 0) {
    components.push({ type: 'BUTTONS', buttons: card.buttons.map(serializeButton) });
  }
  return { components };
}

function serializeAuthComponents(t) {
  const auth = t.auth || {};
  return [
    { type: 'BODY', add_security_recommendation: !!auth.securityRecommendation },
    { type: 'FOOTER', code_expiration_minutes: auth.expirationMinutes },
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: auth.otpType }] },
  ];
}

function serializeStandardComponents(t) {
  const components = [];

  const header = serializeHeader(t.header);
  if (header) components.push(header);

  components.push(serializeBody(t.body, t.parameterFormat));

  if (t.footer) components.push({ type: 'FOOTER', text: t.footer });

  if (t.lto) {
    components.push({
      type: 'LIMITED_TIME_OFFER',
      limited_time_offer: { text: t.lto.text, has_expiration: !!t.lto.hasExpiration },
    });
  }

  if (t.carousel) {
    components.push({ type: 'CAROUSEL', cards: (t.carousel.cards || []).map(serializeCard) });
  }

  if (t.buttons && t.buttons.length > 0) {
    components.push({ type: 'BUTTONS', buttons: t.buttons.map(serializeButton) });
  }

  return components;
}

export function serializeTemplate(tpl) {
  const t = tpl || {};
  const category = t.category || 'MARKETING';
  const out = {
    name: t.name,
    language: t.language,
    category,
    allow_category_change: true,
  };

  if (t.parameterFormat === 'NAMED') out.parameter_format = 'NAMED';

  // Resolved open question: message_send_ttl_seconds is only meaningful for
  // UTILITY/AUTHENTICATION here. Custom TTL for MARKETING needs the separate
  // Marketing Messages Lite API per Meta's docs, not the standard
  // message_templates endpoint this function serializes for — so it is never
  // emitted for MARKETING, even if the caller skipped validateTemplate (which
  // already rejects it outright).
  if (t.ttlSeconds != null && (category === 'UTILITY' || category === 'AUTHENTICATION')) {
    out.message_send_ttl_seconds = t.ttlSeconds;
  }

  out.components = category === 'AUTHENTICATION' ? serializeAuthComponents(t) : serializeStandardComponents(t);

  return out;
}

// ---------------------------------------------------------------------------
// deserialization
// ---------------------------------------------------------------------------

function deserializeHeader(c) {
  if (c.format === 'TEXT') {
    return { format: 'TEXT', text: c.text || '', example: c.example?.header_text?.[0] || '', mediaHandle: '' };
  }
  if (c.format === 'IMAGE' || c.format === 'VIDEO' || c.format === 'DOCUMENT') {
    return { format: c.format, text: '', example: '', mediaHandle: c.example?.header_handle?.[0] || '' };
  }
  return { format: c.format || 'NONE', text: '', example: '', mediaHandle: '' };
}

function deserializeBody(c) {
  const text = c.text || '';
  if (c.example?.body_text_named_params) {
    return { body: { text, examples: c.example.body_text_named_params }, named: true };
  }
  if (c.example?.body_text) {
    return { body: { text, examples: c.example.body_text[0] || [] }, named: false };
  }
  return { body: { text, examples: [] }, named: false };
}

function deserializeButton(b) {
  switch (b.type) {
    case 'URL':
      return { type: 'URL', text: b.text, url: b.url, urlExample: b.example?.[0] || '' };
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: b.text, phone: b.phone_number };
    case 'COPY_CODE':
      return { type: 'COPY_CODE', code: b.example || '' };
    default:
      return { ...b }; // QUICK_REPLY, VOICE_CALL, FLOW, CATALOG, MPM already round-trip as-is
  }
}

function deserializeCard(card) {
  const components = Array.isArray(card.components) ? card.components : [];
  const headerC = components.find((c) => c.type === 'HEADER');
  const bodyC = components.find((c) => c.type === 'BODY');
  const buttonsC = components.find((c) => c.type === 'BUTTONS');
  return {
    headerFormat: headerC?.format || 'NONE',
    mediaHandle: headerC?.example?.header_handle?.[0] || '',
    body: bodyC?.text || '',
    // Card bodies are always POSITIONAL (see serializeCard) — mirrors deserializeBody's
    // body_text branch. Previously dropped entirely, so editing a graph carousel template
    // round-tripped every card's examples away (Task 3 review gap, fixed here).
    examples: bodyC?.example?.body_text?.[0] || [],
    buttons: (buttonsC?.buttons || []).map(deserializeButton),
  };
}

export function deserializeTemplate(graphTpl) {
  const g = graphTpl || {};
  const ui = emptyTemplate();
  ui.name = g.name || '';
  ui.language = g.language || 'he';
  ui.category = g.category || 'MARKETING';
  ui.parameterFormat = g.parameter_format === 'NAMED' ? 'NAMED' : 'POSITIONAL';
  ui.ttlSeconds = g.message_send_ttl_seconds ?? null;

  const components = Array.isArray(g.components) ? g.components : [];

  if (ui.category === 'AUTHENTICATION') {
    const bodyC = components.find((c) => c.type === 'BODY');
    const footerC = components.find((c) => c.type === 'FOOTER');
    const buttonsC = components.find((c) => c.type === 'BUTTONS');
    const otp = buttonsC?.buttons?.find((b) => b.type === 'OTP');
    ui.auth = {
      otpType: otp?.otp_type || 'copy_code',
      securityRecommendation: bodyC ? !!bodyC.add_security_recommendation : true,
      expirationMinutes: footerC?.code_expiration_minutes ?? 10,
    };
    return ui;
  }

  for (const c of components) {
    if (c.type === 'HEADER') {
      ui.header = deserializeHeader(c);
    } else if (c.type === 'BODY') {
      const parsed = deserializeBody(c);
      ui.body = parsed.body;
      if (parsed.named) ui.parameterFormat = 'NAMED';
    } else if (c.type === 'FOOTER') {
      ui.footer = c.text || '';
    } else if (c.type === 'BUTTONS') {
      ui.buttons = (c.buttons || []).map(deserializeButton);
    } else if (c.type === 'LIMITED_TIME_OFFER') {
      const lto = c.limited_time_offer || {};
      ui.lto = { text: lto.text || '', hasExpiration: !!lto.has_expiration };
    } else if (c.type === 'CAROUSEL') {
      ui.carousel = { cards: (c.cards || []).map(deserializeCard) };
    }
  }

  return ui;
}
