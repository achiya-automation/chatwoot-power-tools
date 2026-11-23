// import-button: the smart import inside Chatwoot's own New import dialog (Settings › Data ›
// New import). It names the CSV source for Excel too, takes over the file the user picks or
// drops, and lazy-loads the smart-import bundle (built from modules/smart-import/ui), which
// opens the mapping / label / pre-check box and hands Chatwoot a CSV in its own format.
// Chatwoot keeps the upload, the progress and the history. Whatever fails here, the original
// file still reaches Chatwoot untouched, so the native dialog never stops working.
(function () {
  if (window.__cwImportNav) return;
  window.__cwImportNav = true;
  var ADDONS_BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';
  var ASSET_VER = '__CWI_VER__'; // replaced by deploy with the bundle content hash (cache-bust)
  var INPUT_ID = 'contact-csv-file'; // NewImportDialog.vue
  var OWN = '__cwiOwn'; // events the bundle dispatches itself; every other one is the user's
  var ACCEPT = '.csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
  var MESSAGES = {
    he: { DATA_IMPORTS: { CSV: {
      SOURCE: 'קובץ CSV או Excel',
      FILE: 'קובץ CSV או Excel של אנשי קשר',
      FILE_LIMIT: 'CSV או Excel · עד 50 MiB',
      INVALID_FILE: 'בחרו קובץ CSV או Excel שאינו ריק, עד 50 MiB.',
    } } },
    en: { DATA_IMPORTS: { CSV: {
      SOURCE: 'CSV or Excel file',
      FILE: 'Contact CSV or Excel file',
      FILE_LIMIT: 'CSV or Excel · up to 50 MiB',
      INVALID_FILE: 'Choose a nonempty CSV or Excel file of 50 MiB or smaller.',
    } } },
  };

  function accountId() { var m = location.pathname.match(/\/accounts\/(\d+)/); return m ? m[1] : ''; }

  // Same auth pattern as the other dashboard parts: devise-token-auth headers from the
  // non-httpOnly cw_d_session_info cookie.
  function authHeaders() {
    try {
      var raw = (document.cookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
      if (!raw) return null;
      var d = JSON.parse(decodeURIComponent(raw));
      if (typeof d === 'string') d = JSON.parse(d);
      if (!d || !d['access-token']) return null;
      return { 'access-token': d['access-token'], 'token-type': d['token-type'], client: d.client, expiry: String(d.expiry), uid: d.uid };
    } catch (e) { return null; }
  }

  var bundle = null;
  function loadBundle() {
    if (window.__cwImport && window.__cwImport.take) return Promise.resolve(window.__cwImport);
    if (!bundle) {
      bundle = new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = ADDONS_BASE + '/smart-import/import-tool.js?v=' + ASSET_VER;
        function failed() { s.remove(); bundle = null; rej(new Error('import-tool load failed')); }
        s.onload = function () { if (window.__cwImport && window.__cwImport.take) res(window.__cwImport); else failed(); };
        s.onerror = failed;
        document.head.appendChild(s);
      });
    }
    return bundle;
  }

  function fire(el, type) {
    var e = new Event(type, { bubbles: true });
    e[OWN] = true;
    el.dispatchEvent(e);
  }

  // The file goes to Chatwoot exactly as the user picked it.
  function passThrough(input, file) {
    if (!input.isConnected) return;
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch (e) {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    }
    fire(input, 'change');
  }

  function take(input, file) {
    var acc = accountId();
    var headers = authHeaders();
    if (!acc || !headers) { passThrough(input, file); return; }
    loadBundle().then(function (mod) {
      return mod.take(input, file, { accountId: acc, authHeaders: headers, assetBase: ADDONS_BASE });
    }).catch(function () { passThrough(input, file); });
  }

  // Capture on document runs before Vue's own listeners on the input, the drop zone and the form.
  document.addEventListener('change', function (e) {
    var input = e.target;
    if (e[OWN] || !input || input.id !== INPUT_ID || !input.files || !input.files[0]) return;
    e.stopImmediatePropagation();
    take(input, input.files[0]);
  }, true);

  document.addEventListener('drop', function (e) {
    if (e[OWN]) return;
    var input = document.getElementById(INPUT_ID);
    var zone = input && input.parentElement;
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!zone || !file || input.disabled || !zone.contains(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    fire(zone, 'drop'); // a drop without files: useDropZone clears its highlight and its file
    take(input, file);
  }, true);

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.querySelector || !form.querySelector('#' + INPUT_ID)) return;
    if (window.__cwImport && window.__cwImport.submit && window.__cwImport.submit(form)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  function findI18n() {
    var apps = document.querySelectorAll('#app');
    for (var i = 0; i < apps.length; i++) {
      var app = apps[i].__vue_app__;
      var sym = app && app.__VUE_I18N_SYMBOL__;
      var inst = sym && app._context && app._context.provides && app._context.provides[sym];
      if (inst && inst.global && typeof inst.global.mergeLocaleMessage === 'function') return inst.global;
    }
    return null;
  }

  // Excel in the picker, and the CSV card named for Excel. Re-checked on every DOM change (cheap:
  // one lookup and two reads), so the wording comes back if native-i18n-he.js merges its stock
  // "CSV file" after this one, and is in place before the dialog paints.
  var merged = {};
  function sync() {
    try {
      var input = document.getElementById(INPUT_ID);
      if (input && input.accept !== ACCEPT) input.accept = ACCEPT;
      var g = findI18n();
      if (!g) return;
      ['he', 'en'].forEach(function (loc) {
        var have = typeof g.getLocaleMessage === 'function' ? g.getLocaleMessage(loc) : null;
        var csv = have && have.DATA_IMPORTS && have.DATA_IMPORTS.CSV;
        // Without a readable locale, merge once: a re-merge on every render would loop.
        if (csv ? csv.SOURCE === MESSAGES[loc].DATA_IMPORTS.CSV.SOURCE : merged[loc]) return;
        merged[loc] = true;
        g.mergeLocaleMessage(loc, MESSAGES[loc]);
      });
    } catch (e) { /* never break Chatwoot */ }
  }
  new MutationObserver(sync)
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  sync();
})();
