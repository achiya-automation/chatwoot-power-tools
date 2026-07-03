import { normalizePhone } from './phoneNormalizer.js';

const TOP_LEVEL = new Set(['name', 'email', 'identifier']);
const ADDITIONAL = new Set(['company_name', 'city', 'country']);

// Builds a Chatwoot contact payload from one row. Empty values are skipped so
// they never overwrite existing data on update (merge semantics).
export function buildContactPayload(row, mapping, customMap) {
  const payload = { additional_attributes: {}, custom_attributes: {} };
  let first = '';
  let last = '';
  for (const { index, field } of mapping) {
    const val = (row[index] || '').trim();
    if (!val || !field) continue;
    if (field === 'first_name') first = val;
    else if (field === 'last_name') last = val;
    else if (field === 'phone_number') {
      const p = normalizePhone(val);
      if (p) payload.phone_number = p;
    } else if (TOP_LEVEL.has(field)) payload[field] = val;
    else if (ADDITIONAL.has(field)) payload.additional_attributes[field] = val;
  }
  if (!payload.name && (first || last)) payload.name = [first, last].filter(Boolean).join(' ');
  for (const { index, attribute_key } of customMap || []) {
    const val = (row[index] || '').trim();
    if (val && attribute_key) payload.custom_attributes[attribute_key] = val;
  }
  if (!Object.keys(payload.additional_attributes).length) delete payload.additional_attributes;
  if (!Object.keys(payload.custom_attributes).length) delete payload.custom_attributes;
  return payload;
}
