// The smart import inside Chatwoot's own New import dialog (Settings › Data › New import).
// Chatwoot keeps the upload, the progress, the history and the rejected-rows file; this module
// sits between the file the user picks and the file Chatwoot uploads:
//   take()   reads the picked CSV or Excel file, opens the mapping / label / pre-check box
//            under Chatwoot's file row, and hands Chatwoot a CSV in its own format
//            (lib/nativeCsv.js) in place of the original;
//   submit() runs on Import: creates the new custom fields and the new label, rebuilds that
//            CSV, arms the server for exactly those bytes (smart_import_server.rb: WhatsApp
//            inbox links and the email summary), then lets Chatwoot's own submit run.
// A file it cannot read goes to Chatwoot untouched, so the dialog never loses a file.
import { readFileToTable } from '../lib/xlsxReader.js';
import { detectColumns, validateMapping, isHeaderEchoRow, matchCustomField } from '../lib/columnDetector.js';
import { buildContactPayload } from '../lib/fieldMapper.js';
import { normalizePhone } from '../lib/phoneNormalizer.js';
import { normalizeLabelTitle, isValidLabelTitle } from '../lib/labelTitle.js';
import { toNativeCsv } from '../lib/nativeCsv.js';
import { createApiClient } from '../lib/apiClient.js';
import { vendorUrl } from '../lib/basepath.js';
import { STYLES } from './styles.js';

const MAX_BYTES = 50 * 1024 * 1024; // NewImportDialog.vue MAX_FILE_BYTES
const PRECHECK_MAX = 25000; // smart_import_server.rb MAX_ROWS
const OWN = '__cwiOwn'; // marks the events this module dispatches; inject/import-button.js lets them through
const FIELD_ORDER = ['first_name', 'last_name', 'name', 'phone_number', 'phone_number_alt', 'email',
  'company_name', 'city', 'country', 'identifier', 'labels'];
const IDENTITY = new Set(['name', 'first_name', 'last_name', 'phone_number', 'phone_number_alt', 'email', 'identifier']);

