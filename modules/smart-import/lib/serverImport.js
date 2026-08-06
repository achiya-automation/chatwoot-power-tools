import { ImportLog } from './importLog.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Meta fields ride under explicit names so the server never needs to know the wizard's
// __row/__phoneRaw internals; __match/__dupTail are preview-only state and stay home.
export function wireRow(c) {
  const { __row, __match, __dupTail, __phoneRaw, ...rest } = c;
  const out = { ...rest, row_num: __row };
  if (__phoneRaw) out.phone_raw = __phoneRaw;
  return out;
}

// Server-side import job with the same surface createImportJob (importRunner.js) exposes,
// so the pill in ui/wizard.js renders either kind without knowing which one it holds:
// { progress, log, error, labelTitle, serverMode, emailTo, cancel(), onUpdate(), promise }.
// Polls the status endpoint until a terminal state. A burst of failed polls is tolerated —
// a Rails restart mid-poll must not kill the pill while the job itself keeps running —
// but a 404 means the server does not know this job (expired / other server): terminal.
export function createServerJob({
  api, jobId, total, email, labelTitle,
  pollMs = 2500, maxErrors = 10, sleep = defaultSleep,
}) {
  const listeners = new Set();
  const progress = {
    done: 0, total,
    created: 0, updated: 0, skipped: 0, failed: 0,
    state: 'running', // running → cancelling → done | cancelled | error
  };
  const emit = () => listeners.forEach((cb) => { try { cb(progress); } catch { /* a bad listener must not kill the poll */ } });
  const job = {
    progress,
    log: null,
    error: null,
    labelTitle: labelTitle || '',
    serverMode: true,
    emailTo: email || null,
    cancel() {
      if (progress.state !== 'running') return;
      progress.state = 'cancelling';
      emit();
      // Best-effort: the job notices the flag on its next progress tick.
      api.smartImportCancel(jobId).catch(() => { /* stale poll still resolves the state */ });
    },
    onUpdate(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };

  job.promise = (async () => {
    let errors = 0;
    for (;;) {
      await sleep(pollMs);
      let s;
      try {
        s = await api.smartImportStatus(jobId);
        errors = 0;
      } catch (e) {
        if (e?.status === 404 || ++errors >= maxErrors) {
          job.error = e;
          progress.state = 'error';
          emit();
          return job.log;
        }
        continue;
      }
      progress.done = s.done || 0;
      progress.total = s.total ?? total;
      progress.created = s.created || 0;
      progress.updated = s.updated || 0;
      progress.skipped = s.skipped || 0;
      progress.failed = s.failed || 0;
      if (s.email) job.emailTo = s.email;
      if (s.state === 'done' || s.state === 'cancelled' || s.state === 'error') {
        job.log = toImportLog(s.log);
        if (s.state === 'error') job.error = new Error(s.error || 'import failed');
        progress.state = s.state;
        emit();
        return job.log;
      }
      // 'queued' renders as running; a locally-requested cancel keeps showing 'cancelling'
      // until the server confirms.
      if (progress.state !== 'cancelling') progress.state = 'running';
      emit();
    }
  })();

  return job;
}

function toImportLog(rows) {
  const log = new ImportLog();
  (rows || []).forEach((r) => log.add(r.row, r.name, r.status, r.contact_id, r.reason));
  return log;
}
