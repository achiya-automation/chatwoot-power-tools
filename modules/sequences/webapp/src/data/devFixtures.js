/*
 * devFixtures — נתוני דמה + interceptor ל-fetch, *רק לפיתוח ויזואלי* (DEV).
 * מופעל מ-main.jsx כש-?mock=1 וב-import.meta.env.DEV בלבד, כך שכל הקובץ
 * נגזם (tree-shaken) מה-build של production. לא מגיע ללקוח אף פעם.
 */

const TEMPLATES = [
  {
    name: 'welcome_intro',
    language: 'he',
    category: 'MARKETING',
    params_count: 1,
    body: 'היי {{1}}! תודה שפנית לאחיה אוטומציה 🤖 נשמח לעזור לעסק שלך לעבוד חכם יותר.',
    header_text: 'ברוכים הבאים',
    header_format: 'TEXT',
    footer_text: 'אחיה אוטומציה',
    buttons: [{ type: 'QUICK_REPLY', text: 'ספרו לי עוד' }],
    examples: ['דנה'],
  },
  {
    name: 'followup_value',
    language: 'he',
    category: 'MARKETING',
    params_count: 2,
    body: 'שלום {{1}}, רצינו לוודא שקיבלת את המידע. אפשר לקבוע שיחה קצרה ל{{2}}?',
    header_text: '',
    footer_text: 'אפשר להשיב STOP להסרה',
    buttons: [],
    examples: ['דנה', 'יום ראשון'],
  },
  {
    name: 'offer_discount',
    language: 'he',
    category: 'MARKETING',
    params_count: 1,
    body: 'מתנה בשבילך {{1}} 🎁 — 15% הנחה על הקמת אוטומציה ראשונה. הקוד בתוקף השבוע.',
    header_text: '',
    footer_text: '',
    buttons: [{ type: 'URL', text: 'לקביעת פגישה' }],
    examples: ['דנה'],
  },
  {
    name: 'reengage_quiet',
    language: 'he',
    category: 'UTILITY',
    params_count: 0,
    body: 'עדיין כאן אם תרצו להתקדם — פשוט השיבו להודעה הזו ונחזור אליכם.',
    header_text: '',
    footer_text: '',
    buttons: [],
    examples: [],
  },
  {
    name: 'promo_video_ad',
    language: 'he',
    category: 'MARKETING',
    params_count: 1,
    body: 'מבצע מיוחד {{1}}! צפו בסרטון הקצר 🎬',
    header_text: '',
    header_format: 'VIDEO', // header מדיה — דורש media_url
    footer_text: '',
    buttons: [{ type: 'URL', text: 'לפרטים' }],
    examples: ['דנה'],
  },
];

const SEQUENCES = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    key: 'seq_welcome',
    display_name: 'רצף קבלת פנים',
    enabled: true,
    stop_on_reply: true,
    skip_shabbat: true,
    quiet_start: '21:00',
    quiet_end: '08:00',
    steps: [
      { id: 's1', template_name: 'welcome_intro', language: 'he', category: 'MARKETING', delay_days: 0, delay_hours: 0, params: ['@name'] },
      { id: 's2', template_name: 'followup_value', language: 'he', category: 'MARKETING', delay_days: 1, delay_hours: 0, params: ['@name', 'יום ראשון'] },
      { id: 's3', template_name: 'offer_discount', language: 'he', category: 'MARKETING', delay_days: 3, delay_hours: 2, params: ['@name'] },
      { id: 's4', template_name: 'promo_video_ad', language: 'he', category: 'MARKETING', delay_days: 5, delay_hours: 0, params: ['@name'], media_url: 'https://example.com/assets/promo.mp4' },
    ],
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    key: 'seq_winback',
    display_name: 'רצף החזרת לקוחות',
    enabled: false,
    stop_on_reply: false,
    skip_shabbat: true,
    quiet_start: '20:00',
    quiet_end: '09:00',
    steps: [
      { id: 's4', template_name: 'reengage_quiet', language: 'he', category: 'UTILITY', delay_days: 2, delay_hours: 0, params: [] },
      { id: 's5', template_name: 'offer_discount', language: 'he', category: 'MARKETING', delay_days: 5, delay_hours: 0, params: ['@name'] },
    ],
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    key: 'seq_onboarding',
    display_name: 'רצף הצטרפות',
    enabled: true,
    stop_on_reply: true,
    skip_shabbat: true,
    quiet_start: '22:00',
    quiet_end: '08:00',
    steps: [
      { id: 's6', template_name: 'welcome_intro', language: 'he', category: 'MARKETING', delay_days: 0, delay_hours: 1, params: ['@name'] },
    ],
  },
];