const I18N = {
  he: {
    fields: { name: 'שם מלא', first_name: 'שם פרטי', last_name: 'שם משפחה', phone_number: 'טלפון',
      phone_number_alt: 'טלפון נוסף (גיבוי)', email: 'אימייל', identifier: 'מזהה', company_name: 'חברה',
      city: 'עיר', country: 'מדינה', labels: 'תוויות (מהקובץ)' },
    mapTitle: 'מיפוי עמודות',
    mapHint: 'זיהינו את העמודות לבד. אפשר לשנות כל אחת.',
    colFile: 'עמודה בקובץ', colSample: 'דוגמה', colField: 'שדה ב-Chatwoot', detected: 'זוהה',
    ignore: '— התעלם —', systemFields: 'שדות מערכת', customFields: 'שדות מותאמים',
    newFieldOpt: (n) => `${n} (שדה חדש)`,
    createField: 'צור שדה מותאם חדש…', newFieldName: 'שם השדה החדש',
    add: 'הוספה', cancel: 'ביטול',
    selectFieldFor: (h) => `השדה לעמודה ${h}`,
    labelTitle: 'תווית לכל אנשי הקשר בייבוא', noLabel: '— ללא תווית —',
    newLabelOpt: (t) => `תווית חדשה: ${t}`,
    otherLabel: 'תווית חדשה בשם אחר…', newLabelName: 'שם התווית החדשה',
    labelHint: 'מתווספת לתוויות שכבר יש להם, ולא מוחקת אותן.',
    monthLabel: (month) => `ייבוא-${month}`,
    checkTitle: 'בדיקה לפני ייבוא',
    statNew: 'חדשים', statExisting: 'קיימים, יעודכנו', statDup: 'כפולים בקובץ, ימוזגו', statNoPhone: 'בלי מספר תקין',
    checking: 'בודקים…',
    phoneFormat: (s) => `מספרים כמו ${s} נשמרים בפורמט בינלאומי.`,
    waLinked: 'מי שיש לו מספר מחובר לתיבת הוואטסאפ.',
    noPhoneNote: (n) => (n === 1 ? 'איש הקשר בלי מספר תקין ייווצר, אבל לא יקבל הודעות.'
      : 'אנשי הקשר בלי מספר תקין ייווצרו, אבל לא יקבלו הודעות.'),
    precheckFailed: 'הבדיקה המוקדמת לא זמינה כרגע. הייבוא עצמו יבדוק כל שורה.',
    precheckTooBig: (max) => `בקובץ גדול מ־${max} שורות הבדיקה מול אנשי הקשר הקיימים נעשית בזמן הייבוא.`,
    headerEcho: (rows) => `שורות כותרת בתוך הקובץ דולגו (שורות ${rows}). נראה שכמה רשימות הודבקו יחד.`,
    emptyRows: (n) => (n === 1 ? 'שורה אחת בלי שם, טלפון, אימייל או מזהה לא תיובא.'
      : `${n} שורות בלי שם, טלפון, אימייל או מזהה לא ייובאו.`),
    emailSummary: 'לשלוח לי סיכום במייל בסיום, עם הדוח המלא',
    needIdentity: 'בחרו לפחות עמודה אחת של שם, טלפון, אימייל או מזהה.',
    badMapping: (h, bad, total, field) => `בעמודה «${h}» ${bad} מתוך ${total} הערכים לא נראים כמו ${field}. בחרו לה שדה אחר, או «התעלם».`,
    labelNameInvalid: 'שם התווית צריך להתחיל באות או במספר, ולהכיל לפחות שני תווים.',
    fieldNameMissing: 'כתבו שם לשדה החדש.',
    labelCreateFailed: 'לא הצלחנו ליצור את התווית. נסו שוב.',
    fieldCreateFailed: (n) => `לא הצלחנו ליצור את השדה «${n}». נסו שוב.`,
    armFailed: 'לא הצלחנו להכין את הייבוא. נסו שוב בעוד רגע.',
    preparing: 'מכינים את הקובץ…',
    rows: (n) => (n === 1 ? 'שורה אחת' : `${n.toLocaleString('he')} שורות`),
  },
  en: {
    fields: { name: 'Full name', first_name: 'First name', last_name: 'Last name', phone_number: 'Phone',
      phone_number_alt: 'Additional phone (fallback)', email: 'Email', identifier: 'Identifier', company_name: 'Company',
      city: 'City', country: 'Country', labels: 'Labels (from the file)' },
    mapTitle: 'Map columns',
    mapHint: 'We matched the columns for you. You can change any of them.',
    colFile: 'Column in the file', colSample: 'Example', colField: 'Chatwoot field', detected: 'Matched',
    ignore: '— Ignore —', systemFields: 'System fields', customFields: 'Custom fields',
    newFieldOpt: (n) => `${n} (new field)`,
    createField: 'Create a new custom field…', newFieldName: 'New field name',
    add: 'Add', cancel: 'Cancel',
    selectFieldFor: (h) => `Field for column ${h}`,
    labelTitle: 'Label for every contact in this import', noLabel: '— No label —',
    newLabelOpt: (t) => `New label: ${t}`,
    otherLabel: 'New label with another name…', newLabelName: 'New label name',
    labelHint: 'Added next to the labels they already have. Nothing is removed.',
    monthLabel: (month) => `import-${month.toLowerCase()}`,
    checkTitle: 'Check before importing',
    statNew: 'New', statExisting: 'Existing, will be updated', statDup: 'Duplicates in the file, merged', statNoPhone: 'No valid number',
    checking: 'Checking…',
    phoneFormat: (s) => `Numbers like ${s} are saved in international format.`,
    waLinked: 'Contacts with a number are linked to the WhatsApp inbox.',
    noPhoneNote: (n) => (n === 1 ? 'The contact without a valid number is created, but will not receive messages.'
      : 'Contacts without a valid number are created, but will not receive messages.'),
    precheckFailed: 'The check is not available right now. The import checks every row itself.',
    precheckTooBig: (max) => `For files over ${max} rows, matching against existing contacts happens during the import.`,
    headerEcho: (rows) => `Header rows inside the file were skipped (rows ${rows}). It looks like several lists were pasted together.`,
    emptyRows: (n) => (n === 1 ? 'One row without a name, phone, email or identifier will not be imported.'
      : `${n} rows without a name, phone, email or identifier will not be imported.`),
    emailSummary: 'Email me a summary when it finishes, with the full report',
    needIdentity: 'Choose at least one column for name, phone, email or identifier.',
    badMapping: (h, bad, total, field) => `In column “${h}”, ${bad} of ${total} values do not look like ${field}. Choose another field for it, or “Ignore”.`,
    labelNameInvalid: 'A label name starts with a letter or a number and has at least two characters.',
    fieldNameMissing: 'Type a name for the new field.',
    labelCreateFailed: 'We could not create the label. Try again.',
    fieldCreateFailed: (n) => `We could not create the field “${n}”. Try again.`,
    armFailed: 'We could not prepare the import. Try again in a moment.',
    preparing: 'Preparing the file…',
    rows: (n) => (n === 1 ? '1 row' : `${n.toLocaleString('en')} rows`),
  },
};

