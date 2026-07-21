import { buildFilterPayload, pickMatch } from './dedup.js';
import { ImportLog } from './importLog.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Concurrent importer. Rows arrive with __match precomputed by batchDedup and run
// through a small worker pool — dedup → update or create → label, errors caught
// per row so the run never aborts midway. Rows marked __dupTail (in-file
// duplicates) run serially AFTER the pool with a fresh per-row filter, so they
// merge into the contact an earlier row just created instead of duplicating it.
// On HTTP 429 one shared cooldown pauses every worker, then the request retries.
export async function runImport({
  contacts, api, labelTitle, waInboxId = null, onProgress,
  concurrency = 5, isCancelled = () => false, cooldownMs = 20000, sleep = defaultSleep,
}) {
  const log = new ImportLog();
  const total = contacts.length;
  let done = 0;

  let cooldown = null; // one shared backoff at a time — all workers wait on it
  async function call(fn) {
    for (let attempt = 0; ; attempt++) {
      if (cooldown) await cooldown;
      try { return await fn(); }
      catch (e) {
        if (e?.status !== 429 || attempt >= 3) throw e;
        if (!cooldown) cooldown = sleep(cooldownMs * (attempt + 1)).then(() => { cooldown = null; });
      }
    }
  }

  async function importOne(c) {
    const row = c.__row;
    const name = c.name || '';
    const filter = buildFilterPayload(c);
    if (!name && !filter) {
      log.add(row, name, 'skipped', null, 'אין שם או מזהה ייחודי');
      onProgress?.(++done, total, log);
      return;
    }
    const body = stripMeta(c);
    try {
      let contactId = null;
      let status = 'created';
      let match = null;
      if ('__match' in c) {
        // Precomputed by the preview step — skip the API filter call
        match = c.__match;
      } else if (filter) {
        const res = await call(() => api.filterContacts(filter));
        match = pickMatch(res?.payload || [], c);
      }
      if (match) {
        await call(() => api.updateContact(match.id, body));
        contactId = match.id; status = 'updated';
      } else {
        const created = await call(() => api.createContact(body));
        // Chatwoot wraps a newly-created contact as
        // `{ payload: { contact: { id, ... } } }`. Older tests used a flat
        // `{ id }` response, which hid this production-only mismatch and made
        // label assignment silently skip every newly-created contact.
        contactId = created?.payload?.contact?.id ?? created?.id;
        if (!contactId) throw new Error('Chatwoot create response is missing the contact id');
        status = 'created';
      }
      // Link the contact to the WhatsApp inbox so the conversation Chatwoot opens
      // later resolves to THIS contact — with its real name — instead of a nameless
      // auto-created twin. Best-effort: a contact that is already linked (source_id is
      // unique per inbox) or an older Chatwoot without the route must never fail the row.
      if (waInboxId && contactId) {
        const sourceId = waSourceId(body.phone_number);
        if (sourceId) {
          try { await call(() => api.createContactInbox(contactId, { inbox_id: waInboxId, source_id: sourceId })); }
          catch { /* already linked, or unsupported — the contact itself imported fine */ }
        }
      }
      if (labelTitle && contactId) {
        if (match) {
          let cur = [];
          try { cur = (await call(() => api.getContactLabels(contactId)))?.payload || []; } catch { /* treat as empty */ }
          const union = Array.from(new Set([...cur, labelTitle]));
          await call(() => api.assignLabels(contactId, union));
        } else {
          await call(() => api.assignLabels(contactId, [labelTitle]));
        }
      }
      log.add(row, name, status, contactId, '');
    } catch (e) {
      log.add(row, name, 'failed', null, (e.body || e.message || 'error').slice(0, 200));
    }
    onProgress?.(++done, total, log);
  }

  const poolRows = contacts.filter((c) => !c.__dupTail);
  const tailRows = contacts.filter((c) => c.__dupTail);

  let next = 0; // shared cursor — each worker claims the next row synchronously
  const workers = Array.from({ length: Math.min(concurrency, poolRows.length) }, async () => {
    while (next < poolRows.length && !isCancelled()) {
      await importOne(poolRows[next++]);
    }
  });
  await Promise.all(workers);

  for (const c of tailRows) {
    if (isCancelled()) break;
    delete c.__match; // force a fresh filter — an earlier row may have just created the twin
    await importOne(c);
  }
  return log;
}

// Detached background job around runImport: a live progress object, cancel(), and
// an onUpdate subscriber list. The wizard closes its dialog right after starting
// one and hands it to the floating pill (ui/wizard.js). Never rejects — a fatal
// error parks the job in state 'error' for the pill to display.
export function createImportJob({ contacts, api, labelTitle, waInboxId, concurrency }) {
  const listeners = new Set();
  const progress = {
    done: 0, total: contacts.length,
    created: 0, updated: 0, skipped: 0, failed: 0,
    state: 'running', // running → cancelling → done | cancelled | error
  };
  let cancelled = false;
  const emit = () => listeners.forEach((cb) => { try { cb(progress); } catch { /* a bad listener must not kill the job */ } });
  const job = {
    progress,
    log: null,
    error: null,
    labelTitle: labelTitle || '',
    cancel() { if (progress.state === 'running') { cancelled = true; progress.state = 'cancelling'; emit(); } },
    onUpdate(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
  job.promise = runImport({
    contacts, api, labelTitle, waInboxId, concurrency,
    isCancelled: () => cancelled,
    onProgress(done, totalCount, log) {
      progress.done = done;
      progress.total = totalCount;
      const s = log.summary();
      progress.created = s.created; progress.updated = s.updated;
      progress.skipped = s.skipped; progress.failed = s.failed;
      emit();
    },
  }).then((log) => {
    job.log = log;
    progress.state = cancelled && progress.done < progress.total ? 'cancelled' : 'done';
    emit();
    return log;
  }).catch((e) => {
    job.error = e;
    progress.state = 'error';
    emit();
    return job.log;
  });
  return job;
}

function stripMeta(c) {
  const { __row, __match, __dupTail, ...rest } = c;
  return rest;
}

// WhatsApp addresses a contact by bare digits (972501234567) while imported phones are
// E.164 ("+972501234567") — strip to digits so Chatwoot's channel lookup matches.
function waSourceId(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits || null;
}
