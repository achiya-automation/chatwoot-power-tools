const KEYS = ['identifier', 'phone_number', 'email']; // priority order

function clause(key, value) {
  return { attribute_key: key, filter_operator: 'equal_to', values: [value], query_operator: null };
}

// OR-filter over whichever dedup keys the contact has. Chatwoot's FilterService
// normalizes phone_number to +<digits> on its side, so pass it as-is.
export function buildFilterPayload(contact) {
  const clauses = KEYS.filter((k) => contact[k] != null && contact[k] !== '').map((k) => clause(k, contact[k]));
  if (!clauses.length) return null;
  clauses.forEach((c, i) => { c.query_operator = i < clauses.length - 1 ? 'or' : null; });
  return { payload: clauses };
}

// Choose the best existing contact, by key priority. Returns null if none.
export function pickMatch(results, contact) {
  if (!results || !results.length) return null;
  for (const key of KEYS) {
    if (contact[key] == null || contact[key] === '') continue;
    const hit = results.find((r) => r[key] && String(r[key]) === String(contact[key]));
    if (hit) return hit;
  }
  return results[0]; // ambiguous: first match (logged by caller)
}
