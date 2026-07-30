import { normalizePhone } from './phoneNormalizer.js';

export const SYSTEM_FIELDS = [
  'name', 'first_name', 'last_name', 'phone_number', 'phone_number_alt',
  'email', 'identifier', 'company_name', 'city', 'country',
];

// Lowercased synonym lists (Hebrew + English). Matched against a normalized
// header (lowercased, punctuation/whitespace stripped).
const SYNONYMS = {
  first_name: ['שם פרטי', 'פרטי', 'firstname', 'first name', 'fname', 'given name'],
  last_name: ['שם משפחה', 'משפחה', 'lastname', 'last name', 'surname', 'family name'],
  name: ['שם', 'שם מלא', 'שם איש קשר', 'איש קשר', 'name', 'full name', 'fullname', 'contact name', 'contact'],
  // 'phonenumber'/'emailaddress' cover snake_case exports (phone_number, email_address):
  // normHeader strips underscores, so the joined form is what actually gets compared.
  phone_number: ['טלפון', 'נייד', 'מספר נייד', 'טלפון נייד', 'פלאפון', 'פל', 'סלולרי', 'סלולארי', 'מספר טלפון', 'מספר', 'וואטסאפ', 'whatsapp', 'phone', 'mobile', 'cell', 'cellphone', 'tel', 'telephone', 'phone number', 'phonenumber', 'msisdn'],
  email: ['אימייל', 'מייל', 'דוא"ל', 'דואל', 'כתובת מייל', 'email', 'e-mail', 'mail', 'email address', 'emailaddress'],
  // ⚠️ ID-number headers must be recognized here: Israeli IDs are 9 digits, which
  // normalizePhone happily turns into +972XXXXXXXXX — so an unrecognized ת"ז column
  // gets content-detected as phone_number and steals the real phone column's slot.
  identifier: ['מזהה', 'מזהה חיצוני', 'תז', 'ת"ז', 'ת.ז', 'מספר תז', 'מס תז', 'מספר זהות', 'תעודת זהות', 'מספר תעודת זהות', 'id', 'identifier', 'external id', 'ref'],
  company_name: ['חברה', 'עסק', 'ארגון', 'שם חברה', 'company', 'company name', 'organization', 'organisation', 'business'],
  city: ['עיר', 'יישוב', 'ישוב', 'city', 'town'],
  country: ['מדינה', 'ארץ', 'country'],
};

function normHeader(h) {
  return String(h || '').toLowerCase().replace(/["'.\-_/\\]/g, '').replace(/\s+/g, ' ').trim();
}

// Filler words that CRM/insurance exports append to every header ("שם פרטי לקוח",
// "סלולרי לקוח") — dropped before synonym matching so the base synonym still hits.
const FILLER_WORDS = new Set(['לקוח', 'לקוחה', 'customer', 'client']);
function stripFiller(n) {
  return n.split(' ').filter((w) => !FILLER_WORDS.has(w)).join(' ');
}

function headerField(header) {
  const n = stripFiller(normHeader(header));
  if (!n) return null;
  // Exact match against normalized synonyms. When multiple synonyms of the
  // SAME field normalize to the same string, bestLen breaks the tie by choosing
  // the longer synonym (e.g., "שם משפחה" wins over "שם" if both are assigned to last_name).
  let best = null;
  let bestLen = 0;
  for (const field of Object.keys(SYNONYMS)) {
    for (const syn of SYNONYMS[field]) {
      const sn = normHeader(syn);
      if (n === sn && sn.length > bestLen) { best = field; bestLen = sn.length; }
    }
  }
  return best;
}

function contentField(values) {
  const nonEmpty = values.filter((v) => v && v.trim());
  if (!nonEmpty.length) return null;
  const emailish = nonEmpty.filter((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())).length;
  if (emailish / nonEmpty.length >= 0.6) return 'email';
  const phoneish = nonEmpty.filter((v) => normalizePhone(v) !== null).length;
  if (phoneish / nonEmpty.length >= 0.6) return 'phone_number';
  return null;
}

// Guard against a destructive mis-mapping (the "note column mapped to email" incident:
// email became the dedup key → bogus in-file-duplicate counts, then every create/update
// failed server-side validation). For each mapped email/phone_number column, check the
// actual values; if fewer than half of the non-empty values fit the field, block the
// import before anything (dedup, attribute/label creation) runs. Fields that accept
// arbitrary strings (name/identifier/…) are not validated.
const VALIDATORS = {
  email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()),
  phone_number: (v) => normalizePhone(v) !== null,
  phone_number_alt: (v) => normalizePhone(v) !== null,
};

export function validateMapping(headers, rows, mapping) {
  const blockers = [];
  for (const { index, field } of mapping) {
    const check = VALIDATORS[field];
    if (!check) continue;
    const values = rows.map((r) => r[index] || '').filter((v) => v.trim() !== '');
    if (!values.length) continue; // nothing to import from this column anyway
    const valid = values.filter(check).length;
    if (valid / values.length < 0.5) {
      blockers.push({ header: headers[index], field, valid, total: values.length });
    }
  }
  return blockers;
}

// A file pasted together from several lists carries each list's header line in the
// middle of the data, and such a line imports as a fake contact literally named
// "שם פרטי" (the מגדלי דוד incident). A row is a header echo when some mapped cell IS
// a field label — and nothing anywhere in the row is a usable phone or email.
const ALL_SYNONYMS = new Set(
  Object.values(SYNONYMS).flat().map((s) => normHeader(s)),
);
const EMAILISH = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isHeaderEchoRow(cells, mapping) {
  for (const raw of cells) {
    const v = String(raw ?? '').trim();
    if (v && (normalizePhone(v) || EMAILISH.test(v))) return false; // real data wins
  }
  return mapping.some(({ index, field }) => {
    if (!field) return false;
    const v = String(cells[index] ?? '').trim();
    return v !== '' && ALL_SYNONYMS.has(stripFiller(normHeader(v)));
  });
}

export function detectColumns(headers, sampleRows) {
  const taken = new Set();
  return headers.map((header, index) => {
    const col = sampleRows.map((r) => r[index]);
    let field = headerField(header);
    let confidence = field ? 0.9 : 0;
    if (!field) { field = contentField(col); confidence = field ? 0.7 : 0; }
    if (field && taken.has(field)) {
      // A second phone column ("נייד" next to "טלפון") is real data, not a duplicate:
      // CRM exports routinely fill one and leave the other empty, and dropping it
      // imports a contact with no phone at all — which every WhatsApp campaign then
      // skips in silence. Keep it as a fallback candidate. Other fields stay single.
      const isPhone = field === 'phone_number' || field === 'phone_number_alt';
      field = isPhone ? 'phone_number_alt' : null;
      confidence = isPhone ? 0.6 : 0;
    }
    // phone_number_alt is intentionally repeatable — never mark it taken.
    if (field && field !== 'phone_number_alt') taken.add(field);
    return { header, index, field, confidence };
  });
}
