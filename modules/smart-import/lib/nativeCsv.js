// The CSV that Chatwoot's own importer (Settings › Data › New import) receives in place of the
// file the user picked. Chatwoot reads name, email, identifier, phone_number and labels; every
// other value rides under a reserved "cwpt:" header that smart_import_server.rb moves to the
// right place before Chatwoot stores the row:
//   cwpt:company_name, cwpt:city, cwpt:country → additional_attributes
//   cwpt:custom:<key>                          → custom_attributes[key]
//   cwpt:row, cwpt:phone_raw                   → dropped (kept on the import item for the summary)
// Without the prefix a custom key such as "company" or "חברה" is claimed by the header synonyms
// in whatsapp_contact_naming.rb and lands in another field.
export const STANDARD_HEADERS = ['name', 'email', 'identifier', 'phone_number'];
const ADDITIONAL = ['company_name', 'city', 'country'];

function cell(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// contacts: buildContactPayload() results, each with __row (the row number in the picked file)
// and, when the file has a labels column, __labels (its comma-separated titles). `label` is
// the one label the whole import adds on top.
export function toNativeCsv(contacts, label = '') {
  const custom = [...new Set(contacts.flatMap((c) => Object.keys(c.custom_attributes || {})))];
  const additional = ADDITIONAL.filter((k) => contacts.some((c) => c.additional_attributes?.[k]));
  const hasRaw = contacts.some((c) => c.__phoneRaw);
  const hasLabels = Boolean(label) || contacts.some((c) => c.__labels);
  const headers = [
    ...STANDARD_HEADERS,
    ...additional.map((k) => `cwpt:${k}`),
    ...custom.map((k) => `cwpt:custom:${k}`),
    ...(hasLabels ? ['labels'] : []),
    'cwpt:row',
    ...(hasRaw ? ['cwpt:phone_raw'] : []),
  ];
  const lines = contacts.map((c) => [
    ...STANDARD_HEADERS.map((k) => c[k]),
    ...additional.map((k) => c.additional_attributes?.[k]),
    ...custom.map((k) => c.custom_attributes?.[k]),
    ...(hasLabels ? [[c.__labels, label].filter(Boolean).join(',')] : []),
    c.__row,
    ...(hasRaw ? [c.__phoneRaw] : []),
  ].map(cell).join(','));
  return [headers.map(cell).join(','), ...lines].join('\n') + '\n';
}
