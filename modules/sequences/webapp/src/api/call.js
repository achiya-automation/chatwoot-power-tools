import { API_BASE } from '../config.js';
import { translate } from '../i18n.js';

// Messages displayed to the user (thrown as Error and shown in App/SequenceEditor). Bilingual.
const M = {
  he: {
    missingAccount: 'חסר account_id',
    apiFailed: 'API {action} נכשל',
    apiFailedStatus: 'API {action} נכשל ({status})',
    uploadFailed: 'העלאה נכשלה ({status})',
  },
  en: {
    missingAccount: 'Missing account_id',
    apiFailed: 'API {action} failed',
    apiFailedStatus: 'API {action} failed ({status})',
    uploadFailed: 'Upload failed ({status})',
  },
};

/*
 * Shared API layer for drip-engine — speaks to the engine (drip-engine sidecar)
 * at the same origin via a single endpoint. (Previously an n8n webhook; now a
 * container within Chatwoot's stack.)
 *
 * Contract: POST `${API_BASE}?account_id=N` body: { action, payload }
 *   Responses vary by action, but all follow the shape: { ok, data, error? }
 */
export async function call(action, payload, accountId) {
  if (accountId == null) throw new Error(translate(M, 'missingAccount'));
  const url = `${API_BASE}?account_id=${encodeURIComponent(accountId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload: payload || {} }),
  });

  // Any failure status: the engine answers { ok:false, error } with the real reason —
  // Meta's rejection ("Content in This Language Already Exists"), a validation failure —
  // so read the body first and fall back to the bare status only when it has nothing.
  // Showing "API tpl_create נכשל (500)" while the actual reason sits in the body is how
  // a self-explanatory error turns into a log dig.
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    const err = new Error(json.error || translate(M, 'apiFailedStatus', { action, status: res.status }));
    // 403 stays marked so the UI can render its admin-only state rather than a plain error.
    if (res.status === 403) err.forbidden = true;
    throw err;
  }

  const json = await res.json();
  // json.error comes from the engine (already bilingual per ?locale=); fall back to localized string if absent.
  if (json && json.ok === false) throw new Error(json.error || translate(M, 'apiFailed', { action }));
  return json ? json.data : null;
}