class Notice extends Error {}

let token = 0; // the latest take() wins
let cur = null; // the open box

function locale() {
  const a = document.querySelector('#app[dir]');
  return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
}

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (typeof v === 'boolean') el[k] = v;
    else el.setAttribute(k === 'className' ? 'class' : k, v);
  }
  el.append(...kids.flat().filter((kid) => kid != null && kid !== false));
  return el;
}

function fire(el, type) {
  const e = new Event(type, { bubbles: true });
  e[OWN] = true;
  el.dispatchEvent(e);
}

function setFiles(input, file) {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  } catch {
    // ponytail: no DataTransfer (jsdom); every supported browser has it
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  }
}

// Hands the original file to Chatwoot exactly as if this module did not exist.
function passThrough(input, file) {
  if (!input.isConnected) return;
  setFiles(input, file);
  fire(input, 'change');
}

let xlsxLoading = null;
function loadXlsx(assetBase) {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = vendorUrl(assetBase);
      const failed = () => { s.remove(); xlsxLoading = null; reject(new Error('SheetJS load failed')); };
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : failed());
      s.onerror = failed;
      document.head.appendChild(s);
    });
  }
  return xlsxLoading;
}

function injectStyles() {
  if (document.getElementById('cwi-styles')) return;
  document.head.appendChild(h('style', { id: 'cwi-styles' }, STYLES));
}

const asList = (r) => (Array.isArray(r) ? r : r?.payload || []);
const labelTitles = (r) => asList(r).map((l) => l?.title).filter(Boolean);
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9֐-׿]+/g, '_').replace(/^_|_$/g, '') || 'field';
const isolate = (s) => `⁦${s}⁩`;

