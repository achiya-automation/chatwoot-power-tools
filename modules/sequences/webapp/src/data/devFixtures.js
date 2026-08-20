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

// ── בונה פלואו (journeys) ──
const JRN_GRAPH = {
  nodes: [
    { id: 'trigger', type: 'trigger', data: {}, position: { x: 260, y: 40 } },
    { id: 'n1', type: 'message', data: { text: 'היי {{שם}} 👋 כאן העוזר של העסק.', mediaUrl: '' }, position: { x: 240, y: 200 } },
    {
      id: 'n2',
      type: 'buttons',
      data: {
        text: 'במה נוכל לעזור?',
        options: [{ title: 'הצעת מחיר', value: 'quote' }, { title: 'תמיכה', value: 'support' }],
        saveTo: { scope: 'contact', key: 'topic' },
        retryMessage: '',
        followUp: { afterMinutes: 60, message: 'עדיין כאן 🙂 במה נוכל לעזור?', maxRetries: 1, onGiveUp: 'continue' },
      },
      position: { x: 240, y: 360 },
    },
    { id: 'n3', type: 'condition', data: { field: 'topic', op: 'eq', value: 'quote' }, position: { x: 240, y: 540 } },
    {
      id: 'n4',
      type: 'question',
      data: {
        text: 'מה התקציב המשוער?',
        validation: 'number',
        saveTo: { scope: 'contact', key: 'budget' },
        retryMessage: '',
        followUp: null,
      },
      position: { x: 60, y: 720 },
    },
    { id: 'n5', type: 'handoff', data: { message: 'מעביר לנציג 🙏', assigneeId: null, teamId: null }, position: { x: 420, y: 720 } },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'n1', sourceHandle: null },
    { id: 'e2', source: 'n1', target: 'n2', sourceHandle: null },
    { id: 'e3', source: 'n2', target: 'n3', sourceHandle: null },
    { id: 'e4', source: 'n3', target: 'n4', sourceHandle: 'yes' },
    { id: 'e5', source: 'n3', target: 'n5', sourceHandle: 'no' },
  ],
};

const JOURNEYS = [
  {
    id: 'jrn_1', account_id: 1, name: 'קליטת ליד חדש', status: 'active',
    trigger: { inbox_ids: [501], keywords: ['הצעת מחיר'], on_new_conversation: true, manual: true },
    graph: JRN_GRAPH, node_count: 7, live_runs: 2, done_runs: 14, updated_at: '2026-07-20T10:00:00Z',
  },
  {
    id: 'jrn_2', account_id: 1, name: 'שאלון שביעות רצון', status: 'draft',
    trigger: { inbox_ids: [], keywords: [], on_new_conversation: false, manual: true },
    graph: { nodes: [{ id: 'trigger', type: 'trigger', data: {}, position: { x: 260, y: 40 } }], edges: [] },
    node_count: 1, live_runs: 0, done_runs: 0, updated_at: '2026-07-18T08:30:00Z',
  },
];

const JRN_RUNS = [
  {
    id: 'run_1', display_id: 214, status: 'waiting_answer', current_node: 'n4',
    answers: { topic: 'quote' }, retry_count: 0, waiting_since: '2026-07-21T09:15:00Z',
    next_action_at: null, last_error: null, created_at: '2026-07-21T09:00:00Z', updated_at: '2026-07-21T09:15:00Z',
  },
  {
    id: 'run_2', display_id: 209, status: 'done', current_node: 'n5',
    answers: { topic: 'support' }, retry_count: 0, waiting_since: null,
    next_action_at: null, last_error: null, created_at: '2026-07-20T14:00:00Z', updated_at: '2026-07-20T14:05:00Z',
  },
  {
    id: 'run_3', display_id: 187, status: 'failed', current_node: 'n2',
    answers: {}, retry_count: 2, waiting_since: null,
    next_action_at: null, last_error: 'buttons: send failed', created_at: '2026-07-19T11:00:00Z', updated_at: '2026-07-19T11:02:00Z',
  },
];

// ---------------------------------------------------------------------------
// Compliance (compliance / suppressed).
// Shaped like drip.compliance_overview: health + settings + templates + alerts +
// contact counters. Deliberately NOT an all-green account — one paused template,
// a YELLOW quality rating and an open alert, so the states that actually matter
// are visible instead of an empty happy path.
// ---------------------------------------------------------------------------

