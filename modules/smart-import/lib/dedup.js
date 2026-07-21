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

// Mirror Contacts::FilterService#filter_values comparison semantics: string values
// are downcased before the SQL equality — except phone_number, which is compared
// verbatim as +<digits>. Matching the server here lets batch results map back to rows.
function normVal(key, value) {
  return key === 'phone_number' ? String(value) : String(value).toLowerCase();
}

const CHUNK = 40;     // OR clauses per filter call (the server reads values[0] per clause — no IN batching)
const MAX_PAGES = 40; // filter results come 15/page; hard stop against a runaway loop

// Batch dedup: one OR-of-equalities filter call per CHUNK distinct values instead of
// one call per row, walking result pages. Sets c.__match on every contact.
// A row whose dedup key repeats an earlier unmatched row gets c.__dupTail=true and no
// __match — the runner imports those serially at the end with a fresh per-row filter,
// so they merge into the contact the earlier row just created instead of duplicating it.
export async function batchDedup(contacts, api, onProgress) {
  const wanted = {}; // key → Set of normalized values present in the file
  const found = {};  // key → Map normValue → existing contact (first wins, like page order)
  for (const k of KEYS) { wanted[k] = new Set(); found[k] = new Map(); }
  for (const c of contacts) {
    for (const k of KEYS) if (c[k] != null && c[k] !== '') wanted[k].add(normVal(k, c[k]));
  }

  const totalValues = KEYS.reduce((s, k) => s + wanted[k].size, 0);
  let processed = 0;
  for (const k of KEYS) {
    const values = Array.from(wanted[k]);
    for (let o = 0; o < values.length; o += CHUNK) {
      const chunk = values.slice(o, o + CHUNK);
      const clauses = chunk.map((v, i) => ({
        attribute_key: k, filter_operator: 'equal_to', values: [v],
        query_operator: i < chunk.length - 1 ? 'or' : null,
      }));
      let page = 1;
      let got = 0;
      let count = Infinity;
      while (got < count && page <= MAX_PAGES) {
        const res = await api.filterContacts({ payload: clauses }, page);
        const arr = res?.payload || [];
        count = res?.meta?.count ?? arr.length;
        got += arr.length;
        for (const r of arr) {
          if (r[k] == null || r[k] === '') continue;
          const nv = normVal(k, r[k]);
          if (!found[k].has(nv)) found[k].set(nv, r);
        }
        if (!arr.length) break;
        page++;
      }
      processed += chunk.length;
      onProgress?.(Math.min(processed, totalValues), totalValues);
    }
  }

  // Assign matches by key priority; mark in-file duplicates for the serial tail.
  const claimed = new Set(); // key:value pairs taken by an earlier row that will CREATE
  for (const c of contacts) {
    delete c.__dupTail;
    let match = null;
    for (const k of KEYS) {
      if (c[k] == null || c[k] === '') continue;
      const m = found[k].get(normVal(k, c[k]));
      if (m) { match = m; break; }
    }
    if (match) { c.__match = match; continue; }
    const ids = KEYS.filter((k) => c[k] != null && c[k] !== '').map((k) => k + ':' + normVal(k, c[k]));
    if (ids.some((id) => claimed.has(id))) {
      delete c.__match;
      c.__dupTail = true;
    } else {
      c.__match = null;
      ids.forEach((id) => claimed.add(id));
    }
  }
  return contacts;
}