// shared/helpers/FileHelper.js formatBytes, so the row reads like Chatwoot's own
function formatBytes(bytes) {
  if (!bytes) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${['Bytes', 'KB', 'MB', 'GB'][i]}`;
}

async function digest(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function take(input, file, ctx) {
  const my = ++token;
  drop();
  try {
    if (!file || !file.size || file.size > MAX_BYTES || !/\.(csv|xlsx|xls)$/i.test(file.name || '')) {
      passThrough(input, file);
      return;
    }
    const api = createApiClient(ctx.accountId, ctx.authHeaders);
    const [table, defs, labels] = await Promise.all([
      readFileToTable(file, { loadXlsx: () => loadXlsx(ctx.assetBase) }),
      api.listCustomAttributes().then(asList).catch(() => []),
      api.listLabels().then(labelTitles).catch(() => []),
    ]);
    if (my !== token) return;
    const { headers, rows } = table;
    // Chatwoot's own rejected-rows file goes back the way it came out.
    if (!headers.some((x) => String(x).trim()) || !rows.length || headers.includes('__chatwoot_csv_format')) {
      passThrough(input, file);
      return;
    }
    mount(input, file, api, { headers, rows, defs, labels });
  } catch {
    if (my !== token) return;
    drop();
    passThrough(input, file);
  }
}

export function submit(form) {
  const s = cur;
  if (!s || s.bypass || !form.contains(s.input)) return false;
  if (!s.busy) run(s, form);
  return true;
}

function drop() {
  const s = cur;
  if (!s) return;
  cur = null;
  clearTimeout(s.preTimer);
  s.observer.disconnect();
  s.box.remove();
}

function mount(input, file, api, { headers, rows, defs, labels }) {
  injectStyles();
  const loc = locale();
  const T = I18N[loc];
  const detected = detectColumns(headers, rows.slice(0, 50));
  // A custom field the user defined under the column's name is the one they meant (a "חברה"
  // column into company_name once left a campaign's {{contact.custom_attribute['חברה']}} empty).
  const values = detected.map((d) => {
    const key = matchCustomField(d.header, defs);
    return key ? `custom:${key}` : d.field || '';
  });
  const month = new Intl.DateTimeFormat(loc, { month: 'long' }).format(new Date());
  const monthLabel = normalizeLabelTitle(T.monthLabel(month));
  const existing = labels.find((t) => t.toLowerCase() === monthLabel.toLowerCase());
  const s = {
    input, file, api, T, locale: loc, headers, rows, defs, labels, values,
    detected: values.map(Boolean),
    zone: input.parentElement,
    label: existing ? `label:${existing}` : `new:${monthLabel}`,
    // Only a label that already exists rides in the first CSV: if Import ever reached Chatwoot
    // without run(), a label created later would fail every row as "Unknown labels".
    monthLabel, labelTitle: existing || '', selects: [], busy: false, bypass: false, mounted: false,
    pre: null, preToken: 0, preTimer: null,
  };
  cur = s;
  s.box = render(s);
  s.zone.after(s.box);
  s.observer = new MutationObserver(() => watch(s));
  s.observer.observe(input.form || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  feed(s);
  setTimeout(() => { s.mounted = cur === s && patchFileRow(s); });
  precheck(s);
}

// Chatwoot removed its file (×, another source, the dialog closed): the box goes with it.
function watch(s) {
  if (cur !== s || !s.mounted) return;
  if (!s.zone.isConnected || !s.zone.querySelector('span.truncate')) {
    drop();
    return;
  }
  syncDisabled(s);
  patchFileRow(s);
}

// Writes only on a change: the observer sees every attribute write, even of the same value.
function syncDisabled(s) {
  const disabled = s.busy || s.input.disabled;
  if (s.fieldset.disabled !== disabled) s.fieldset.disabled = disabled;
}

// Chatwoot's file row shows the CSV it holds; the user should see the file they picked.
function patchFileRow(s) {
  const name = s.zone.querySelector('span.truncate');
  if (!name) return false;
  if (name.textContent !== s.file.name) name.textContent = s.file.name;
  const size = name.nextElementSibling;
  const text = `${s.T.rows(s.rows.length)} · ${isolate(formatBytes(s.file.size))}`;
  if (size && size.textContent !== text) size.textContent = text;
  return true;
}

function plan(s) {
  const mapping = [];
  const customMap = [];
  let labelsAt = -1;
  s.values.forEach((v, index) => {
    if (!v) return;
    if (v === 'labels') labelsAt = index;
    else if (v.startsWith('custom:')) customMap.push({ index, attribute_key: v.slice(7) });
    else if (v.startsWith('new:')) customMap.push({ index, attribute_key: slugify(v.slice(4)) });
    else mapping.push({ index, field: v });
  });
  return { mapping, customMap, labelsAt };
}

function buildContacts(s) {
  const { mapping, customMap, labelsAt } = plan(s);
  const contacts = [];
  const echo = [];
  let empty = 0;
  s.rows.forEach((row, idx) => {
    if (isHeaderEchoRow(row, mapping)) { echo.push(idx + 2); return; }
    const c = buildContactPayload(row, mapping, customMap);
    if (!(c.name || c.email || c.identifier || c.phone_number)) { empty += 1; return; }
    const tags = labelsAt < 0 ? '' : String(row[labelsAt] ?? '').trim();
    if (tags) c.__labels = tags;
    c.__row = idx + 2; // the row number a spreadsheet shows, header = 1
    contacts.push(c);
  });
  return { contacts, echo, empty };
}

function feed(s) {
  s.built = buildContacts(s);
  const csv = toNativeCsv(s.built.contacts, s.labelTitle);
  const name = `${s.file.name.replace(/\.[^.]+$/, '') || 'contacts'}.csv`;
  setFiles(s.input, new File([csv], name, { type: 'text/csv' }));
  fire(s.input, 'change');
  setTimeout(() => cur === s && patchFileRow(s));
  return csv;
}

// ── The box ───────────────────────────────────────────────────────────────────

function render(s) {
  const T = s.T;
  const title = (text, attrs = {}) => h('h4', { class: 'cwi-h text-heading-3 text-n-slate-12', ...attrs }, text);
  const hint = (text) => h('p', { class: 'cwi-hint text-label-small text-n-slate-11' }, text);
  const sample = (i) => (s.rows.find((r) => String(r[i] ?? '').trim()) || [])[i] || '';

  const table = h('table', { class: 'cwi-map' },
    h('thead', {}, h('tr', {},
      h('th', {}, T.colFile), h('th', { class: 'cwi-sm-hide' }, T.colSample), h('th', {}, T.colField))),
    h('tbody', {}, s.headers.map((header, i) => h('tr', {},
      h('td', {}, h('span', { class: 'cwi-col' }, String(header).trim() || `#${i + 1}`),
        s.detected[i] && h('span', { class: 'cwi-auto' }, T.detected)),
      h('td', { class: 'cwi-sample cwi-sm-hide' }, String(sample(i)).trim()),
      h('td', {}, (s.selects[i] = fieldSelect(s, i)))))));

  s.labelSelect = labelSelect(s);
  s.statsEl = h('div', { class: 'cwi-stats' });
  s.notesEl = h('p', { class: 'cwi-hint text-label-small text-n-slate-11' });
  s.email = h('input', { type: 'checkbox', checked: true,
    class: 'peer absolute inset-0 z-10 h-4 w-4 disabled:opacity-50 appearance-none rounded border border-n-slate-6 ring-transparent transition-all duration-200 checked:border-n-brand checked:bg-n-brand dark:border-gray-600 dark:checked:border-n-brand hover:enabled:bg-n-blue-border cursor-pointer' });
  const tick = h('span', { class: 'relative w-4 h-4 shrink-0' }, s.email);
  // Checkbox.vue's checkmark, so the box matches Chatwoot's own checkboxes
  tick.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 14 14" fill="none" aria-hidden="true" class="pointer-events-none absolute w-3.5 h-3.5 z-20 stroke-white opacity-0 peer-checked:opacity-100 transition-opacity duration-200 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><path d="M3 8L6 11L11 3.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>');
  s.status = h('p', { role: 'status', class: 'cwi-hint text-body-main text-n-slate-11', hidden: true });
  s.error = h('div', { role: 'alert', class: 'cwi-err', hidden: true });

  s.fieldset = h('fieldset', { class: 'cwi-fs' },
    h('div', { class: 'cwi-sec' }, h('div', {}, title(T.mapTitle), hint(T.mapHint)), h('div', { class: 'cwi-scroll' }, table)),
    h('div', { class: 'cwi-sec cwi-tight' }, title(T.labelTitle, { id: 'cwi-label-title' }), s.labelSelect, hint(T.labelHint)),
    h('div', { class: 'cwi-sec' }, title(T.checkTitle), s.statsEl, s.notesEl,
      h('label', { class: 'cwi-cb inline-flex cursor-pointer items-center gap-2 text-body-main text-n-slate-12' }, tick, T.emailSummary)),
    s.status, s.error);
  renderCheck(s);
  return h('div', { class: 'cwi-box' }, s.fieldset);
}

