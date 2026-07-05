import { readFileToTable } from '../lib/xlsxReader.js';
import { detectColumns, SYSTEM_FIELDS } from '../lib/columnDetector.js';
import { buildContactPayload } from '../lib/fieldMapper.js';
import { runImport } from '../lib/importRunner.js';
import { createApiClient } from '../lib/apiClient.js';
import { buildFilterPayload, pickMatch } from '../lib/dedup.js';
import { vendorUrl } from '../lib/basepath.js';
import { STYLES } from './styles.js';

// ── i18n: Hebrew for RTL (he) users, English for everyone else. Same signal the
// wizard already uses for layout (pageIsRTL, below): Chatwoot sets #app[dir]=rtl only
// for Hebrew. he→Hebrew, ltr→English (also the sane fallback for fr/es/…). The bundle
// loads lazily after the app renders, so #app[dir] exists by the time this runs. ──
const DRIP_LOCALE = (function () {
  const a = document.querySelector('#app[dir]');
  return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
})();
const I18N = {
  he: {
    // system-field labels (mapping dropdown)
    ignore: '— התעלם —', fName: 'שם מלא', fFirstName: 'שם פרטי', fLastName: 'שם משפחה',
    fPhone: 'טלפון', fEmail: 'אימייל', fIdentifier: 'מזהה', fCompany: 'חברה',
    fCity: 'עיר', fCountry: 'מדינה',
    // step 1 — upload
    uploadTitle: 'ייבוא אנשי קשר', uploadDesc: 'גררו קובץ CSV או Excel, או לחצו לבחירה. ',
    sampleLink: 'הורדת קובץ לדוגמה', sampleFileName: 'דוגמה-אנשי-קשר.csv',
    dropText: 'בחירת קובץ או גרירה לכאן', csvOrExcel: 'CSV או Excel',
    replace: 'החלף', remove: 'הסר', emptyFile: 'הקובץ ריק או ללא כותרות',
    // step 2 — mapping
    mappingTitle: 'מיפוי עמודות',
    mappingDesc: 'התאימו כל עמודה לשדה ב-Chatwoot. זיהינו אוטומטית — תקנו במידת הצורך.',
    colInFile: 'עמודה בקובץ', fieldInChatwoot: 'שדה ב-Chatwoot', example: 'דוגמה',
    systemFields: 'שדות מערכת', customFields: 'שדות מותאמים',
    createNewField: 'צור שדה מותאם חדש…', newFieldName: 'שם השדה החדש',
    confirmTitle: 'אשר', cancel: 'ביטול', change: 'שנה',
    // customSelect
    search: 'חיפוש…', noResults: 'אין תוצאות',
    // step 3 — label
    labelStepTitle: 'תווית',
    labelStepDesc: 'תוקצה לכל אנשי הקשר המיובאים (לא תמחק תוויות קיימות)',
    noLabel: '— ללא תווית —', newLabelPlaceholder: 'או צרו תווית חדשה',
    selectLabel: 'בחר תווית:', newLabelField: 'תווית חדשה:',
    // step 4 — preview
    previewTitle: 'בדיקה לפני ייבוא', checkingDupes: 'בודק כפילויות…',
    readyToImport: 'מוכן לייבוא:', newWord: 'חדשים', existingWillUpdate: 'קיימים (יעודכנו)',
    importVerb: 'ייבא', contactsWord: 'אנשי קשר',
    // step 5 — run / done
    importing: 'מייבא…', importDone: 'הייבוא הושלם',
    createdWord: 'נוצרו', updatedWord: 'עודכנו', skippedWord: 'דולגו', failedWord: 'נכשלו',
    downloadReport: 'הורד דוח CSV', close: 'סגור',
    // footer
    back: 'חזרה', continue: 'המשך',
    // preview table headers
    thName: 'שם', thPhone: 'טלפון', thEmail: 'אימייל', thCompany: 'חברה',
  },
  en: {
    ignore: '— Ignore —', fName: 'Full name', fFirstName: 'First name', fLastName: 'Last name',
    fPhone: 'Phone', fEmail: 'Email', fIdentifier: 'Identifier', fCompany: 'Company',
    fCity: 'City', fCountry: 'Country',
    uploadTitle: 'Import contacts', uploadDesc: 'Drag a CSV or Excel file here, or click to choose. ',
    sampleLink: 'Download a sample file', sampleFileName: 'sample-contacts.csv',
    dropText: 'Choose a file or drag it here', csvOrExcel: 'CSV or Excel',
    replace: 'Replace', remove: 'Remove', emptyFile: 'The file is empty or has no headers',
    mappingTitle: 'Map columns',
    mappingDesc: 'Match each column to a Chatwoot field. We detected these automatically — adjust as needed.',
    colInFile: 'Column in file', fieldInChatwoot: 'Chatwoot field', example: 'Example',
    systemFields: 'System fields', customFields: 'Custom fields',
    createNewField: 'Create a new custom field…', newFieldName: 'New field name',
    confirmTitle: 'Confirm', cancel: 'Cancel', change: 'Change',
    search: 'Search…', noResults: 'No results',
    labelStepTitle: 'Label',
    labelStepDesc: 'Applied to all imported contacts (existing labels are kept)',
    noLabel: '— No label —', newLabelPlaceholder: 'Or create a new label',
    selectLabel: 'Select a label:', newLabelField: 'New label:',
    previewTitle: 'Review before import', checkingDupes: 'Checking for duplicates…',
    readyToImport: 'Ready to import:', newWord: 'new', existingWillUpdate: 'existing (will be updated)',
    importVerb: 'Import', contactsWord: 'contacts',
    importing: 'Importing…', importDone: 'Import complete',
    createdWord: 'Created', updatedWord: 'Updated', skippedWord: 'Skipped', failedWord: 'Failed',
    downloadReport: 'Download CSV report', close: 'Close',
    back: 'Back', continue: 'Continue',
    thName: 'Name', thPhone: 'Phone', thEmail: 'Email', thCompany: 'Company',
  },
};
function t(k) { return (I18N[DRIP_LOCALE] || I18N.en)[k] || I18N.en[k] || k; }

