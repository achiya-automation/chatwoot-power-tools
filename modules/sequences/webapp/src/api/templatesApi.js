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