const ENROLLMENTS = [
  { conversation_id: 101, phone: '+972541234567', sequence_name: 'רצף קבלת פנים', sequence_key: 'seq_welcome', current_step: 2, total_steps: 3, status: 'active', next_send_at: '2026-06-22 10:00', last_sent_at: '2026-06-21 10:00', enrolled_at: '2026-06-20 09:00' },
  { conversation_id: 102, phone: '+972529876543', sequence_name: 'רצף קבלת פנים', sequence_key: 'seq_welcome', current_step: 3, total_steps: 3, status: 'completed', next_send_at: null, last_sent_at: '2026-06-21 12:00', enrolled_at: '2026-06-18 09:00' },
  { conversation_id: 103, phone: '+972501112233', sequence_name: 'רצף החזרת לקוחות', sequence_key: 'seq_winback', current_step: 1, total_steps: 2, status: 'stopped', next_send_at: null, last_sent_at: '2026-06-19 15:00', enrolled_at: '2026-06-19 09:00' },
  { conversation_id: 104, phone: '+972536667788', sequence_name: 'רצף הצטרפות', sequence_key: 'seq_onboarding', current_step: 1, total_steps: 1, status: 'active', next_send_at: '2026-06-21 18:00', last_sent_at: null, enrolled_at: '2026-06-21 17:00' },
];

const SENT_HISTORY = [
  { step_order: 1, template_name: 'welcome_intro', content: 'היי דנה! תודה שפנית לאחיה אוטומציה 🤖 נשמח לעזור לעסק שלך לעבוד חכם יותר.', delivery_status: 'delivered', sent_at: '2026-06-20 10:00', enrollment_id: 'cur-run' },
  { step_order: 2, template_name: 'followup_value', content: 'שלום דנה, רצינו לוודא שקיבלת את המידע. אפשר לקבוע שיחה קצרה ליום ראשון?', delivery_status: 'delivered', sent_at: '2026-06-21 10:00', enrollment_id: 'cur-run' },
  // רשומה מריצה קודמת (רצף אחר) על אותה שיחה, אותו step_order=3 — חייבת להיסנן ע"י
  // enrollment_id, אחרת שלב 3 ייצבע בטעות כ"נשלח" (הבאג של "הודעה 2 לפני 1").
  { step_order: 3, template_name: 'offer_discount', content: 'מתנה מריצה ישנה', delivery_status: 'delivered', sent_at: '2026-06-12 09:00', enrollment_id: 'old-run' },
];

const STATUS = {
  enrollment_id: 'cur-run', // הריצה הנוכחית — מסנן את ההיסטוריה לשלבים שלה בלבד
  sequence_name: 'רצף קבלת פנים',
  sequence_key: 'seq_welcome',
  contact_name: 'דנה כהן',
  current_step: 3,
  total_steps: 4,
  status: 'active',
  next_send_at: '2026-06-24 10:00',
  last_sent_at: '2026-06-21 10:00',
  phone: '+972541234567',
};

// מועדי השליחה הצפויים (שעון ישראל) לשלב הנוכחי (3) ולעתידי (4) — מה ש-fmtWhen יציג
// כ"מתי בדיוק יישלח" במקום "כעבור X ימים".
const PROJECTED = [
  { step_order: 3, send_at: '2026-06-24 10:00' },
  { step_order: 4, send_at: '2026-06-29 10:00' },
];

// ---------------------------------------------------------------------------
// Template Studio (tpl_list / tpl_create / tpl_edit / tpl_delete / tpl_flows).
// Templates are Graph-API-shaped (components array) — this is exactly what
// TemplatesView renders directly and what deserializeTemplate() (templateRules.js)
// expects as input, so opening any of these in the Builder round-trips cleanly.
// One WABA, 2 inboxes, 6 templates spanning every status/quality/component shape.
// ---------------------------------------------------------------------------

const TPL_FLOWS = [
  { id: '1', name: 'טופס לידים', status: 'PUBLISHED' },
];

