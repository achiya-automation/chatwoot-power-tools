/**
 * compliance.test.js — one test per Meta rule.
 *
 * Pure logic only (no DB): isOptOut / isUsNumber / classifyError / inSession / canSend.
 * Each block names the Meta rule it enforces, so a future change that breaks a rule fails
 * a test that says which rule.
 *
 * Run: node --test test/compliance.test.js
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExternalError } from '../src/reconcile.js';



test('isOptOut: English removal words are detected', () => {
  for (const t of ['STOP', 'unsubscribe', 'please remove me from this list', 'opt out']) {
    assert.ok(isOptOut(t), `expected opt-out for "${t}"`);
  }
});

test('isOptOut: matches whole WORDS, not substrings — "הסרטון" is not "הסר"', () => {
  assert.equal(isOptOut('הסרטון שלכם היה מעולה'), null);
  assert.equal(isOptOut('ראיתי את הסרט אתמול'), null);
});

test('isOptOut: ambiguous words only count when they are the whole message', () => {
  assert.ok(isOptOut('די'));                       // one word → clearly "enough"
  assert.equal(isOptOut('די טוב, תודה רבה לכם'), null);   // "quite good" → not an opt-out
  assert.ok(isOptOut('stop'));
  assert.equal(isOptOut('please stop by the store tomorrow to pick it up'), null);
});

test('isOptOut: punctuation and niqqud do not defeat the match', () => {
  assert.ok(isOptOut('הסר!!!'));
  assert.ok(isOptOut('  הסר, בבקשה.  '));
});

test('isOptOut: a normal reply is not an opt-out', () => {
  assert.equal(isOptOut('כן, מעוניין! מתי אפשר לדבר?'), null);
  assert.equal(isOptOut('תודה רבה'), null);
  assert.equal(isOptOut(''), null);
  assert.equal(isOptOut(null), null);
});

test('isOptOut: per-client extra keywords are honoured', () => {
  assert.equal(isOptOut('נא להסירני מהדיוור'), null);          // not in the default list...
  assert.ok(isOptOut('נא להסירני מהדיוור', ['להסירני']));      // ...until the client adds it
});

// ═══════════════════════════════════════════════════════════════════════════
// Meta: marketing templates are NOT delivered to US phone numbers
// ═══════════════════════════════════════════════════════════════════════════

test('isUsNumber: a US number is detected, Canada (+1 too) is not', () => {
  assert.ok(isUsNumber('+1 212 555 0123'));      // New York
  assert.ok(isUsNumber('13105550123'));          // Los Angeles
  assert.equal(isUsNumber('+1 416 555 0123'), false);  // Toronto — Canada shares +1
  assert.equal(isUsNumber('+1 604 555 0123'), false);  // Vancouver
});

test('isUsNumber: non-+1 numbers are never US', () => {
  assert.equal(isUsNumber('+972547200266'), false);
  assert.equal(isUsNumber('+442071234567'), false);
  assert.equal(isUsNumber(''), false);
  assert.equal(isUsNumber(null), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Meta error codes → the action the engine must take
// ═══════════════════════════════════════════════════════════════════════════

test('classifyError: per-user marketing cap codes are a CAP, not a permanent failure', () => {
  assert.equal(classifyError('131049'), 'cap');   // "healthy ecosystem engagement"
  assert.equal(classifyError('130472'), 'cap');
  assert.equal(classifyError('131056'), 'cap');
});

test('classifyError: a paused template is TEMPORARY — the lead must not be burned', () => {
  // Meta pauses a low-quality template for 3h, then 6h. Treating 132015 as permanent
  // (the old behaviour) threw the lead away over a three-hour wait.
  assert.equal(classifyError('132015'), 'template_paused');
});

test('classifyError: portfolio pacing drop is temporary', () => {
  assert.equal(classifyError('135000'), 'pacing');
});

test('classifyError: an explicit marketing opt-out suppresses the contact', () => {
  assert.equal(classifyError('131050'), 'optout');
});

test('classifyError: a policy block halts the whole account', () => {
  assert.equal(classifyError('368'), 'policy');      // temporarily blocked for policy violations
  assert.equal(classifyError('131031'), 'policy');   // account locked
  assert.equal(classifyError('133010'), 'policy');   // phone number not registered
  assert.equal(classifyError('133016'), 'policy');
});

test('classifyError: 133004 is a server hiccup, NOT a policy halt', () => {
  assert.equal(classifyError('133004'), 'transient');
});

// ⛔ this test used to assert `999999 → 'permanent'` — it ENSHRINED the bug.
// Defaulting an unrecognised code to 'permanent' meant `failEnrollment`: every code we
// had not enumerated deleted the lead forever. It killed leads on 131048 (a TEMPORARY
// spam throttle) and on 368 (a policy block that returned null from the parser) — the
// two codes where the engine was supposed to STOP EVERYTHING and shout.
// Not knowing a code is our ignorance. It is not evidence the recipient is unreachable.
test('classifyError: an unknown code must NEVER be fatal — only enumerated codes kill', () => {
  assert.equal(classifyError('131026'), 'invalid');    // known: not a WhatsApp number
  assert.equal(classifyError('999999'), 'transient');  // unknown → cool down + alert
  assert.equal(classifyError(null), 'transient');
});

// ═══════════════════════════════════════════════════════════════════════════
// Meta: "marketing messages sent within [the 24h] window do not count towards the limit"
// ═══════════════════════════════════════════════════════════════════════════

test('inSession: a reply within 24h opens the window; older does not', () => {
  const now = new Date('2026-07-12T12:00:00Z');
  assert.ok(inSession({ last_inbound_at: '2026-07-12T02:00:00Z' }, now));       // 10h ago
  assert.equal(inSession({ last_inbound_at: '2026-07-11T02:00:00Z' }, now), false); // 34h ago
  assert.equal(inSession({}, now), false);
  assert.equal(inSession(null, now), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// canSend — the gate
// ═══════════════════════════════════════════════════════════════════════════

const base = {
  category: 'MARKETING',
  contact:  { consent_at: '2026-07-01T00:00:00Z', consent_source: 'lead_ad' },
  phone:    '+972541234567',
  settings: DEFAULT_SETTINGS,
  health:   {},
  template: { status: 'APPROVED', quality: 'GREEN' },
  sentToday: 0,
  inSession: false,
};

test('canSend: a consented contact with an approved template passes', () => {
  assert.deepEqual(canSend(base), { ok: true });
});

test('canSend: Meta rule #1 "Expected" — no consent record, no marketing', () => {
  const v = canSend({ ...base, contact: {} });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'no_consent');
  assert.equal(v.action, 'defer');   // the lead waits for consent, it is not destroyed
});

test('canSend: UTILITY is exempt from the consent gate and the per-user cap', () => {
  // Meta's per-user marketing limit applies to MARKETING only. An order update must
  // still reach the customer.
  assert.deepEqual(canSend({ ...base, category: 'UTILITY', contact: {} }), { ok: true });
  assert.deepEqual(canSend({ ...base, category: 'AUTHENTICATION', contact: {}, sentToday: 99 }), { ok: true });
});

test('canSend: an open 24h session bypasses consent AND the daily cap', () => {
  // Inside a customer-service window Meta counts nothing against either limit, so the
  // gate must not invent a restriction Meta does not impose.
  const v = canSend({ ...base, contact: {}, sentToday: 5, inSession: true });
  assert.equal(v.ok, true);
  assert.equal(v.reason, 'in_session');
});

test('canSend: a halted account blocks marketing', () => {
  const v = canSend({ ...base, health: { halted: true, halt_reason: 'RED' } });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'account_halted');
  assert.equal(v.action, 'defer');   // the lead waits, it is not destroyed
});

test('canSend: a halted account still serves a lead inside an open service window', () => {
  // RED halts marketing, but replying to someone who wrote to us is service — Meta does
  // not count it as marketing and it improves the quality rating. A lead who answered the
  // opener ("when is the bat-mitzvah?") must still get the rest of her sequence.
  const v = canSend({ ...base, contact: {}, health: { halted: true, halt_reason: 'RED' }, inSession: true });
  assert.equal(v.ok, true);
  assert.equal(v.reason, 'in_session');
});

test('canSend: a fresh opener passes even when the account is halted (RED)', () => {
  // ליד שנרשם ממש עכשיו — הפתיחה אליו עוברת גם ב-RED: engagement טרי (91% מסירה) שמסייע
  // להתאוששות, וליד שלא מקבל פתיחה בזמן אבוד. reconcile מסמן isFreshOpener רק ל-step 1 טרי.
  const v = canSend({ ...base, health: { halted: true, halt_reason: 'RED' }, isFreshOpener: true });
  assert.equal(v.ok, true);
});

test('canSend: a halted account still blocks a non-fresh step (cold audience stays protected)', () => {
  // ההחרגה צרה בכוונה — רק הפתיחה הטרייה. כל צעד אחר (וגם קהל ישן) נשאר עצור ב-RED.
  const v = canSend({ ...base, health: { halted: true, halt_reason: 'RED' }, isFreshOpener: false, inSession: false });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'account_halted');
});

test('canSend: a suppressed contact is dropped, not deferred', () => {
  const v = canSend({ ...base, contact: { ...base.contact, suppressed_at: new Date(), suppressed_reason: 'keyword' } });
  assert.equal(v.ok, false);
  assert.equal(v.action, 'drop');
  assert.equal(v.detail, 'keyword');
});

test('canSend: a keyword opt-out (scope=all) blocks UTILITY too', () => {
  const contact = { suppressed_at: new Date(), suppressed_reason: 'keyword', suppressed_scope: 'all' };
  assert.equal(canSend({ ...base, category: 'UTILITY', contact }).ok, false);
});

test('canSend: a marketing-scoped suppression still lets UTILITY through', () => {
  const contact = { suppressed_at: new Date(), suppressed_reason: 'meta_131050', suppressed_scope: 'marketing' };
  assert.equal(canSend({ ...base, category: 'MARKETING', contact }).ok, false);
  assert.equal(canSend({ ...base, category: 'UTILITY', contact }).ok, true);
});

test('canSend: a paused template DEFERS the lead — it does not fail it', () => {
  const v = canSend({ ...base, template: { status: 'PAUSED' } });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'template_paused');
  assert.equal(v.action, 'defer');
});

test('canSend: an unknown template is allowed (fail-open) — a Graph outage must not mute a client', () => {
  assert.equal(canSend({ ...base, template: null }).ok, true);
});

test('canSend: a halted account sends nothing, but keeps every lead in place', () => {
  const v = canSend({ ...base, health: { halted: true, halt_reason: 'RED' } });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'account_halted');
  assert.equal(v.action, 'defer');
});

test('canSend: Meta "be mindful of how frequently you send" — the per-contact daily cap', () => {
  assert.equal(canSend({ ...base, sentToday: 0 }).ok, true);
  const v = canSend({ ...base, sentToday: 1 });   // default max_marketing_per_day = 1
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'daily_cap');
  assert.equal(v.action, 'defer');
});

test('canSend: the daily cap is configurable per client', () => {
  const settings = { ...DEFAULT_SETTINGS, max_marketing_per_day: 3 };
  assert.equal(canSend({ ...base, settings, sentToday: 2 }).ok, true);
  assert.equal(canSend({ ...base, settings, sentToday: 3 }).ok, false);
});

test('canSend: marketing to a US number is dropped (Meta never delivers it)', () => {
  const v = canSend({ ...base, phone: '+12125550123' });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'us_number');
  assert.equal(v.action, 'drop');
});

test('canSend: a saturated contact (repeated 131049) is DEFERRED, never dropped', () => {
  // תוקן 2026-07-13. הכלל הישן היה 'drop', והוא מחק 335 הרשמות בבננה בוק — 324 מהן על
  // 131049, ובהן 65 לידים שהגיבו ו-134 שקראו. מטא: התקרה הפר-נמענת "adapts automatically
  // over time", והיא מתבטלת לגמרי בחלון שירות פתוח. שגיאה זמנית לא מוחקת ליד.
  const v = canSend({ ...base, contact: { ...base.contact, cap_failures: 2 } });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'saturated');
  assert.equal(v.action, 'defer');
});

test('canSend: a contact who never opens marketing is dropped before Meta punishes the list', () => {
  // Meta's per-user cap is driven by the recipient's recent marketing READ RATE. Every
  // send to someone who never opens drags the list's rate down — which shrinks the cap
  // for every other contact too.
  const v = canSend({ ...base, contact: { ...base.contact, unengaged_streak: 3 } });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'unengaged');
  assert.equal(v.action, 'drop');
});

test('canSend: consent can be turned off per client (opt-in enforced elsewhere)', () => {
  const settings = { ...DEFAULT_SETTINGS, require_consent: false };
  assert.equal(canSend({ ...base, settings, contact: {} }).ok, true);
});

test('canSend: the order of checks — a halt beats everything, a drop beats a defer', () => {
  // A halted account with a suppressed contact and a paused template must report the halt:
  // it is the fact the operator needs to see.
  const v = canSend({
    ...base,
    health:   { halted: true },
    template: { status: 'PAUSED' },
    contact:  { suppressed_at: new Date() },
  });
  assert.equal(v.reason, 'account_halted');
});

test('isMarketing: defaults to marketing when the category is missing', () => {
  // Safer default: an uncategorised step is treated as marketing, so it gets the caps
  // rather than slipping past them.
  assert.equal(isMarketing(undefined), true);
  assert.equal(isMarketing('marketing'), true);
  assert.equal(isMarketing('UTILITY'), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2026-07-13 — מה שהנתונים לימדו אותנו (בננה בוק, n=4,998)
// ═══════════════════════════════════════════════════════════════════════════

test('canSend: רוויה (131049) נדחית ולא מסירה — התקרה של מטא זמנית, opt-out לא', () => {
  // 324 מתוך 335 ההרשמות שנפלו בבננה בוק נפלו על 131049 — שגיאה זמנית. הן נמחקו מהרצף
  // לנצח, ובהן 199 לידים שכבר הגיבו או קראו. תקרה ≠ בקשת הסרה.
  const capped = canSend({ ...base, contact: { ...base.contact, suppressed_at: '2026-07-12T10:00:00Z',
                                               suppressed_reason: 'saturated' } });
  assert.equal(capped.ok, false);
  assert.equal(capped.reason, 'saturated');
  assert.equal(capped.action, 'defer');   // ⛔ אסור 'drop' — הליד חייב להישאר ברצף

  const optOut = canSend({ ...base, contact: { ...base.contact, suppressed_at: '2026-07-12T10:00:00Z',
                                               suppressed_reason: 'keyword' } });
  assert.equal(optOut.action, 'drop');    // מי שביקש להסיר — יוצא, תמיד
});

test('canSend: תגובה מבטלת רוויה — חלון פתוח עוקף את חסימת המכסה', () => {
  // מטא: "Marketing messages sent within this window do not count towards the limit".
  // נמדד: 25/25 = 100% מסירה בחלון פתוח, מול 7.9% לנמענת שמטא כבר חסמה.
  const v = canSend({ ...base, inSession: true,
                      contact: { ...base.contact, suppressed_at: '2026-07-12T10:00:00Z',
                                 suppressed_reason: 'saturated', cap_failures: 9 } });
  assert.equal(v.ok, true);

  // …אבל חלון פתוח לא מחייה מי שביקשה להסיר.
  const optOut = canSend({ ...base, inSession: true,
                           contact: { ...base.contact, suppressed_at: '2026-07-12T10:00:00Z',
                                      suppressed_reason: 'keyword' } });
  assert.equal(optOut.ok, false);
  assert.equal(optOut.action, 'drop');
});

test('canSend: תבנית מעל התקציב נעצרת לנמענת מסוכנת — ולעולם לא לנמענת נקייה', () => {
  const burned = { ...base.template, failures: 40 };
  const risky  = { ...base.contact, cap_failures: 1 };   // מטא כבר חסמה אותה פעם

  const v = canSend({ ...base, template: burned, contact: risky });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'template_burned');
  assert.equal(v.action, 'defer');        // הליד ממתין לתאומה, לא נזרק

  // ⭐ נמענת נקייה עוברת גם בתבנית מעל התקציב: היא מוסרת ב-84% ו*מרפאת* את התבנית.
  // חסימה שלה הייתה מקפיאה את הרצף בדיוק בשביל הלידים הטובים — ירייה ברגל.
  assert.deepEqual(canSend({ ...base, template: burned }), { ok: true });

  // מתחת לסף — עוברת גם למסוכנת.
  assert.deepEqual(canSend({ ...base, template: { ...base.template, failures: 39 }, contact: risky }), { ok: true });

  // בחלון פתוח שולחים תמיד: השליחה נמסרת (100%) ולא נספרת בשום מכסה.
  assert.equal(canSend({ ...base, template: burned, contact: risky, inSession: true }).ok, true);

  // תבנית שאין עליה מידע — fail-open. חוסר ידע לא משתק לקוח.
  assert.deepEqual(canSend({ ...base, template: null }), { ok: true });
});

test('canSend: cap_failures מעל הסף נדחה, לא מוסר', () => {
  const v = canSend({ ...base, contact: { ...base.contact, cap_failures: 2 } });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'saturated');
  assert.equal(v.action, 'defer');
});

test('scanInbound: תגובה ישנה אינה מאפסת את מונה החסימות (נמדד: 13/13 נכשלו)', () => {
  // הרגרסיה: cap_failures התאפס בכל תגובה. תגובה מלפני שבועות אינה מרפה את התקרה של
  // מטא — רק חלון פתוח מרפה אותה. 13 לידים שהמונה שלהם אופס כך נשלחו כ"נקיים" וחזרו
  // 13/13 עם 131049, בעוד שלידים עם מונה אמיתי 0 נמסרו 3/3.
  // השער חייב לחסום נמענת עם היסטוריית חסימות גם אם היא הגיבה פעם.
  const stale = { ...base.contact, cap_failures: 2, last_inbound_at: '2026-06-01T10:00:00Z' };
  const v = canSend({ ...base, contact: stale });
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'saturated');

  // …אבל חלון פתוח (תגובה בתוך 24ש׳) כן עוקף — זה המנגנון היחיד שמטא מתעדת.
  assert.equal(canSend({ ...base, contact: stale, inSession: true }).ok, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// בחירת מספר הוואטסאפ (חשבון עם כמה מספרים)
// ═══════════════════════════════════════════════════════════════════════════

test('resolveInbox: מספר יחיד → נבחר לבד; כמה מספרים בלי בחירה → ambiguous, לא ניחוש', async () => {
  const { makeDbReads } = await import('../src/reads.js');

  // תיבה אחת — אין מה לבחור, וחשבון קיים לא נדרש להגדיר כלום.
  let reads = makeDbReads(async () => [{ id: 5, chosen: null }]);
  assert.deepEqual(await reads.resolveInbox(7), { inboxId: 5, ambiguous: false, count: 1 });

  // שלוש תיבות ואף אחת לא נבחרה — המנוע חייב לעצור. שליחה מהמספר הלא נכון היא
  // טעות שהלקוח רואה ואי אפשר לבטל.
  reads = makeDbReads(async () => [{ id: 5, chosen: false }, { id: 9, chosen: false }, { id: 12, chosen: false }]);
  assert.deepEqual(await reads.resolveInbox(1), { inboxId: null, ambiguous: true, count: 3 });

  // אותן שלוש, אחת נבחרה — היא גוברת, גם אם היא לא בעלת ה-id הנמוך.
  reads = makeDbReads(async () => [{ id: 5, chosen: false }, { id: 9, chosen: true }, { id: 12, chosen: false }]);
  assert.deepEqual(await reads.resolveInbox(1), { inboxId: 9, ambiguous: false, count: 3 });

  // אין תיבת וואטסאפ בכלל.
  reads = makeDbReads(async () => []);
  assert.deepEqual(await reads.resolveInbox(3), { inboxId: null, ambiguous: false, count: 0 });
});

test('loadTemplates / getWhatsappCreds: אי-בהירות ⇒ ריק, לא ניחוש', async () => {
  const { makeDbReads } = await import('../src/reads.js');
  const reads = makeDbReads(async () => [{ id: 5, chosen: false }, { id: 9, chosen: false }]);
  assert.deepEqual(await reads.loadTemplates(1), []);      // ⛔ לא מערבבים תבניות משני מספרים
  assert.equal(await reads.getWhatsappCreds(1), null);     // ⛔ ולא קוראים בריאות ממספר שרירותי
});

// ── ⭐ the parser and the classifier must be tested TOGETHER ──────────────────────
// The old test called classifyError('368') directly and passed — while in production
// parseExternalError could not read a 3-digit code at all (`\d{4,7}`), returned null,
// and the account-halt branch for a Meta POLICY BLOCK was dead code. A green test that
// skips the parser is worse than no test: it manufactures confidence.
// Always assert through the real chain: Meta's error string → parse → classify.
const classifyRaw = (s) => classifyError(parseExternalError(JSON.stringify({ external_error: s }))?.code);

test('⭐ Meta policy block (#368) is parsed and HALTS the account — not silently fatal', () => {
  assert.equal(classifyRaw('(#368) Temporarily blocked for policies violations'), 'policy',
    'a 3-digit code must parse; this is the most dangerous signal Meta sends');
});

test('⭐ 131048 (spam rate limit) halts — hammering into it is how a throttle becomes a ban', () => {
  assert.equal(classifyRaw('131048: Spam rate limit hit'), 'policy');
});

test('⛔ an UNKNOWN Meta code never kills the lead', () => {
  assert.equal(classifyRaw('999999: a code that did not exist when this was written'), 'transient',
    'not knowing a code is our ignorance, not evidence the recipient is unreachable');
});

test('a media download error is transient (ours to fix), not the lead\'s fault', () => {
  assert.equal(classifyRaw('131053: Unable to download the media'), 'transient');
});

test('the codes we DO know stay correct through the parser', () => {
  assert.equal(classifyRaw('131049: not delivered to maintain healthy ecosystem engagement'), 'cap');
  assert.equal(classifyRaw('131026: Message undeliverable'), 'invalid');
  assert.equal(classifyRaw('131050: not accepting marketing messages'), 'optout');
  assert.equal(classifyRaw('132015: template paused'), 'template_paused');
});
import {
  isOptOut, isMarketing, isUsNumber, classifyError, inSession, canSend, DEFAULT_SETTINGS,
} from '../src/compliance.js';

// ═══════════════════════════════════════════════════════════════════════════
// Meta: "provide a clear way to opt-out in the message"
// ═══════════════════════════════════════════════════════════════════════════

test('isOptOut: Hebrew removal words are detected', () => {
  for (const t of ['הסר', 'הסירו אותי', 'תסיר אותי בבקשה', 'להסיר', 'הסרה מהרשימה']) {
    assert.ok(isOptOut(t), `expected opt-out for "${t}"`);
  }
});

test('isOptOut: Hebrew removal phrases are detected inside a longer message', () => {
  assert.ok(isOptOut('שלום, אני לא מעוניין בהודעות האלה יותר, תודה'));
  assert.ok(isOptOut('אל תשלחו לי יותר הודעות בבקשה'));
  assert.ok(isOptOut('תורידו אותי מהרשימה שלכם'));
});