const COMPLIANCE = {
  health: {
    tier: 'TIER_2K', cap: 2000, quality: 'YELLOW',
    halted: false, halt_reason: null, halted_at: null, checked_at: '2026-06-22 08:15',
  },
  settings: {
    require_consent: true, max_marketing_per_day: 1, max_unengaged: 3, max_cap_failures: 2,
    consent_max_age_days: 30, block_us_marketing: true, halt_on_red: true,
    opt_out_keywords: ['להסיר', 'די'], max_template_failures: 40,
    min_delivery_rate: 70, min_delivery_sample: 20, fresh_opener_hours: 48,
  },
  templates: [
    { template_name: 'welcome_intro', language: 'he', status: 'APPROVED', quality: 'GREEN', category: 'MARKETING', checked_at: '2026-06-22 08:15' },
    { template_name: 'followup_value', language: 'he', status: 'APPROVED', quality: 'YELLOW', category: 'MARKETING', checked_at: '2026-06-22 08:15' },
    { template_name: 'offer_discount', language: 'he', status: 'PAUSED', quality: 'RED', category: 'MARKETING', checked_at: '2026-06-22 08:15' },
    { template_name: 'appointment_reminder', language: 'he', status: 'APPROVED', quality: 'GREEN', category: 'UTILITY', checked_at: '2026-06-22 08:15' },
  ],
  alerts: [
    // code+params — ה-UI מרכיב את המשפט בשפת הנציג. message הוא ה-fallback בלבד.
    { id: 1, level: 'warn', code: 'template_paused', params: { template: 'offer_discount' }, message: 'התבנית offer_discount מושהית ע"י מטא.', created_at: '2026-06-22 07:40', acked_at: null },
  ],
  // usage — תקציב 24 השעות מול התקרה, כולל המספר שהנתונים שייכים לו (לחשבון יש כמה).
  // cap: -1 = ללא הגבלה. מנוע ישן לא מחזיר את הבלוק הזה כלל, והמסך מתנהג כמו קודם.
  usage: { used_24h: 312, cap: 2000, inbox: { id: 21, name: 'מכירות', phone: '+972501234567' } },
  contacts: { known: 412, with_consent: 386, suppressed: 19, stale: 7 },
  // הכיסוי נמדד על מי שנמצא ברצף בלבד (386 + 26), לא על כל 412 אנשי הקשר — מכנה
  // שכולל אנשי קשר שמחוץ לרצף היה מדלל את האחוז ומסתיר את הפער האמיתי.
  blanket_consent: null,
  without_consent_record: 26,
  missing_consent: 26,
  suppressed_by_reason: { opted_out: 9, saturated: 5, unengaged: 3, invalid: 2 },
};

const SUPPRESSED = [
  { contact_id: 301, contact_name: 'רון לוי',  phone: '+972541112222', suppressed_at: '2026-06-21 14:20', suppressed_reason: 'opted_out', suppressed_detail: 'להסיר',     suppressed_scope: 'marketing', unengaged_streak: 0, cap_failures: 0, consent_source: 'label', consent_at: '2026-05-02 10:00' },
  { contact_id: 302, contact_name: 'מיכל ברק', phone: '+972523334444', suppressed_at: '2026-06-20 09:05', suppressed_reason: 'saturated', suppressed_detail: '131049',    suppressed_scope: 'marketing', unengaged_streak: 1, cap_failures: 2, consent_source: 'form',  consent_at: '2026-05-18 12:30' },
  { contact_id: 303, contact_name: 'עדי שמש',  phone: '+972505556666', suppressed_at: '2026-06-19 16:45', suppressed_reason: 'unengaged', suppressed_detail: '',          suppressed_scope: 'marketing', unengaged_streak: 3, cap_failures: 0, consent_source: 'label', consent_at: '2026-04-11 08:00' },
  { contact_id: 304, contact_name: '',         phone: '+15551234567',  suppressed_at: '2026-06-18 11:10', suppressed_reason: 'invalid',   suppressed_detail: 'US number', suppressed_scope: 'all',       unengaged_streak: 0, cap_failures: 0, consent_source: null,    consent_at: null },
];

// ---------------------------------------------------------------------------
// Campaigns (campaigns / campaign_detail / campaigns_trend / campaigns_tier).
// The funnel narrows audience → attempted → sent → delivered → read, and the
// detailed campaign carries failures + a not_sent tail so the "what didn't go
// out, and why" half of the screen has something to render.
// ---------------------------------------------------------------------------

const CAMPAIGNS = [
  { id: 9001, display_id: 12, title: 'השקת מסלול קיץ', campaign_type: 'one_off', campaign_status: 'completed', template_name: 'offer_discount',       language: 'he', category: 'MARKETING', audience: 'תווית: לידים',  scheduled_at: '2026-06-18 10:00', created_at: '2026-06-17 15:20', attempted: 240, sent: 232, delivered: 221, read: 148, failed: 8 },
  { id: 9002, display_id: 11, title: 'תזכורת פגישות',  campaign_type: 'one_off', campaign_status: 'completed', template_name: 'appointment_reminder', language: 'he', category: 'UTILITY',   audience: 'תווית: מכירות', scheduled_at: '2026-06-14 09:00', created_at: '2026-06-13 18:05', attempted: 89,  sent: 89,  delivered: 87,  read: 71,  failed: 0 },
  { id: 9003, display_id: 10, title: 'ברוכים הבאים',   campaign_type: 'one_off', campaign_status: 'completed', template_name: 'welcome_intro',        language: 'he', category: 'MARKETING', audience: 'תווית: דחוף',   scheduled_at: '2026-06-09 12:00', created_at: '2026-06-09 09:40', attempted: 41,  sent: 39,  delivered: 38,  read: 21,  failed: 2 },
];

