import { buildFilterPayload, pickMatch } from './dedup.js';
import { ImportLog } from './importLog.js';

const THROTTLE_MS = 120; // ~8 req/s, safely under Chatwoot rate limits

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs the import one contact at a time: dedup → update or create → label.
// Errors are caught per-row so the run never aborts midway.
export async function runImport({ contacts, api, labelTitle, onProgress, sleep = defaultSleep }) {
  const log = new ImportLog();
  let done = 0;
  for (const c of contacts) {
    const row = c.__row;
    const name = c.name || '';
    const filter = buildFilterPayload(c);
    if (!name && !filter) {
      log.add(row, name, 'skipped', null, 'אין שם או מזהה ייחודי');
      onProgress?.(++done, contacts.length);
      continue;
    }
    const body = stripMeta(c);
    try {
      let contactId = null;
      let status = 'created';
      let match = null;
      if ('__match' in c) {
        // Precomputed by preview step — skip the API filter call
        match = c.__match;
      } else if (filter) {
        const res = await api.filterContacts(filter);
        match = pickMatch(res?.payload || [], c);
      }
      if (match) {
        await api.updateContact(match.id, body);
        contactId = match.id; status = 'updated';
      } else {
        const created = await api.createContact(body);
        // Chatwoot wraps a newly-created contact as
        // `{ payload: { contact: { id, ... } } }`. Older tests used a flat
        // `{ id }` response, which hid this production-only mismatch and made
        // label assignment silently skip every newly-created contact.
        contactId = created?.payload?.contact?.id ?? created?.id;
        if (!contactId) throw new Error('Chatwoot create response is missing the contact id');
        status = 'created';
      }
      if (labelTitle && contactId) {
        if (match) {
          let cur = [];
          try { cur = (await api.getContactLabels(contactId))?.payload || []; } catch { /* treat as empty */ }
          const union = Array.from(new Set([...cur, labelTitle]));
          await api.assignLabels(contactId, union);
        } else {
          await api.assignLabels(contactId, [labelTitle]);
        }
      }
      log.add(row, name, status, contactId, '');
    } catch (e) {
      log.add(row, name, 'failed', null, (e.body || e.message || 'error').slice(0, 200));
    }
    onProgress?.(++done, contacts.length);
    await sleep(THROTTLE_MS);
  }
  return log;
}

function stripMeta(c) {
  const { __row, __match, ...rest } = c;
  return rest;
}