function fieldSelect(s, i) {
  const T = s.T;
  const v = s.values[i];
  const header = String(s.headers[i]).trim();
  const sel = h('select', { 'aria-label': T.selectFieldFor(header || `#${i + 1}`), onchange: () => onField(s, i, sel) },
    h('option', { value: '' }, T.ignore),
    h('optgroup', { label: T.systemFields }, FIELD_ORDER.map((f) => h('option', { value: f }, T.fields[f]))),
    h('optgroup', { label: T.customFields },
      s.defs.map((d) => h('option', { value: `custom:${d.attribute_key}` }, d.attribute_display_name || d.attribute_key)),
      header && !matchCustomField(header, s.defs) && h('option', { value: `new:${header}` }, T.newFieldOpt(header)),
      v.startsWith('new:') && v !== `new:${header}` && h('option', { value: v }, T.newFieldOpt(v.slice(4))),
      h('option', { value: '__create' }, T.createField)));
  sel.value = v;
  return sel;
}

function onField(s, i, sel) {
  if (sel.value !== '__create') {
    setField(s, i, sel.value);
    return;
  }
  sel.value = s.values[i];
  inlineEdit(s, sel, s.T.newFieldName, (name) => {
    if (!name) return s.T.fieldNameMissing;
    const def = s.defs.find((d) => matchCustomField(name, [d]));
    setField(s, i, def ? `custom:${def.attribute_key}` : `new:${name}`);
    return '';
  }, () => replaceSelect(s, i));
}

// One column per field, except the fallback phone which may repeat.
function setField(s, i, v) {
  s.values[i] = v;
  if (v && v !== 'phone_number_alt') {
    s.values.forEach((x, j) => {
      if (j !== i && x === v) { s.values[j] = ''; s.selects[j].value = ''; }
    });
  }
  showError(s, '');
  clearTimeout(s.preTimer);
  s.preTimer = setTimeout(() => precheck(s), 250);
}

