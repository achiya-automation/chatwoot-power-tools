import { normalizePhone } from './phoneNormalizer.js';

export const SYSTEM_FIELDS = [
  'name', 'first_name', 'last_name', 'phone_number',
  'email', 'identifier', 'company_name', 'city', 'country',
];

// Lowercased synonym lists (Hebrew + English). Matched against a normalized
// header (lowercased, punctuation/whitespace stripped).
const SYNONYMS = {
  first_name: ['שם פרטי', 'פרטי', 'firstname', 'first name', 'fname', 'given name'],
  last_name: ['שם משפחה', 'משפחה', 'lastname', 'last name', 'surname', 'family name'],
  name: ['שם', 'שם מלא', 'שם איש קשר', 'איש קשר', 'name', 'full name', 'fullname', 'contact name', 'contact'],
  phone_number: ['טלפון', 'נייד', 'פלאפון', 'פל', 'מספר טלפון', 'מספר', 'וואטסאפ', 'whatsapp', 'phone', 'mobile', 'cell', 'cellphone', 'tel', 'telephone', 'phone number', 'msisdn'],
  email: ['אימייל', 'מייל', 'דוא"ל', 'דואל', 'כתובת מייל', 'email', 'e-mail', 'mail', 'email address'],
  identifier: ['מזהה', 'מזהה חיצוני', 'תז', 'ת"ז', 'ת.ז', 'id', 'identifier', 'external id', 'ref'],
  company_name: ['חברה', 'עסק', 'ארגון', 'שם חברה', 'company', 'company name', 'organization', 'organisation', 'business'],
  city: ['עיר', 'יישוב', 'ישוב', 'city', 'town'],
  country: ['מדינה', 'ארץ', 'country'],
};

function normHeader(h) {
  return String(h || '').toLowerCase().replace(/["'.\-_/\\]/g, '').replace(/\s+/g, ' ').trim();
}

function headerField(header) {
  const n = normHeader(header);
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

export function detectColumns(headers, sampleRows) {
  const taken = new Set();
  return headers.map((header, index) => {
    const col = sampleRows.map((r) => r[index]);
    let field = headerField(header);
    let confidence = field ? 0.9 : 0;
    if (!field) { field = contentField(col); confidence = field ? 0.7 : 0; }
    if (field && taken.has(field)) { field = null; confidence = 0; }
    if (field) taken.add(field);
    return { header, index, field, confidence };
  });
}