const FIELD_LABELS = {
  '': t('ignore'), name: t('fName'), first_name: t('fFirstName'), last_name: t('fLastName'),
  phone_number: t('fPhone'), email: t('fEmail'), identifier: t('fIdentifier'),
  company_name: t('fCompany'), city: t('fCity'), country: t('fCountry'),
};

let XLSX_LOADING = null;
// assetBase here is the addons base (window.__CW_ADDONS_BASE, e.g. /chatwoot-addons) —
// vendorUrl() derives the actual smart-import vendor path from it (zero hardcoded path).
function loadXlsx(assetBase) {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!XLSX_LOADING) {
    XLSX_LOADING = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = vendorUrl(assetBase);
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => reject(new Error('SheetJS load failed'));
      document.head.appendChild(s);
    });
  }
  return XLSX_LOADING;
}

export function openWizard({ accountId, authHeaders, assetBase }) {
  injectStyles();
  const api = createApiClient(accountId, authHeaders);
  const state = { table: null, mapping: [], customMap: [], labelTitle: '' };

  // FIX 1: native <dialog> opened with showModal() — goes to browser top layer,
  // above any Chatwoot native dialog.
  var dlg = document.createElement('dialog');
  dlg.className = 'cwi-dlg';
  // Chatwoot uses darkMode:'class'. The <dialog> in the top layer doesn't reliably
  // inherit the page's `.dark`, so force it onto the dialog itself → Chatwoot's
  // `.dark { --… }` design-token vars cascade to the dialog and all its children.
  const pageIsDark = document.documentElement.classList.contains('dark') ||
    document.body.classList.contains('dark');
  if (pageIsDark) dlg.classList.add('dark');
  // Chatwoot sets dir on #app and wraps portaled content in <div dir> (TeleportWithDirection).
  // Our <dialog> is appended to <body> — OUTSIDE #app — so it never inherits that dir.
  // Detect the page direction (same source Chatwoot reads) and set it on the dialog → the
  // whole wizard AND the fixed dropdown panel render RTL correctly (right-aligned, flipped).
  const appDir = (document.querySelector('#app[dir]') || document.documentElement).getAttribute('dir');
  const pageIsRTL = appDir ? appDir === 'rtl' : getComputedStyle(document.body).direction === 'rtl';
  dlg.setAttribute('dir', pageIsRTL ? 'rtl' : 'ltr');
  const modal = el('div', 'cwi-modal flex flex-col gap-5 p-6 bg-n-alpha-3 backdrop-blur-[100px] shadow-xl rounded-xl rtl:text-right');
  dlg.appendChild(modal);
  document.body.appendChild(dlg);
  dlg.showModal();
  function close() { try { dlg.close(); } catch (e) {} dlg.remove(); }
  dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); }); // ESC closes
  dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) close(); }); // backdrop click closes

  stepUpload();

  // ── Step 1 — Upload ──────────────────────────────────────────────────────────
  // Mirrors ContactImportDialog.vue: subtle dashed dropzone + sample-CSV link;
  // after a pick, a native selected-file row (file-text · name · replace · trash).
  function stepUpload() {
    modal.replaceChildren();

    // Description <p> with sample-CSV download link (like the original dialog).
    const desc = el('p', 'mb-0 text-sm text-n-slate-11');
    desc.append(t('uploadDesc'));
    const sample = el('a', 'text-n-blue-11');
    sample.textContent = t('sampleLink');
    sample.setAttribute('download', t('sampleFileName'));
    sample.setAttribute('href', sampleCsvHref());
    desc.appendChild(sample);
    modal.appendChild(header(t('uploadTitle'), desc));

    const input = el('input'); input.type = 'file'; input.accept = '.csv,.xlsx,.xls'; input.style.display = 'none';
    input.addEventListener('change', () => input.files[0] && handleFile(input.files[0], drop, body));

    // Dropzone — subtle, Chatwoot-like dashed box.
    const drop = el('div',
      'flex flex-col items-center justify-center gap-2 p-6 rounded-lg outline-dashed outline-1 outline-n-weak bg-n-alpha-1 cursor-pointer hover:bg-n-alpha-2 transition-colors');
    const body = el('div', 'flex flex-col items-center justify-center gap-2');
    body.append(
      icon('upload', 'size-6 text-n-slate-11'),
      elWithText('span', 'text-sm text-n-slate-12', t('dropText')),
      elWithText('span', 'text-xs text-n-slate-11', t('csvOrExcel')),
    );
    drop.appendChild(body);
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); });
    drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0], drop, body); });

    modal.append(drop, input, footer({ onCancel: close }));
  }

  // Render the native selected-file row into the dropzone body (ContactImportDialog).
  function showPickedFile(file, body) {
    body.replaceChildren();
    // Clicking the file row shouldn't re-trigger the dropzone file dialog.
    body.className = 'flex items-center gap-2 w-full';
    body.addEventListener('click', (e) => e.stopPropagation());

    const left = el('div', 'flex items-center min-w-0 gap-2 flex-1');
    left.append(
      icon('file-text', 'size-4 text-n-slate-11 shrink-0'),
      elWithText('span', 'text-sm text-n-slate-12 truncate', processFileName(file.name)),
    );

    const right = el('div', 'flex items-center gap-2 shrink-0');
    const replaceBtn = btn('ghost');
    replaceBtn.textContent = t('replace');
    replaceBtn.addEventListener('click', (e) => { e.stopPropagation(); stepUpload(); });
    const sep = el('div', 'w-px h-3 bg-n-strong');
    const trashBtn = el('button',
      BTN_BASE + ' text-n-slate-12 hover:bg-n-alpha-2 outline-transparent h-8 w-8 p-0 cursor-pointer');
    trashBtn.appendChild(icon('trash', 'size-4'));
    trashBtn.title = t('remove');
    trashBtn.addEventListener('click', (e) => { e.stopPropagation(); stepUpload(); });
    right.append(replaceBtn, sep, trashBtn);

    body.append(left, right);
  }

  async function handleFile(file, drop, body) {
    if (drop && body) showPickedFile(file, body); // reflect the pick immediately
    try {
      const table = await readFileToTable(file, { loadXlsx: () => loadXlsx(assetBase) });
      if (!table.headers.length) throw new Error(t('emptyFile'));
      state.table = table;
      state.mapping = detectColumns(table.headers, table.rows.slice(0, 20))
        .map((d) => ({ index: d.index, field: d.field }));
      stepMapping();
    } catch (e) { showError(e.message); }
  }

  // ── Step 2 — Unified mapping ─────────────────────────────────────────────────
  // customDefs are loaded once; every column dropdown offers system + custom + create-new.
  async function stepMapping() {
    modal.replaceChildren();
    modal.appendChild(header(t('mappingTitle'), t('mappingDesc')));

    let customDefs = [];
    try { customDefs = await api.listCustomAttributes(); } catch { /* ignore */ }

    const tbl = el('table', 'w-full text-sm border-collapse');
    const thead = el('tr');
    [t('colInFile'), t('fieldInChatwoot'), t('example')].forEach((h) => {
      const th = el('th', 'text-start font-medium text-n-slate-11 px-3 py-2 cwi-tbl-cell border-n-weak');
      th.textContent = h;
      thead.appendChild(th);
    });
    tbl.appendChild(thead);

    state.customMap = []; // reset on each entry to mapping step

    state.table.headers.forEach((colHeader, i) => {
      const sample = (state.table.rows.find((r) => (r[i] || '').trim()) || [])[i] || '';

      // Build the option list in the same order/grouping the native <select> used:
      // ignore → system fields → existing custom attrs (if any) → create-new.
      const options = [];
      options.push({ value: '', label: t('ignore') });
      SYSTEM_FIELDS.forEach((fld) => {
        options.push({ value: fld, label: FIELD_LABELS[fld] || fld, group: t('systemFields') });
      });
      if (customDefs.length) {
        customDefs.forEach((d) => {
          options.push({ value: 'custom:' + d.attribute_key, label: d.attribute_display_name, group: t('customFields') });
        });
      }
      options.push({ value: '__new__', label: t('createNewField'), icon: 'plus' });

      // Initial selection mirrors the old code: only a matching system field
      // pre-selects; custom attrs never pre-select on first render.
      const initial = state.mapping[i]?.field && SYSTEM_FIELDS.includes(state.mapping[i].field)
        ? state.mapping[i].field
        : '';

      const row = el('tr');
      const tdHeader = el('td', 'px-3 py-2 cwi-tbl-cell border-n-weak text-n-slate-12');
      tdHeader.textContent = colHeader;
      const tdSel = el('td', 'px-3 py-2 cwi-tbl-cell border-n-weak text-n-slate-12');

      const cs = customSelect({
        options,
        value: initial,
        placeholder: t('ignore'),
        onSelect: (v) => {
          if (v === '__new__') {
            showInlineNewField(i, colHeader, tdSel, cs);
          } else {
            updateMapping(i, v);
          }
        },
      });
      tdSel.appendChild(cs.el);

      const tdSample = el('td', 'px-3 py-2 cwi-tbl-cell border-n-weak text-n-slate-12');
      tdSample.textContent = sample;
      row.append(tdHeader, tdSel, tdSample);
      tbl.appendChild(row);
    });

    modal.append(tbl, footer({ onBack: stepUpload, onNext: stepLabel, nextLabel: t('continue') }));
  }

  // FIX 3: inline editor for creating a new custom field — replaces the select cell
  // with a text input + confirm/cancel affordance; no prompt() involved.
  // `origCs` is the customSelect handle ({ el, setValue }) shown before editing.
  function showInlineNewField(i, colHeader, tdSel, origCs) {
    // Clear the cell and reset state for this column
    state.mapping[i] = { index: i, field: null };
    state.customMap = state.customMap.filter((c) => c.index !== i);

    // Build inline editor
    const wrap = el('div', 'flex items-center gap-1');

    const inp = el('input',
      'h-8 px-3 rounded-lg bg-n-alpha-black2 text-n-slate-12 outline outline-1 outline-n-weak focus:outline-n-brand text-sm w-full border-0 outline-offset-[-1px]');
    inp.value = colHeader;
    inp.placeholder = t('newFieldName');

    const confirmBtn = el('button',
      BTN_BASE + ' bg-n-brand text-white hover:brightness-110 outline-transparent h-8 w-8 p-0 shrink-0 cursor-pointer');
    confirmBtn.appendChild(icon('check', 'size-4'));
    confirmBtn.title = t('confirmTitle');

    const cancelBtn = el('button',
      BTN_BASE + ' text-n-slate-12 hover:bg-n-alpha-2 outline-transparent h-8 w-8 p-0 shrink-0 cursor-pointer');
    cancelBtn.appendChild(icon('x', 'size-4'));
    cancelBtn.title = t('cancel');

    function commit() {
      const name = inp.value.trim() || colHeader;
      state.customMap.push({ index: i, attribute_key: slugify(name), create: { display: name } });
      // Show committed state: replace wrap with a read-only label + cancel to change
      const done = el('div', 'flex items-center gap-1');
      const lbl = el('span', 'text-sm text-n-slate-12 flex-1 truncate');
      lbl.textContent = name;
      const changeBtn = el('button',
        BTN_BASE + ' text-n-slate-12 hover:bg-n-alpha-2 outline-transparent h-8 w-8 p-0 shrink-0 cursor-pointer');
      changeBtn.appendChild(icon('x', 'size-4'));
      changeBtn.title = t('change');
      changeBtn.addEventListener('click', revert);
      done.append(lbl, changeBtn);
      tdSel.replaceChildren(done);
    }

    function revert() {
      state.mapping[i] = { index: i, field: null };
      state.customMap = state.customMap.filter((c) => c.index !== i);
      origCs.setValue('');
      tdSel.replaceChildren(origCs.el);
    }

    confirmBtn.addEventListener('click', commit);
    cancelBtn.addEventListener('click', revert);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); revert(); }
    });

    wrap.append(inp, confirmBtn, cancelBtn);
    tdSel.replaceChildren(wrap);
    inp.focus();
  }

  function updateMapping(i, value) {
    // Reset this column's previous assignments
    state.mapping[i] = { index: i, field: null };
    state.customMap = state.customMap.filter((c) => c.index !== i);

    if (SYSTEM_FIELDS.includes(value)) {
      state.mapping[i].field = value;
    } else if (value.startsWith('custom:')) {
      state.customMap.push({ index: i, attribute_key: value.slice(7) });
    }
    // value === '' → ignore (leave reset)
    // value === '__new__' → handled by showInlineNewField, not this function
  }

  // ── FIX 2 — custom dropdown (mimics Chatwoot ComboBoxDropdown) ────────────────
  // Replaces the native <select> whose OS menu can't be themed. Trigger button +
  // an absolutely-positioned themed panel. The panel is appended to the <dialog>
  // (which carries `.dark` when the page is dark) and positioned via
  // getBoundingClientRect, so no overflow:auto scroll container (.cwi-modal) clips
  // it. options: [{ value, label, group? }]. Returns { el, setValue }.
  let openPanelCloser = null; // only one panel open at a time
  // `size` — 'compact' (h-8, mapping table) | 'field' (h-10, roomier label step).
  function customSelect({ options, value, onSelect, placeholder, size }) {
    let currentValue = value == null ? '' : value;
    const heightCls = size === 'field' ? 'h-10' : 'h-8';

    const container = el('div', 'relative w-full');

    // Trigger = ComboBox.vue outline Button (slate). Chevron flips on open;
    // outline goes weak→brand on open.
    const trigger = el('button',
      'inline-flex items-center min-w-0 gap-2 transition-all duration-100 ease-out border-0 rounded-lg outline-1 outline disabled:opacity-50 ' +
      heightCls + ' px-3 text-sm text-n-slate-12 font-normal justify-between w-full outline-n-weak hover:outline-n-slate-6 focus:outline-n-brand cursor-pointer');
    trigger.type = 'button';
    const labelSpan = el('span', 'truncate');
    const chevron = icon('chevron-down', 'size-4 text-n-slate-11 shrink-0');
    trigger.append(labelSpan, chevron);
    container.appendChild(trigger);

    let panel = null;
    let panelRows = [];   // all option <li> nodes, in DOM order (for keyboard nav)
    let activeNode = null; // currently keyboard-highlighted row

    // Keyboard navigation (arrows/enter) — mirrors Chatwoot's ComboBox behaviour.
    function visibleRows() { return panelRows.filter((n) => n.style.display !== 'none'); }
    function clearActive() { if (activeNode) activeNode.classList.remove('bg-n-alpha-3'); activeNode = null; }
    function setActiveNode(node) {
      clearActive();
      activeNode = node;
      if (node) { node.classList.add('bg-n-alpha-3'); node.scrollIntoView({ block: 'nearest' }); }
    }
    function moveActive(delta) {
      const vis = visibleRows();
      if (!vis.length) return;
      const cur = activeNode ? vis.indexOf(activeNode) : -1;
      let next = cur + delta;
      if (next < 0) next = vis.length - 1;
      else if (next >= vis.length) next = 0;
      setActiveNode(vis[next]);
    }

    function labelFor(v) {
      const opt = options.find((o) => o.value === v);
      return opt ? opt.label : '';
    }
    function renderTriggerLabel() {
      const txt = labelFor(currentValue);
      if (txt) {
        labelSpan.textContent = txt;
        labelSpan.className = 'truncate text-n-slate-12';
      } else {
        labelSpan.textContent = placeholder || '';
        labelSpan.className = 'truncate text-n-slate-11';
      }
    }
    renderTriggerLabel();

    function setChevron(open) {
      chevron.className = 'i-lucide-chevron-' + (open ? 'up' : 'down') + ' size-4 text-n-slate-11 shrink-0';
    }
    function setTriggerOpen(open) {
      // Swap outline weak↔brand while keeping the rest of the trigger classes.
      trigger.classList.toggle('outline-n-weak', !open);
      trigger.classList.toggle('hover:outline-n-slate-6', !open);
      trigger.classList.toggle('outline-n-brand', open);
      setChevron(open);
    }

    // Port of Chatwoot's useDropdownPosition (fixedPosition mode): prefer opening
    // below the trigger; flip above only when below doesn't fit and above is better;
    // cap the list height to the available space so it never overflows the viewport.
    function positionPanel() {
      if (!panel) return;
      const GAP = 8, MARGIN = 16;
      const r = trigger.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const list = panel.querySelector('ul');
      if (list) list.style.maxHeight = ''; // measure natural height first
      const dh = panel.offsetHeight || 240;
      panel.style.position = 'fixed';
      panel.style.width = r.width + 'px';

      const spaceBelow = vh - r.bottom, spaceAbove = r.top;
      const placeAbove = spaceBelow < dh + MARGIN &&
        (spaceAbove >= dh + MARGIN || spaceAbove > spaceBelow);
      if (placeAbove) {
        panel.style.top = 'auto';
        panel.style.bottom = (vh - r.top + GAP) + 'px';
        if (list) list.style.maxHeight = Math.max(80, Math.min(240, spaceAbove - GAP - MARGIN)) + 'px';
      } else {
        panel.style.bottom = 'auto';
        panel.style.top = (r.bottom + GAP) + 'px';
        if (list) list.style.maxHeight = Math.max(80, Math.min(240, spaceBelow - GAP - MARGIN)) + 'px';
      }

      let left = r.left;
      if (left + r.width > vw - MARGIN) left = vw - MARGIN - r.width;
      if (left < MARGIN) left = MARGIN;
      panel.style.left = left + 'px';
    }

    function closePanel() {
      if (!panel) return;
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', positionPanel, true);
      modal.removeEventListener('scroll', positionPanel, true);
      panel.remove();
      panel = null;
      panelRows = [];
      activeNode = null;
      openPanelCloser = null;
      setTriggerOpen(false);
    }

    function onOutside(e) {
      if (panel && !panel.contains(e.target) && !trigger.contains(e.target)) closePanel();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); return; }
      if (e.key === 'Enter' && activeNode) { e.preventDefault(); activeNode.click(); }
    }

    function buildRow(opt) {
      const isSel = opt.value === currentValue;
      const row = el('li',
        'flex items-center justify-between w-full gap-2 px-3 py-2 text-sm transition-colors duration-150 cursor-pointer hover:bg-n-alpha-2' +
        (isSel ? ' bg-n-alpha-2' : ''));
      row.setAttribute('role', 'option');
      const lead = el('span', 'flex items-center min-w-0 gap-2');
      if (opt.icon) lead.appendChild(icon(opt.icon, 'size-4 text-n-slate-11 shrink-0'));
      const txt = el('span', 'truncate text-n-slate-12' + (isSel ? ' font-medium' : ''));
      txt.textContent = opt.label;
      lead.appendChild(txt);
      row.appendChild(lead);
      if (isSel) row.appendChild(icon('check', 'flex-shrink-0 size-4 text-n-slate-11'));
      row.addEventListener('click', () => {
        currentValue = opt.value;
        renderTriggerLabel();
        closePanel();
        onSelect(opt.value);
      });
      return row;
    }

    function openPanel() {
      if (openPanelCloser) openPanelCloser(); // close any other open panel
      // Panel root — ComboBoxDropdown.vue visual classes (rounded-md, fade). We
      // position:fixed (getBoundingClientRect) because it lives on the <dialog>,
      // not `absolute`; overflow/max-h moves to the <ul> scroller.
      panel = el('div',
        'cwi-cs-panel z-50 transition-opacity duration-200 border rounded-md shadow-lg bg-n-solid-1 border-n-strong');
      if (pageIsDark) panel.classList.add('dark'); // panel lives on <dialog>; keep theme explicit
      // Take the panel out of flow BEFORE appending it. If it were appended as a static
      // (in-flow) element, it would grow the <dialog>'s content box → the modal re-centers
      // → the trigger shifts → positionPanel then measures a stale trigger rect and the
      // panel opens in the wrong place. Fixed-from-birth avoids that reflow entirely.
      panel.style.position = 'fixed';
      panel.style.top = '0';
      panel.style.left = '0';
      panel.style.opacity = '0';

      // Optional search bar — only for long lists (>7 options), Chatwoot-like.
      const withSearch = options.length > 7;
      let searchInput = null;
      if (withSearch) {
        const searchWrap = el('div', 'relative border-b border-n-strong');
        searchWrap.appendChild(icon('search', 'absolute top-2.5 size-4 text-n-slate-11 ' + (pageIsRTL ? 'right-3' : 'left-3')));
        searchInput = el('input',
          'reset-base w-full py-2 text-sm focus:outline-none border-none rounded-t-md bg-n-solid-1 text-n-slate-12 ' +
          (pageIsRTL ? 'pr-10 pl-2 text-right' : 'pl-10 pr-2'));
        searchInput.type = 'search';
        searchInput.placeholder = t('search');
        searchWrap.appendChild(searchInput);
        panel.appendChild(searchWrap);
      }

      const list = el('ul', 'py-1 mb-0 overflow-auto max-h-60');
      list.setAttribute('role', 'listbox');

      // Track group-label <li> nodes so filtering can hide empty groups.
      const groupNodes = []; // { node, group }
      const rowNodes = []; // { node, group, label }
      let lastGroup;
      options.forEach((opt) => {
        if (opt.group && opt.group !== lastGroup) {
          lastGroup = opt.group;
          const gl = el('li', 'px-3 py-1.5 text-xs font-medium text-n-slate-11');
          gl.textContent = opt.group;
          list.appendChild(gl);
          groupNodes.push({ node: gl, group: opt.group });
        }
        if (!opt.group) lastGroup = undefined;
        const rowNode = buildRow(opt);
        rowNodes.push({ node: rowNode, group: opt.group, label: opt.label });
        list.appendChild(rowNode);
      });

      const empty = el('li', 'px-3 py-2 text-sm text-n-slate-11');
      empty.textContent = t('noResults');
      empty.style.display = 'none';
      list.appendChild(empty);

      panel.appendChild(list);
      panelRows = rowNodes.map((r) => r.node); // enable keyboard navigation

      function applyFilter(q) {
        const needle = q.trim().toLowerCase();
        let anyVisible = false;
        const groupHasVisible = {};
        rowNodes.forEach((r) => {
          const match = !needle || r.label.toLowerCase().indexOf(needle) !== -1;
          r.node.style.display = match ? '' : 'none';
          if (match) {
            anyVisible = true;
            if (r.group) groupHasVisible[r.group] = true;
          }
        });
        groupNodes.forEach((g) => {
          g.node.style.display = groupHasVisible[g.group] ? '' : 'none';
        });
        empty.style.display = anyVisible ? 'none' : '';
        if (activeNode && activeNode.style.display === 'none') clearActive();
      }

      if (searchInput) {
        searchInput.addEventListener('input', () => applyFilter(searchInput.value));
      }

      dlg.appendChild(panel); // inside the dialog (top layer, overflow:visible) → not clipped
      positionPanel();
      setTriggerOpen(true);
      requestAnimationFrame(() => { if (panel) panel.style.opacity = '1'; });
      // preventScroll: focusing the search input must NOT scroll the dialog/page
      // (that caused the panel to "jump"); the panel is fixed-positioned already.
      if (searchInput) searchInput.focus({ preventScroll: true });

      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', positionPanel, true);
      modal.addEventListener('scroll', positionPanel, true);
      openPanelCloser = closePanel;
    }

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      if (panel) closePanel(); else openPanel();
    });

    return {
      el: container,
      setValue(v) { currentValue = v == null ? '' : v; renderTriggerLabel(); },
    };
  }

  // ── Step 3 — Label ───────────────────────────────────────────────────────────
  async function stepLabel() {
    modal.replaceChildren();
    modal.appendChild(header(t('labelStepTitle'), t('labelStepDesc')));

    let labels = [];
    try { labels = await api.listLabels().then((r) => r.payload || r); } catch { /* allow new only */ }

    let selValue = ''; // tracks the chosen existing-label value (replaces sel.value)

    const options = [{ value: '', label: t('noLabel') }];
    (labels || []).forEach((l) => options.push({ value: l.title, label: l.title }));

    const newInput = el('input',
      'h-8 w-full px-3 py-2 text-sm rounded-lg bg-n-alpha-black2 text-n-slate-12 outline outline-1 outline-n-weak focus:outline-n-brand border-0 outline-offset-[-1px]');
    newInput.placeholder = t('newLabelPlaceholder');

    const cs = customSelect({
      options,
      value: '',
      placeholder: t('noLabel'),
      size: 'field', // roomier single-select field for the label step
      onSelect: (v) => { selValue = v; if (v) newInput.value = ''; },
    });

    modal.append(
      formRow(t('selectLabel'), cs.el),
      formRow(t('newLabelField'), newInput),
      footer({
        onBack: stepMapping,
        onNext: () => { state.labelTitle = newInput.value.trim() || selValue; stepPreview(); },
        nextLabel: t('continue'),
      }),
    );
  }

  // ── Step 4 — Preview ─────────────────────────────────────────────────────────
  async function stepPreview() {
    modal.replaceChildren();
    modal.appendChild(header(t('previewTitle'), ''));

    const status = el('div', 'text-sm text-n-slate-11');
    status.textContent = t('checkingDupes');
    modal.appendChild(status);

    await ensureCustomAttributes();
    await ensureLabel();

    const contacts = state.table.rows.map((row, idx) => ({
      ...buildContactPayload(row, state.mapping, state.customMap),
      __row: idx + 2,
    }));
    state.contacts = contacts;
    const N = contacts.length;

    // Full dedup — run now so runImport can skip the filter calls
    for (let i = 0; i < N; i++) {
      status.textContent = `${t('checkingDupes')} ${i + 1}/${N}`;
      const c = contacts[i];
      try {
        const fp = buildFilterPayload(c);
        if (fp) {
          const res = await api.filterContacts(fp);
          c.__match = pickMatch(res?.payload || [], c);
        } else {
          c.__match = null;
        }
      } catch {
        c.__match = null;
      }
    }

    const existing = contacts.filter((c) => c.__match).length;
    const created = N - existing;
    status.textContent = `${t('readyToImport')} ${N} · ${created} ${t('newWord')} · ${existing} ${t('existingWillUpdate')}`;

    modal.append(
      previewTable(contacts.slice(0, 10)),
      footer({ onBack: stepLabel, onNext: stepRun, nextLabel: `${t('importVerb')} ${N} ${t('contactsWord')}` }),
    );
  }

  async function ensureCustomAttributes() {
    for (const c of state.customMap.filter((x) => x.create)) {
      try {
        await api.createCustomAttribute({
          attribute_display_name: c.create.display,
          attribute_key: c.attribute_key,
          attribute_display_type: 'text',
          attribute_model: 'contact_attribute',
        });
      } catch { /* already exists → ignore */ }
    }
  }

  async function ensureLabel() {
    if (!state.labelTitle) return;
    try { await api.createLabel(state.labelTitle); } catch { /* already exists → ignore */ }
  }

  // ── Step 5 — Run + Done ──────────────────────────────────────────────────────
  async function stepRun() {
    modal.replaceChildren();
    modal.appendChild(header(t('importing'), ''));

    const track = el('div', 'h-2 w-full rounded-full bg-n-alpha-2 overflow-hidden');
    const fill = el('div', 'cwi-prog-fill'); fill.style.width = '0%';
    track.appendChild(fill);
    const label = el('div', 'text-sm text-n-slate-11');
    modal.append(track, label);

    const log = await runImport({
      contacts: state.contacts,
      api,
      labelTitle: state.labelTitle,
      onProgress: (d, t) => {
        fill.style.width = (d / t * 100) + '%';
        label.textContent = `${d}/${t}`;
      },
    });
    stepDone(log);
  }

  function stepDone(log) {
    modal.replaceChildren();
    modal.appendChild(header(t('importDone'), ''));
    const s = log.summary();
    const summary = el('div', 'text-sm text-n-slate-12');
    summary.textContent = `${t('createdWord')} ${s.created} · ${t('updatedWord')} ${s.updated} · ${t('skippedWord')} ${s.skipped} · ${t('failedWord')} ${s.failed}`;
    modal.appendChild(summary);

    const dlBtn = btn('primary'); dlBtn.className += ' w-full';
    dlBtn.textContent = t('downloadReport');
    dlBtn.addEventListener('click', () => downloadCsv(log.toCsv(), 'import-log.csv'));

    const closeBtn = btn('ghost'); closeBtn.className += ' w-full';
    closeBtn.textContent = t('close');
    closeBtn.addEventListener('click', close);

    const bar = el('div', 'flex items-center justify-between w-full gap-3');
    bar.append(closeBtn, dlBtn);
    modal.appendChild(bar);
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────────
  function showError(msg) {
    const e = el('div', 'text-sm text-n-ruby-11');
    e.textContent = msg;
    modal.appendChild(e);
  }

  function previewTable(contacts) {
    const tbl = el('table', 'w-full text-sm border-collapse');
    const thead = el('tr');
    [t('thName'), t('thPhone'), t('thEmail'), t('thCompany')].forEach((h) => {
      const th = el('th', 'text-start font-medium text-n-slate-11 px-3 py-2 cwi-tbl-cell border-n-weak');
      th.textContent = h;
      thead.appendChild(th);
    });
    tbl.appendChild(thead);
    contacts.forEach((c) => {
      const row = el('tr');
      [c.name || '', c.phone_number || '', c.email || '', (c.additional_attributes || {}).company_name || ''].forEach((v) => {
        const td = el('td', 'px-3 py-2 cwi-tbl-cell border-n-weak text-n-slate-12');
        td.textContent = v;
        row.appendChild(td);
      });
      tbl.appendChild(row);
    });
    return tbl;
  }

  function footer({ onBack, onNext, onCancel, nextLabel }) {
    // Matches Dialog.vue footer: flex row, each button w-full.
    const bar = el('div', 'flex items-center justify-between w-full gap-3');
    if (onBack) {
      const b = btn('faded'); b.className += ' w-full'; b.textContent = t('back'); b.onclick = onBack; bar.appendChild(b);
    }
    if (onCancel) {
      const b = btn('ghost'); b.className += ' w-full'; b.textContent = t('cancel'); b.onclick = onCancel; bar.appendChild(b);
    }
    if (onNext) {
      const b = btn('primary'); b.className += ' w-full'; b.textContent = nextLabel || t('continue'); b.onclick = onNext; bar.appendChild(b);
    }
    return bar;
  }

  function formRow(labelText, control) {
    const wrap = el('div', 'flex flex-col gap-1');
    const lbl = el('label', 'text-sm text-n-slate-12 mb-1');
    lbl.textContent = labelText;
    wrap.append(lbl, control);
    return wrap;
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById('cwi-styles')) return;
  const s = document.createElement('style');
  s.id = 'cwi-styles';
  s.textContent = STYLES;
  document.head.appendChild(s);
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

// Chatwoot's Icon.vue renders `<span class="i-lucide-NAME">`; the dashboard CSS
// has these masks compiled globally (currentColor, sizes to font-size).
function icon(name, extra) {
  return el('span', 'i-lucide-' + name + (extra ? ' ' + extra : ''));
}

// Header block — matches Dialog.vue (flex-col gap-2, h3 + description p).
// `subtitle` may be a string or a DOM node (e.g. a <p> with a sample-CSV link).
function header(title, subtitle) {
  const wrap = el('div', 'flex flex-col gap-2');
  const h = el('h3', 'text-base font-medium leading-6 text-n-slate-12 m-0');
  h.textContent = title;
  wrap.appendChild(h);
  if (subtitle != null && subtitle !== '') {
    if (typeof subtitle === 'string') {
      const p = el('p', 'mb-0 text-sm text-n-slate-11');
      p.textContent = subtitle;
      wrap.appendChild(p);
    } else {
      wrap.appendChild(subtitle); // caller supplies its own <p>
    }
  }
  return wrap;
}

// Button.vue exact token classes + click animation.
const BTN_BASE = 'inline-flex items-center justify-center min-w-0 gap-2 transition-all duration-100 ease-out border-0 rounded-lg outline-1 outline disabled:opacity-50 active:enabled:scale-[0.97] text-sm font-medium';
function btn(variant) {
  const b = el('button', BTN_BASE + ' cursor-pointer');
  if (variant === 'primary') {
    b.className += ' bg-n-brand text-white hover:brightness-110 outline-transparent h-10 px-4';
  } else if (variant === 'faded') {
    b.className += ' bg-n-slate-9/10 text-n-slate-12 hover:bg-n-slate-9/20 outline-transparent h-10 px-4';
  } else {
    // ghost
    b.className += ' text-n-slate-12 hover:bg-n-alpha-2 outline-transparent h-8 px-3';
  }
  return b;
}

function elWithText(tag, cls, text) {
  const e = el(tag, cls);
  e.textContent = text;
  return e;
}

// Truncate long filenames the way ContactImportDialog's processFileName does
// (keep ~24 chars, ellipsis in the middle so the extension stays visible).
function processFileName(name) {
  const MAX = 24;
  if (!name || name.length <= MAX) return name || '';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const keep = MAX - ext.length - 1; // room for '…'
  if (keep <= 1) return name.slice(0, MAX - 1) + '…';
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return stem.slice(0, head) + '…' + stem.slice(stem.length - tail) + ext;
}

// Client-generated sample CSV — headers per locale (both header sets are recognized
// by columnDetector's bilingual SYNONYMS). BOM-prefixed so Excel opens UTF-8/Hebrew
// correctly; URL-encoded for a data: URL.
function sampleCsvHref() {
  const rows = DRIP_LOCALE === 'he' ? [
    'שם פרטי,שם משפחה,טלפון,אימייל,חברה',
    'ישראל,ישראלי,0501234567,israel@example.com,חברה בע"מ',
    'דנה,כהן,0527654321,dana@example.com,סטארטאפ',
  ] : [
    'First name,Last name,Phone,Email,Company',
    'John,Doe,+15551234567,john@example.com,Acme Inc.',
    'Jane,Smith,+15557654321,jane@example.com,Startup LLC',
  ];
  const BOM = '﻿';
  return 'data:text/csv;charset=utf-8,' + encodeURIComponent(BOM + rows.join('\r\n'));
}

function slugify(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9֐-׿]+/g, '_').replace(/^_|_$/g, '') || 'field';
}

function downloadCsv(content, name) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