function replaceSelect(s, i) {
  const next = fieldSelect(s, i);
  s.selects[i].replaceWith(next);
  s.selects[i] = next;
  return next;
}

// Swaps a select for a name input with Add / Cancel; done() returns an error to show, or ''.
function inlineEdit(s, sel, placeholder, done, restore) {
  const T = s.T;
  const input = h('input', { type: 'text', maxlength: '80', placeholder, 'aria-label': placeholder });
  const finish = (save) => {
    if (save) {
      const problem = done(input.value.trim());
      if (problem) { showError(s, problem); input.focus(); return; }
    }
    showError(s, '');
    editor.replaceWith(sel);
    restore().focus();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  const editor = h('div', { class: 'cwi-edit' }, input,
    h('button', { type: 'button', class: 'cwi-btn cwi-primary', onclick: () => finish(true) }, T.add),
    h('button', { type: 'button', class: 'cwi-btn', onclick: () => finish(false) }, T.cancel));
  sel.replaceWith(editor);
  input.focus();
}

function labelSelect(s) {
  const T = s.T;
  const has = (t) => s.labels.some((x) => x.toLowerCase() === t.toLowerCase());
  const sel = h('select', { 'aria-labelledby': 'cwi-label-title', onchange: () => onLabel(s, sel) },
    h('option', { value: '' }, T.noLabel),
    !has(s.monthLabel) && h('option', { value: `new:${s.monthLabel}` }, T.newLabelOpt(s.monthLabel)),
    s.label.startsWith('new:') && s.label !== `new:${s.monthLabel}` && h('option', { value: s.label }, T.newLabelOpt(s.label.slice(4))),
    s.labels.map((t) => h('option', { value: `label:${t}` }, t)),
    h('option', { value: '__other' }, T.otherLabel));
  sel.value = s.label;
  return sel;
}

function onLabel(s, sel) {
  if (sel.value !== '__other') {
    s.label = sel.value;
    showError(s, '');
    return;
  }
  sel.value = s.label;
  inlineEdit(s, sel, s.T.newLabelName, (typed) => {
    const title = normalizeLabelTitle(typed);
    if (!isValidLabelTitle(title)) return s.T.labelNameInvalid;
    const hit = s.labels.find((t) => t.toLowerCase() === title.toLowerCase());
    s.label = hit ? `label:${hit}` : `new:${title}`;
    return '';
  }, () => replaceLabelSelect(s));
}

function replaceLabelSelect(s) {
  const next = labelSelect(s);
  s.labelSelect.replaceWith(next);
  s.labelSelect = next;
  return next;
}

// ── Pre-check ─────────────────────────────────────────────────────────────────

async function precheck(s) {
  const my = ++s.preToken;
  s.built = buildContacts(s);
  const { contacts } = s.built;
  if (contacts.length > PRECHECK_MAX) s.pre = 'big';
  else if (!contacts.length) s.pre = { new: 0, existing: 0, dup_in_file: 0 };
  else s.pre = null;
  renderCheck(s);
  if (s.pre !== null) return;
  try {
    const keys = contacts.map((c) => ({ identifier: c.identifier, email: c.email?.toLowerCase(), phone_number: c.phone_number }));
    const result = await s.api.smartImportPreview(keys);
    if (my === s.preToken && cur === s) s.pre = result;
  } catch {
    if (my === s.preToken && cur === s) s.pre = 'error';
  }
  if (my === s.preToken && cur === s) renderCheck(s);
}

function phoneSample(s) {
  const cols = s.values.flatMap((v, i) => (v === 'phone_number' || v === 'phone_number_alt' ? [i] : []));
  for (const row of s.rows.slice(0, 200)) {
    for (const i of cols) {
      const raw = String(row[i] ?? '').trim();
      const e164 = raw && normalizePhone(raw);
      if (e164 && e164 !== raw) return raw;
    }
  }
  return '';
}

function renderCheck(s) {
  const T = s.T;
  const p = s.pre;
  const ok = p && typeof p === 'object';
  const { contacts, echo, empty } = s.built || buildContacts(s);
  const n = (k) => (ok ? Number(p[k] || 0).toLocaleString(s.locale) : p === null ? '…' : '—');
  const noPhone = contacts.filter((c) => !c.phone_number).length;
  const stat = (num, label) => h('div', { class: 'cwi-stat' }, h('b', {}, num), h('span', {}, label));
  s.statsEl.replaceChildren(stat(n('new'), T.statNew), stat(n('existing'), T.statExisting),
    stat(n('dup_in_file'), T.statDup), stat(noPhone.toLocaleString(s.locale), T.statNoPhone));
  const sample = phoneSample(s);
  const notes = [
    p === null && T.checking,
    sample && T.phoneFormat(isolate(sample)),
    ok && p.whatsapp && contacts.some((c) => c.phone_number) && T.waLinked,
    noPhone > 0 && T.noPhoneNote(noPhone),
    echo.length > 0 && T.headerEcho(echo.slice(0, 10).join(', ') + (echo.length > 10 ? '…' : '')),
    empty > 0 && T.emptyRows(empty),
    p === 'error' && T.precheckFailed,
    p === 'big' && T.precheckTooBig(PRECHECK_MAX.toLocaleString(s.locale)),
  ].filter(Boolean);
  s.notesEl.textContent = notes.join(' ');
  s.notesEl.hidden = !notes.length;
}

// ── Import ────────────────────────────────────────────────────────────────────

function showError(s, message) {
  s.error.textContent = message;
  s.error.hidden = !message;
}

function setBusy(s, busy) {
  s.busy = busy;
  syncDisabled(s);
  s.status.textContent = busy ? s.T.preparing : '';
  s.status.hidden = !busy;
}

function problemOf(s) {
  const T = s.T;
  const { mapping } = plan(s);
  if (!mapping.some((m) => IDENTITY.has(m.field))) return T.needIdentity;
  const [bad] = validateMapping(s.headers, s.rows, mapping);
  if (bad) return T.badMapping(bad.header, bad.total - bad.valid, bad.total, T.fields[bad.field]);
  if (s.label.startsWith('new:') && !isValidLabelTitle(s.label.slice(4))) return T.labelNameInvalid;
  if (!buildContacts(s).contacts.length) return T.needIdentity;
  return '';
}

async function ensureFields(s) {
  for (let i = 0; i < s.values.length; i += 1) {
    if (!s.values[i].startsWith('new:')) continue;
    const name = s.values[i].slice(4).trim();
    const key = slugify(name);
    const find = () => s.defs.find((d) => d.attribute_key === key || matchCustomField(name, [d]));
    let def = find();
    if (!def) {
      try {
        def = await s.api.createCustomAttribute({ attribute_display_name: name, attribute_key: key,
          attribute_display_type: 'text', attribute_model: 'contact_attribute' });
        s.defs.push(def);
      } catch {
        s.defs = await s.api.listCustomAttributes().then(asList).catch(() => s.defs);
        def = find();
        if (!def) throw new Notice(s.T.fieldCreateFailed(name));
      }
    }
    s.values[i] = `custom:${def.attribute_key}`;
    replaceSelect(s, i);
  }
}

async function ensureLabel(s) {
  s.labelTitle = '';
  if (s.label.startsWith('label:')) s.labelTitle = s.label.slice(6);
  if (!s.label.startsWith('new:')) return;
  const title = s.label.slice(4);
  try {
    s.labelTitle = (await s.api.createLabel(title))?.title || title;
  } catch {
    const hit = (await s.api.listLabels().then(labelTitles).catch(() => [])).find((t) => t.toLowerCase() === title.toLowerCase());
    if (!hit) throw new Notice(s.T.labelCreateFailed);
    s.labelTitle = hit;
  }
  s.labels = [...new Set([...s.labels, s.labelTitle])];
  s.label = `label:${s.labelTitle}`;
  replaceLabelSelect(s);
}

async function run(s, form) {
  const problem = problemOf(s);
  if (problem) { showError(s, problem); return; }
  clearTimeout(s.preTimer);
  showError(s, '');
  setBusy(s, true);
  try {
    await ensureFields(s);
    await ensureLabel(s);
    if (cur !== s) return;
    const csv = feed(s);
    const sha256 = await digest(csv);
    await s.api.smartImportArm({ sha256, whatsapp: true, email_summary: s.email.checked, label: s.labelTitle, locale: s.locale })
      .catch(() => { throw new Notice(s.T.armFailed); });
    if (cur !== s) return;
    s.bypass = true;
    try { form.requestSubmit(); } finally { s.bypass = false; }
  } catch (e) {
    if (cur === s) showError(s, e instanceof Notice ? e.message : s.T.armFailed);
  } finally {
    if (cur === s) setBusy(s, false);
  }
}
