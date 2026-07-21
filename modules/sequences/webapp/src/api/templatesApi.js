import { call } from './call.js';
import { API_BASE } from '../config.js';
import { getLocale } from '../i18n.js';

/**
 * List templates for an inbox.
 */
export async function listTemplates(accountId, inboxId) {
  return call('tpl_list', inboxId ? { inbox_id: inboxId } : {}, accountId);
}

/**
 * Create a template in an inbox.
 */
export async function createTemplate(accountId, inboxId, template) {
  return call('tpl_create', { inbox_id: inboxId, template }, accountId);
}

/**
 * Edit an existing template.
 */
export async function editTemplate(accountId, inboxId, templateId, changes) {
  return call('tpl_edit', { inbox_id: inboxId, template_id: templateId, changes }, accountId);
}

/**
 * Delete a template by name.
 */
export async function deleteTemplate(accountId, inboxId, name, hsmId) {
  const payload = { inbox_id: inboxId, name };
  if (hsmId) payload.hsm_id = hsmId;
  return call('tpl_delete', payload, accountId);
}

/**
 * List flows for an inbox.
 */
export async function listFlows(accountId, inboxId) {
  return call('tpl_flows', { inbox_id: inboxId }, accountId);
}

/**
 * The non-admin users an administrator granted Template Studio access to (ids only).
 */
export async function listTemplateAccess(accountId) {
  return call('tpl_access', {}, accountId);
}

/**
 * Replace the whole grant list (administrators only — the engine re-checks).
 */
export async function saveTemplateAccess(accountId, userIds) {
  return call('tpl_set_access', { user_ids: userIds }, accountId);
}

/**
 * The account's agents, straight from Chatwoot — the engine's DB role deliberately has no
 * read on public.users, and its own Chatwoot token is an AgentBot one that cannot list them.
 * The panel is same-origin with Chatwoot, so the browser's own session answers this.
 *
 * ponytail: needs the cw_d_session_info cookie, which the mobile WebView does not have
 * (see engine/src/auth.js) — granting access there falls back to the engine round-trip only
 * if we ever need it; managing grants is a desktop settings task.
 */
export async function listAccountAgents(accountId) {
  const raw = (document.cookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
  if (!raw) throw new Error('no-session');
  let d = JSON.parse(decodeURIComponent(raw));
  if (typeof d === 'string') d = JSON.parse(d);   // js-cookie sometimes wraps the JSON as a string
  const res = await fetch(`/api/v1/accounts/${encodeURIComponent(accountId)}/agents`, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'access-token': d['access-token'],
      'token-type': d['token-type'] || 'Bearer',
      client: d.client,
      expiry: d.expiry,
      uid: d.uid,
    },
  });
  if (!res.ok) throw new Error(`agents ${res.status}`);
  return res.json();
}

/**
 * Upload a template example file.
 */
export async function uploadExample(accountId, inboxId, file) {
  const url = `${API_BASE}/template-example?account_id=${encodeURIComponent(accountId)}&inbox_id=${encodeURIComponent(inboxId)}&locale=${getLocale()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'x-filename': encodeURIComponent(file.name || ''),
    },
    body: file,
  });

  const json = await res.json().catch(() => ({}));

  // Handle 403 Forbidden — mark with .forbidden for UI to show admin-only state
  if (res.status === 403) {
    const err = new Error(json.error || `Upload failed (${res.status})`);
    err.forbidden = true;
    throw err;
  }

  if (!res.ok || json.ok === false) throw new Error(json.error || `Upload failed (${res.status})`);
  return json.data; // { handle }
}
