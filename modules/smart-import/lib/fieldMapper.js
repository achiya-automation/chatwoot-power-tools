import { normalizePhone } from './phoneNormalizer.js';

const TOP_LEVEL = new Set(['name', 'email', 'identifier']);
const ADDITIONAL = new Set(['company_name', 'city', 'country']);

// Builds a Chatwoot contact payload from one row. Empty values are skipped so
// they never overwrite existing data on update (merge semantics).
export function buildContactPayload(row, mapping, customMap) {
  const payload = { additional_attributes: {}, custom_attributes: {} };
  let first = '';
  let last = '';
  const phones = []; // the mapped phone column first, then every fallback column
  for (const { index, field } of mapping) {
    const val = (row[index] || '').trim();
    if (!val || !field) continue;
    if (field === 'first_name') first = val;
    else if (field === 'last_name') last = val;
    else if (field === 'phone_number') phones.unshift(val);
    else if (field === 'phone_number_alt') phones.push(val);
    else if (TOP_LEVEL.has(field)) payload[field] = val;
    else if (ADDITIONAL.has(field)) payload.additional_attributes[field] = val;
  }
  for (const raw of phones) {
    const p = normalizePhone(raw);
    if (p) { payload.phone_number = p; break; }
  }
  // Nothing normalized but the file did carry a number: keep the raw value so the
  // preview can tell "no phone in the file" apart from "a phone that isn't valid" —
  // two different problems, and only the second one is a fixable typo.
  if (!payload.phone_number && phones.length) payload.__phoneRaw = phones[0];
  if (!payload.name && (first || last)) payload.name = [first, last].filter(Boolean).join(' ');
  for (const { index, attribute_key } of customMap || []) {
    const val = (row[index] || '').trim();
    if (val && attribute_key) payload.custom_attributes[attribute_key] = val;
  }
  if (!Object.keys(payload.additional_attributes).length) delete payload.additional_attributes;
  if (!Object.keys(payload.custom_attributes).length) delete payload.custom_attributes;
  return payload;
}
