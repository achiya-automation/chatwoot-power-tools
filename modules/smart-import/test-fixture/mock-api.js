// Stubs Chatwoot's API + session cookie so the wizard runs offline.
document.cookie = 'cw_d_session_info=' + encodeURIComponent(JSON.stringify({
  'access-token': 'TEST', client: 'C', uid: 'a@b.com', 'token-type': 'Bearer', expiry: '999',
}));
const store = { contacts: [], nextId: 1, labels: [{ title: 'לקוחות' }], customAttrs: [] };
const origFetch = window.fetch;
window.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : {};
  const json = (d) => ({ ok: true, status: 200, json: async () => d, text: async () => '' });
  if (/\/contacts\/filter/.test(url)) {
    const want = body.payload?.[0]?.values?.[0];
    return json({ payload: store.contacts.filter((c) => c.phone_number === want || c.email === want) });
  }
  if (/\/contacts$/.test(url) && opts.method === 'POST') { const c = { id: store.nextId++, ...body }; store.contacts.push(c); return json(c); }
  if (/\/contacts\/\d+$/.test(url) && opts.method === 'PUT') return json({ id: 1, ...body });
  if (/\/labels$/.test(url) && (!opts.method || opts.method === 'GET')) return json({ payload: store.labels });
  if (/\/labels$/.test(url)) { store.labels.push({ title: body.title }); return json(body); }
  if (/\/contacts\/\d+\/labels/.test(url)) return json({ payload: body.labels });
  if (/custom_attribute_definitions/.test(url) && opts.method === 'POST') { store.customAttrs.push(body); return json(body); }
  if (/custom_attribute_definitions/.test(url)) return json(store.customAttrs);
  return origFetch ? origFetch(url, opts) : json({});
};
window.__store = store;
