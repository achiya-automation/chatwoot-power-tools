export class ApiError extends Error {
  constructor(status, body) { super(`API ${status}: ${body}`); this.status = status; this.body = body; }
}

// Reads Chatwoot's non-httpOnly session cookie and returns the 5 devise-token-auth
// headers. js-cookie sometimes double-encodes the JSON as a string — handle both.
export function getAuthHeaders(documentCookie) {
  const raw = (documentCookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
  if (!raw) return null;
  try {
    let d = JSON.parse(decodeURIComponent(raw));
    if (typeof d === 'string') d = JSON.parse(d);
    if (!d || !d['access-token']) return null;
    return {
      'access-token': d['access-token'],
      'token-type': d['token-type'],
      client: d.client,
      expiry: String(d.expiry),
      uid: d.uid,
    };
  } catch { return null; }
}

export function createApiClient(accountId, headers, fetchImpl = fetch) {
  const base = `/api/v1/accounts/${accountId}`;
  async function req(method, path, body) {
    const r = await fetchImpl(base + path, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new ApiError(r.status, await r.text());
    return r.status === 204 ? null : r.json();
  }
  return {
    filterContacts: (payload) => req('POST', '/contacts/filter', payload),
    createContact: (c) => req('POST', '/contacts', c),
    updateContact: (id, c) => req('PUT', `/contacts/${id}`, c),
    getContactLabels: (id) => req('GET', `/contacts/${id}/labels`),
    assignLabels: (id, labels) => req('POST', `/contacts/${id}/labels`, { labels }),
    listLabels: () => req('GET', '/labels'),
    // Chatwoot's LabelsController requires the attributes under `label`:
    // params.require(:label).permit(:title, ...).
    createLabel: (title) => req('POST', '/labels', { label: { title } }),
    listCustomAttributes: () => req('GET', '/custom_attribute_definitions?attribute_model=contact_attribute'),
    createCustomAttribute: (def) => req('POST', '/custom_attribute_definitions', { custom_attribute_definition: def }),
  };
}
