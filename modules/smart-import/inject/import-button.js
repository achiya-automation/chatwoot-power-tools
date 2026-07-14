// import-button — injects a "Smart import" button into the Chatwoot contacts page header
// action row, which lazy-loads the smart-import bundle (built from the smart-import module's
// UI sources) and opens its wizard modal. Idempotent + try/catch — fails silently if the DOM
// shape changes; a MutationObserver retries.
(function () {
  if (window.__cwImportNav) return;
  window.__cwImportNav = true;
  var ADDONS_BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';
  var ASSET_VER = '__CWI_VER__'; // replaced by deploy with the bundle content hash (cache-bust)

  // i18n: Hebrew for RTL (he) users, English otherwise — same #app[dir] signal the
  // campaign-modal enhancement and the import wizard use. he→Hebrew, ltr→English.
  // ⚠️ חייב להיות עצל. DASHBOARD_SCRIPTS רץ בתחתית <body> — לפני ש-Vue מרנדר, ולכן לפני
  // ש-#app[dir]="rtl" בכלל קיים (יש שני #app: העוטף של Vue, בלי dir, והשורש המרונדר, איתו).
  // חישוב חד-פעמי כאן ננעל על 'en' לנצח, וממשק עברי מקבל כפתור באנגלית. קוראים בזמן רינדור,
  // כמו sequences-nav ו-campaign-stats.
  function dripLocale() {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
  }
  var I18N = {
    he: { smartImport: 'ייבוא חכם', authError: 'שגיאת הזדהות — רענן את העמוד ונסה שוב', loadFailed: 'טעינת הכלי נכשלה: ' },
    en: { smartImport: 'Smart import', authError: 'Authentication error — refresh the page and try again', loadFailed: 'Failed to load the tool: ' },
  };
  function t(k) { return (I18N[dripLocale()] || I18N.en)[k] || I18N.en[k] || k; }

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
    if (!headers) { alert(t('authError')); return; }
    loadBundle().then(function (mod) {
      // assetBase is the raw addons base; the wizard derives its own vendor asset path from
      // it (see cw-import-tool/lib/basepath.js).
      mod.openWizard({ accountId: accountId(), authHeaders: headers, assetBase: ADDONS_BASE });
    }).catch(function (e) { alert(t('loadFailed') + e.message); });
  }

  // Inject "Smart import" into the stable Chatwoot contacts header action row. Idempotent +
  // try/catch — fails silently if the DOM shape changes; the MutationObserver retries.
  function inject() {
    try {
      if (!/\/contacts(\/|$|\?)/.test(location.pathname)) return;
      var host = findActionBar();
      if (!host) return; // MutationObserver will retry — no floating fallback
      var btn = document.getElementById('cwi-open-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'cwi-open-btn';
        btn.className = 'cwi-open inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-n-brand text-white text-sm font-medium hover:brightness-110 outline outline-1 outline-transparent';
        btn.addEventListener('click', function (e) { e.preventDefault(); openImport(); });
        host.insertBefore(btn, host.firstChild); // first child = sits with the native header actions
      }
      // ⚠️ התווית נכתבת מחדש כשהשפה משתנה — לא נקבעת פעם אחת ביצירה.
      // Chatwoot קובע #app[dir]="rtl" רק אחרי שנתוני החשבון נטענים, כלומר יש חלון שבו הממשק
      // עדיין נראה LTR. כפתור שנוצר בחלון הזה עם תווית קפואה נשאר "Smart import" בממשק עברי
      // לנצח. עצלות ב-dripLocale() לבדה לא מספיקה — צריך גם לרנדר שוב.
      var loc = dripLocale();
      if (btn.__cwiLocale !== loc) {
        btn.__cwiLocale = loc;
        btn.innerHTML = '<span class="i-lucide-upload"></span><span>' + t('smartImport') + '</span>';
      }
    } catch (e) { /* never break Chatwoot */ }
  }

  // stable anchor — the contacts header action row, identified via the native filter button's id
  function findActionBar() {
    var fb = document.getElementById('toggleContactsFilterButton');
    return fb ? fb.parentElement : null;
  }

  // ⚠️ לא לקרוא למשתנה הזה t — t() היא פונקציית התרגום למעלה. השמה כאן דורסת אותה במזהה
  // הטיימר, ואז t('smartImport') זורק TypeError שנבלע ב-catch של inject() → הכפתור נעלם בשקט.
  var timer;
  function schedule() { clearTimeout(timer); timer = setTimeout(inject, 200); }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  // dir מתחלף על #app כשפרטי החשבון נטענים (ובהחלפת שפה) — שינוי ATTRIBUTE, שה-observer
  // למעלה לא רואה (childList בלבד). בלי זה התווית לא תתעדכן לעולם.
  new MutationObserver(schedule)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['dir'], subtree: true });
  setTimeout(inject, 600);
})();
