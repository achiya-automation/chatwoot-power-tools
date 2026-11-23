export class ApiError extends Error {
  constructor(status, body) { super(`API ${status}: ${body}`); this.status = status; this.body = body; }
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
    listLabels: () => req('GET', '/labels'),
    // Chatwoot's LabelsController requires the attributes under `label`:
    // params.require(:label).permit(:title, ...).
    createLabel: (title) => req('POST', '/labels', { label: { title } }),
    listCustomAttributes: () => req('GET', '/custom_attribute_definitions?attribute_model=contact_attribute'),
    createCustomAttribute: (def) => req('POST', '/custom_attribute_definitions', { custom_attribute_definition: def }),
    // smart_import_server.rb: counts against the account's contacts, no writes.
    smartImportPreview: (contacts) => req('POST', '/smart_import/preview', { contacts }),
    // smart_import_server.rb: the options Chatwoot's import of this exact file picks up.
    smartImportArm: (body) => req('POST', '/smart_import/arm', body),
  };
}
