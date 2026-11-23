// Stubs Chatwoot's API, the smart_import_server.rb routes and the session cookie, so the box
// runs offline. Serve the repo root over http and open /modules/smart-import/test-fixture/.
document.cookie = 'cw_d_session_info=' + encodeURIComponent(JSON.stringify({
  'access-token': 'TEST', client: 'C', uid: 'a@b.com', 'token-type': 'Bearer', expiry: '999',
}));
const store = {
  labels: [{ title: 'לקוחות' }],
  customAttrs: [],
  existing: new Set(['email:dana@acme.co.il']), // one contact the account already has
  armed: null,
};
const origFetch = window.fetch;
window.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const json = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => '' });
  if (/\/labels$/.test(url) && (!opts.method || opts.method === 'GET')) return json({ payload: store.labels });
  if (/\/labels$/.test(url)) {
    const created = { title: body.label.title };
    store.labels.push(created);
    return json(created);
  }
  if (/custom_attribute_definitions/.test(url) && opts.method === 'POST') {
    store.customAttrs.push(body.custom_attribute_definition);
    return json(body.custom_attribute_definition);
  }
  if (/custom_attribute_definitions/.test(url)) return json(store.customAttrs);
  if (/\/smart_import\/preview$/.test(url)) {
    // Same counting as SmartImportServer.preview_counts.
    const seen = new Set();
    const out = { total: body.contacts.length, new: 0, existing: 0, dup_in_file: 0, whatsapp: true };
    for (const c of body.contacts) {
      const keys = ['identifier', 'email', 'phone_number'].filter((k) => c[k]).map((k) => `${k}:${c[k]}`);
      if (keys.some((k) => store.existing.has(k))) out.existing++;
      else if (keys.some((k) => seen.has(k))) out.dup_in_file++;
      else out.new++;
      keys.forEach((k) => seen.add(k));
    }
    return json(out);
  }
  if (/\/smart_import\/arm$/.test(url)) { store.armed = body; return json({ ok: true }); }
  return origFetch ? origFetch(url, opts) : json({});
};
window.__store = store;
