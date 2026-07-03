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