const CAMPAIGN_DETAIL = {
  campaign: {
    id: 9001, title: 'השקת מסלול קיץ',
    message: 'מתנה בשבילך {{1}} 🎁 — 15% הנחה על הקמת אוטומציה ראשונה. הקוד בתוקף השבוע.',
    campaign_type: 'one_off', campaign_status: 'completed', audience: 'תווית: לידים', inbox_id: 21,
    template_name: 'offer_discount', language: 'he', category: 'MARKETING', created_at: '2026-06-17 15:20',
  },
  funnel: { audience: 248, attempted: 240, sent: 232, delivered: 221, read: 148, failed: 8 },
  engagement: {
    replied: 34, reply_rate: 15,
    replies: [
      { contact_name: 'דנה כהן',   phone: '+972541234567', content: 'מעניין! אפשר פרטים?', replied_at: '2026-06-18 10:22' },
      { contact_name: 'יואב אלון', phone: '+972529876543', content: 'כן, נשמח לשיחה',      replied_at: '2026-06-18 11:05' },
    ],
  },
  recipients: [
    { contact_name: 'דנה כהן',   phone: '+972541234567', status: 2,      sent_at: '2026-06-18 10:00', attempt_count: 1, conversation_display_id: 101, replied: true, replied_at: '2026-06-18 10:22', reply_content: 'מעניין! אפשר פרטים?', error_title: null },
    { contact_name: 'יואב אלון', phone: '+972529876543', status: 1, sent_at: '2026-06-18 10:00', attempt_count: 1, conversation_display_id: 102, replied: false, replied_at: null, reply_content: null, error_title: null },
    { contact_name: 'שירה פרץ',  phone: '+972501112233', status: 0,      sent_at: '2026-06-18 10:01', attempt_count: 1, conversation_display_id: 103, replied: false, replied_at: null, reply_content: null, error_title: null },
    { contact_name: 'אורי נחום', phone: '+972536667788', status: 3,    sent_at: '2026-06-18 10:01', attempt_count: 2, conversation_display_id: 104, replied: false, replied_at: null, reply_content: null, error_title: 'הנמען חרג מהמכסה האישית (131049)' },
  ],
  not_sent: [
    { contact_id: 305, contact_name: 'נועה גל', phone: '+972544445555', reason: 'no_attempt_record' },
  ],
  audience_source: 'snapshot',
};

// תוצאות פר-ניסוי: השליחה המקורית ושתי שליחות חוזרות, כל אחת בתבנית אחרת.
const CAMPAIGN_EXPERIMENTS = [
  { run_id: null,        template_name: 'offer_discount',  started_at: '2026-06-18 10:00', attempted: 240, sent: 232, delivered: 221, read: 148, failed: 8, replied: 34 },
  { run_id: 'r17501001', template_name: 'offer_discount',  started_at: '2026-06-19 09:12', attempted: 8,   sent: 3,   delivered: 3,   read: 1,   failed: 5, replied: 0 },
  { run_id: 'r17502002', template_name: 'service_followup', started_at: '2026-06-20 11:40', attempted: 5,  sent: 5,   delivered: 5,   read: 4,   failed: 0, replied: 2 },
];

const CAMPAIGNS_TREND = [
  { day: '09/06', attempted: 41,  sent: 39,  delivered: 38,  failed: 2 },
  { day: '10/06', attempted: 0,   sent: 0,   delivered: 0,   failed: 0 },
  { day: '11/06', attempted: 0,   sent: 0,   delivered: 0,   failed: 0 },
  { day: '12/06', attempted: 12,  sent: 12,  delivered: 12,  failed: 0 },
  { day: '13/06', attempted: 0,   sent: 0,   delivered: 0,   failed: 0 },
  { day: '14/06', attempted: 89,  sent: 89,  delivered: 87,  failed: 0 },
  { day: '15/06', attempted: 0,   sent: 0,   delivered: 0,   failed: 0 },
  { day: '16/06', attempted: 6,   sent: 6,   delivered: 6,   failed: 0 },
  { day: '17/06', attempted: 0,   sent: 0,   delivered: 0,   failed: 0 },
  { day: '18/06', attempted: 240, sent: 232, delivered: 221, failed: 8 },
  { day: '19/06', attempted: 18,  sent: 18,  delivered: 17,  failed: 0 },
  { day: '20/06', attempted: 0,   sent: 0,   delivered: 0,   failed: 0 },
  { day: '21/06', attempted: 24,  sent: 24,  delivered: 23,  failed: 0 },
  { day: '22/06', attempted: 9,   sent: 9,   delivered: 9,   failed: 0 },
];