const TPL_TEMPLATES = [
  // APPROVED marketing, image header, two buttons (URL + PHONE_NUMBER), GREEN quality.
  {
    id: '1001',
    name: 'summer_launch_promo',
    language: 'he',
    category: 'MARKETING',
    status: 'APPROVED',
    quality_score: { score: 'GREEN' },
    last_updated_time: '2026-07-15T09:30:00+0000',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['mock_header_handle_summer'] } },
      { type: 'BODY', text: 'היי {{1}}! 🎉 השקנו מבצע קיץ מיוחד — 20% הנחה על הקמת אוטומציה חדשה עד סוף החודש.', example: { body_text: [['דנה']] } },
      { type: 'FOOTER', text: 'העסק שלי' },
      { type: 'BUTTONS', buttons: [
        { type: 'URL', text: 'לקביעת פגישה', url: 'https://example.com/book' },
        { type: 'PHONE_NUMBER', text: 'התקשרו עכשיו', phone_number: '+972500000000' },
      ] },
    ],
  },
  // PENDING utility, no quality data yet (not scored until approved).
  {
    id: '1002',
    name: 'appointment_reminder_24h',
    language: 'he',
    category: 'UTILITY',
    status: 'PENDING',
    last_updated_time: '2026-07-19T14:00:00+0000',
    components: [
      { type: 'BODY', text: 'תזכורת ידידותית: הפגישה שלכם עם העסק שלי מתוכננת מחר בשעה {{1}}. נשמח לראותכם!', example: { body_text: [['10:00']] } },
    ],
  },
  // REJECTED — exercises the expandable rejected_reason row.
  {
    id: '1003',
    name: 'weekend_flash_deal',
    language: 'he',
    category: 'MARKETING',
    status: 'REJECTED',
    rejected_reason: 'Invalid content: promotional message does not comply with WhatsApp Business Messaging Policy (Abusive Content: excessive urgency/pressure tactics).',
    last_updated_time: '2026-07-12T11:00:00+0000',
    components: [
      { type: 'BODY', text: 'רק היום {{1}}! מבצע בזק ל-6 שעות בלבד — אל תפספסו 🔥', example: { body_text: [['דנה']] } },
    ],
  },
  // PAUSED — commonly caused by quality dropping to RED, modeled that way here.
  {
    id: '1004',
    name: 'winback_quiet_leads',
    language: 'he',
    category: 'MARKETING',
    status: 'PAUSED',
    quality_score: { score: 'RED' },
    last_updated_time: '2026-07-10T08:00:00+0000',
    components: [
      { type: 'BODY', text: 'עדיין כאן בשבילכם {{1}} — רוצים לחדש את השיחה עם העסק שלי?', example: { body_text: [['דנה']] } },
      { type: 'FOOTER', text: 'ניתן להשיב STOP להסרה' },
    ],
  },
  // AUTHENTICATION — fixed OTP component shape (serializeAuthComponents in templateRules.js).
  {
    id: '1005',
    name: 'login_verification_code',
    language: 'he',
    category: 'AUTHENTICATION',
    status: 'APPROVED',
    quality_score: { score: 'YELLOW' },
    last_updated_time: '2026-07-05T12:00:00+0000',
    components: [
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 10 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'copy_code' }] },
    ],
  },
  // CAROUSEL — 2 cards, top-level components are [BODY, CAROUSEL] only (no top-level
  // header/footer/buttons — see templateRules.js validateTemplate's carousel branch).
  {
    id: '1006',
    name: 'services_showcase',
    language: 'he',
    category: 'MARKETING',
    status: 'APPROVED',
    quality_score: { score: 'GREEN' },
    last_updated_time: '2026-07-18T11:00:00+0000',
    components: [
      { type: 'BODY', text: 'הצצה למה שהעסק שלי בונה לכם {{1}} 👇', example: { body_text: [['דנה']] } },
      { type: 'CAROUSEL', cards: [
        {
          components: [
            { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['mock_header_handle_card1'] } },
            { type: 'BODY', text: 'אוטומציית וואטסאפ מקצה לקצה — בלי קוד.' },
            { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'ספרו לי עוד' }] },
          ],
        },
        {
          components: [
            { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['mock_header_handle_card2'] } },
            { type: 'BODY', text: 'ניהול תבניות מלא, ישר מתוך Chatwoot.' },
            { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'לפרטים נוספים', url: 'https://example.com/templates' }] },
          ],
        },
      ] },
    ],
  },
];

const TPL_WABAS = [
  {
    wabaId: '109876543210987',
    inboxes: [
      { inboxId: 501, name: 'העסק שלי — תמיכה', phone: '+972501234567' },
      { inboxId: 502, name: 'העסק שלי — מכירות', phone: '+972501234568' },
    ],
    capabilities: { mediaUpload: true, flows: true },
    templates: TPL_TEMPLATES,
  },
];

function dataFor(action) {
  switch (action) {
    case 'list': return SEQUENCES;
    case 'templates': return TEMPLATES;
    case 'enrollments': return ENROLLMENTS;
    case 'enrollment_status': return STATUS;
    case 'sent_history': return SENT_HISTORY;
    case 'projected_schedule': return PROJECTED;
    case 'set_sequence': return { ok: true };
    case 'labels': return [{ label: 'מכירות', count: 89 }, { label: 'לידים', count: 41 }, { label: 'דחוף', count: 23 }];
    case 'bulk_enroll': return { count: 89, total: 89, label: 'מכירות', sequence: 'seq_welcome' };
    case 'save': return SEQUENCES[0];
    case 'delete': return null;
    case 'tpl_list': return { wabas: TPL_WABAS };
    case 'tpl_create': return { id: 'tpl_mock_new' };
    case 'tpl_edit': return { ok: true };
    case 'tpl_delete': return null;
    case 'tpl_flows': return TPL_FLOWS;
    default: return null;
  }
}

export function installMockFetch() {
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/drip-api')) {
      let action = '';
      try { action = JSON.parse(opts.body || '{}').action || ''; } catch { /* ignore */ }
      // בלי setTimeout — חלון Safari ברקע מקפיא timers; promise resolve (microtask) תמיד רץ.
      return new Response(JSON.stringify({ ok: true, data: dataFor(action) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return real(url, opts);
  };
  // eslint-disable-next-line no-console
  console.info('[drip] DEV mock fetch active (?mock=1)');
}
