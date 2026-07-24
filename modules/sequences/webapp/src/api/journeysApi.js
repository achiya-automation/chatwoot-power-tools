import { call } from './call.js';

/*
 * journeysApi — thin client for the engine's Flow Builder actions (jrn_*).
 * Mirrors templatesApi.js: every function is call(action, payload, accountId)
 * and resolves to json.data.
 *
 * The second half talks to Chatwoot itself (same-origin, the admin's own
 * session) — the engine's bot token deliberately cannot list agents/teams or
 * create custom attribute definitions, but the iframe shares the dashboard
 * origin+session, so the browser can (same pattern as templatesApi.listAccountAgents).
 */

/** All journeys of the account (list rows: id, name, status, trigger, node_count, live_runs, done_runs, updated_at). */
export async function listJourneys(accountId) {
  return call('jrn_list', {}, accountId);
}

/** One journey in full (including graph) — the editor loads this. */
export async function getJourney(accountId, id) {
  return call('jrn_get', { id }, accountId);
}

/** Create (no id) or update (with id) a journey: { id?, name, trigger, graph, status? }. */
export async function saveJourney(accountId, journey) {
  return call('jrn_save', journey, accountId);
}

export async function deleteJourney(accountId, id) {
  return call('jrn_delete', { id }, accountId);
}

/** status: draft | active | paused (pausing also stops live runs — engine side). */
export async function setJourneyStatus(accountId, id, status) {
  return call('jrn_set_status', { id, status }, accountId);
}

/** Editor metadata from the engine: { inboxes: [{id, name, channel_type}] }. */
export async function getJourneyMeta(accountId) {
  return call('jrn_meta', {}, accountId);
}

/** Recent runs of a journey (latest 100). */
export async function listJourneyRuns(accountId, id) {
  return call('jrn_runs', { id }, accountId);
}

/** Manually start a journey on a conversation (agent-initiated). */
export async function launchJourney(accountId, id, displayId, contactId) {
  return call('jrn_launch', { id, display_id: displayId, contact_id: contactId }, accountId);
}

export async function stopJourneyRun(accountId, runId) {
  return call('jrn_stop_run', { run_id: runId }, accountId);
}

// ── Same-origin Chatwoot calls (the admin's own dashboard session) ──

// The dashboard stores its devise auth in the cw_d_session_info cookie; API v1
// wants those values as headers. Same parsing as templatesApi.listAccountAgents.
function cwSession() {
  const raw = (document.cookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
  if (!raw) return null;
  let d = JSON.parse(decodeURIComponent(raw));
  if (typeof d === 'string') d = JSON.parse(d); // js-cookie sometimes double-wraps
  return d;
}

async function cwFetch(path, { method = 'GET', body } = {}) {
  const d = cwSession();
  if (!d) throw new Error('no-session');
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'access-token': d['access-token'],
      'token-type': d['token-type'] || 'Bearer',
      client: d.client,
      expiry: d.expiry,
      uid: d.uid,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = new Error(`chatwoot ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json().catch(() => null);
}

// Chatwoot list endpoints are inconsistent: agents/teams return a bare array,
// labels returns { payload: [...] } — normalize both shapes.
const asList = (r) => (Array.isArray(r) ? r : (Array.isArray(r?.payload) ? r.payload : []));

/**
 * Agents / teams / labels for the editor's pickers. Best-effort by design:
 * any failure (no session, mobile WebView, permissions) yields empty lists —
 * the editor still works, the pickers just have nothing to suggest.
 */
export async function fetchChatwootMeta(accountId) {
  const get = (p) =>
    cwFetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/${p}`).then(asList).catch(() => []);
  const [agents, teams, labels] = await Promise.all([get('agents'), get('teams'), get('labels')]);
  return { agents, teams, labels };
}

/**
 * Best-effort creation of the custom attribute definition backing a saveTo key,
 * so the collected answer shows up nicely in Chatwoot's contact/conversation
 * sidebar. Failures are swallowed on purpose (409/422 = already exists,
 * 403 = agent without permission) — answers still save without the definition.
 * Returns true when the definition was created.
 */
export async function ensureAttributeDefinition(accountId, key, scope) {
  try {
    await cwFetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/custom_attribute_definitions`, {
      method: 'POST',
      body: {
        attribute_display_name: key,
        attribute_key: key,
        attribute_model: scope === 'conversation' ? 'conversation_attribute' : 'contact_attribute',
        attribute_display_type: 0, // text
      },
    });
    return true;
  } catch {
    return false;
  }
}