const CAMPAIGNS_TIER = { cap: 2000, unlimited: false, used_24h: 312, remaining: 1688 };

function dataFor(action, payload = {}) {
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
    case 'jrn_list': return JOURNEYS;
    case 'jrn_get': return JOURNEYS.find((j) => j.id === payload.id) || JOURNEYS[0];
    case 'jrn_save': return {
      id: payload.id || 'jrn_mock_new', account_id: 1, name: payload.name,
      status: 'draft', trigger: payload.trigger || {}, graph: payload.graph || { nodes: [], edges: [] },
      updated_at: new Date().toISOString(),
    };
    case 'jrn_delete': return { deleted: true };
    case 'jrn_set_status': return { ...(JOURNEYS.find((j) => j.id === payload.id) || JOURNEYS[0]), status: payload.status };
    case 'jrn_meta': return {
      inboxes: [
        { id: 501, name: 'העסק שלי — תמיכה', channel_type: 'Channel::Whatsapp' },
        { id: 502, name: 'העסק שלי — מכירות (WAHA)', channel_type: 'Channel::Api' },
      ],
    };
    case 'jrn_runs': return JRN_RUNS;
    case 'jrn_launch': return { started: true, run_id: 'run_new' };
    case 'jrn_stop_run': return { stopped: true };
    case 'compliance': return COMPLIANCE;
    case 'suppressed': return SUPPRESSED;
    case 'save_compliance': return { ok: true };
    case 'record_consent': return { ok: true };
    case 'consent_by_label': return { count: 41, label: 'לידים' };
    case 'set_suppression': return { ok: true };
    case 'ack_alert': return { ok: true };
    case 'resume_account': return { ok: true };
    case 'campaigns': return CAMPAIGNS;
    case 'campaign_detail': return CAMPAIGN_DETAIL;
    case 'campaign_experiments': return CAMPAIGN_EXPERIMENTS;
    // שליחה מחדש: התנעה מחזירה total, והסטטוס חוזר "הסתיים" מיד — כך אפשר לראות את
    // פאנל הסיכום (כמה יצאו / כמה נכשלו שוב) בלי engine מקומי.
    case 'campaign_resend': return { total: 8, run_id: 'r-mock', template_name: 'service_followup' };
    case 'campaign_resend_status': return {
      status: 'done', total: 8, done: 8, sent: 5, run_id: 'r-mock', template_name: 'service_followup',
      failed: [
        { phone: '+972541111111', name: 'רון', error: 'Meta חסמה את ההודעה כדי לשמור על מעורבות תקינה' },
        { phone: '+972542222222', name: 'גילי', error: 'Meta חסמה את ההודעה כדי לשמור על מעורבות תקינה' },
        { phone: '+972543333333', name: 'תמר', error: 'הנמען ביקש הסרה (opt-out)' },
      ],
    };
    case 'campaign_resend_pending': return null;
    // שלושה מספרים בחשבון, אחד מהם בדירוג נמוך — בדיוק המצב שבו הבחירה "ממי לשלוח" נחוצה.
    case 'campaign_inboxes': return [
      { id: 21, name: 'העסק שלי — ראשי', phone: '+972551111111', quality: 'RED', tier: 'TIER_2K' },
      { id: 22, name: 'העסק שלי — משני', phone: '+972552222222', quality: 'GREEN', tier: 'TIER_2K' },
      { id: 23, name: 'העסק שלי — שירות', phone: '+972553333333', quality: 'UNKNOWN', tier: null },
    ];
    case 'campaign_resend_schedule': return { run_at: payload.run_at };
    case 'campaign_resend_unschedule': return { cancelled: 1 };
    case 'campaigns_trend': return CAMPAIGNS_TREND;
    case 'campaigns_tier': return CAMPAIGNS_TIER;
    default: return null;
  }
}

export function installMockFetch() {
  const real = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/drip-api')) {
      let action = '';
      let payload = {};
      try {
        const body = JSON.parse(opts.body || '{}');
        action = body.action || '';
        payload = body.payload || {};
      } catch { /* ignore */ }
      // בלי setTimeout — חלון Safari ברקע מקפיא timers; promise resolve (microtask) תמיד רץ.
      return new Response(JSON.stringify({ ok: true, data: dataFor(action, payload) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return real(url, opts);
  };
  // eslint-disable-next-line no-console
  console.info('[drip] DEV mock fetch active (?mock=1)');
}
