// import-button — injects a "Smart import" button into the Chatwoot contacts page header
// action row, which lazy-loads the smart-import bundle (built from the smart-import module's
// UI sources) and opens its wizard modal. Idempotent + try/catch — fails silently if the DOM
// shape changes; a MutationObserver retries.
(function () {
  if (window.__cwImportNav) return;
  window.__cwImportNav = true;
  var ADDONS_BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';
  var ASSET_VER = '__CWI_VER__'; // replaced by deploy with the bundle content hash (cache-bust)

  function accountId() { var m = location.pathname.match(/\/accounts\/(\d+)/); return m ? m[1] : ''; }

  // Same auth pattern as the campaign-modal enhancement: devise-token-auth headers from the
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
    if (window.__cwImport) return Promise.resolve(window.__cwImport);
    if (!bundle) {
      bundle = new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = ADDONS_BASE + '/smart-import/import-tool.js?v=' + ASSET_VER;
        s.onload = function () { res(window.__cwImport); };
        s.onerror = function () { bundle = null; rej(new Error('import-tool load failed')); };
        document.head.appendChild(s);
      });
    }
    return bundle;
  }

  function openImport() {
    var headers = authHeaders();
    if (!headers) { alert('שגיאת הזדהות — רענן את העמוד ונסה שוב'); return; }
    loadBundle().then(function (mod) {
      // assetBase is the raw addons base; the wizard derives its own vendor asset path from
      // it (see cw-import-tool/lib/basepath.js).
      mod.openWizard({ accountId: accountId(), authHeaders: headers, assetBase: ADDONS_BASE });
    }).catch(function (e) { alert('טעינת הכלי נכשלה: ' + e.message); });
  }

  // Inject "Smart import" into the stable Chatwoot contacts header action row. Idempotent +
  // try/catch — fails silently if the DOM shape changes; the MutationObserver retries.
  function inject() {
    try {
      if (!/\/contacts(\/|$|\?)/.test(location.pathname)) return;
      if (document.getElementById('cwi-open-btn')) return;
      var host = findActionBar();
      if (!host) return; // MutationObserver will retry — no floating fallback
      var btn = document.createElement('button');
      btn.id = 'cwi-open-btn';
      btn.innerHTML = '<span class="i-lucide-upload"></span><span>ייבוא חכם</span>';
      btn.className = 'cwi-open inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-n-brand text-white text-sm font-medium hover:brightness-110 outline outline-1 outline-transparent';
      btn.addEventListener('click', function (e) { e.preventDefault(); openImport(); });
      host.insertBefore(btn, host.firstChild); // first child = sits with the native header actions
    } catch (e) { /* never break Chatwoot */ }
  }

  // stable anchor — the contacts header action row, identified via the native filter button's id
  function findActionBar() {
    var fb = document.getElementById('toggleContactsFilterButton');
    return fb ? fb.parentElement : null;
  }

  var t;
  new MutationObserver(function () { clearTimeout(t); t = setTimeout(inject, 200); })
    .observe(document.body, { childList: true, subtree: true });
  setTimeout(inject, 600);
})();
