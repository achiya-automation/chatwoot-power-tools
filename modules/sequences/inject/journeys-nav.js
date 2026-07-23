// journeys-nav — injected as part of DASHBOARD_SCRIPTS (see sequences-nav.js for the full
// mechanism). Adds a top-level "בונה פלואו" sidebar item right after the Templates item
// (falling back to the Sequences group when Templates is absent), visible ONLY to
// administrators — building flows is admin work (the engine enforces the same on jrn_
// management actions). Clicking opens the shared inline panel on tab=journeys.
// Own <script> block (own IIFE scope) — small helpers duplicated on purpose, same as
// templates-nav.js documents.
(function () {
  if (window.__jrnNav) return;
  window.__jrnNav = true;

  function dripLocale() {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
  }
  var I18N = {
    he: { label: 'בונה פלואו' },
    en: { label: 'Flow Builder' },
  };
  function jrnLabel() { return (I18N[dripLocale()] || I18N.en).label; }

  var LI_CLASS = 'py-0.5 ltr:pl-2 rtl:pr-2 rtl:mr-3 ltr:ml-3 relative text-n-slate-11 child-item before:bg-n-slate-4 after:bg-transparent after:border-n-slate-4 before:left-0 rtl:before:right-0 min-w-0';
  var A_CLASS  = 'flex h-8 items-center gap-2 px-2 py-1 rounded-lg hover:bg-gradient-to-r from-transparent via-n-slate-3/70 to-n-slate-3/70 group min-w-0';
  var LBL_CLASS = 'flex-1 truncate min-w-0 text-sm';
  // lucide "workflow" — two nodes joined by a connector, matches the flow-canvas idea.
  var ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1rem;height:1rem;display:inline-block;">' +
    '<rect width="8" height="8" x="3" y="3" rx="2"/>' +
    '<path d="M7 11v4a2 2 0 0 0 2 2h4"/>' +
    '<rect width="8" height="8" x="13" y="13" rx="2"/></svg>';

  function accountId() {
    var m = location.pathname.match(/\/accounts\/(\d+)/);
    return m ? m[1] : '';
  }

  function authHeaders() {
    try {
      var raw = (document.cookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
      if (!raw) return null;
      var d = JSON.parse(decodeURIComponent(raw));
      if (typeof d === 'string') d = JSON.parse(d);
      if (!d || !d['access-token']) return null;
      return {
        'access-token': d['access-token'],
        'token-type': d['token-type'] || 'Bearer',
        client: d.client, expiry: d.expiry, uid: d.uid,
      };
    } catch (e) { return null; }
  }

  // admin check — cached per accountId, fail-closed (no flash of a link that 403s).
  var ACCESS_CACHE = {};
  var ACCESS_PENDING = {};
  function profileIsAdmin(accId) {
    var headers = authHeaders() || {};
    headers.Accept = 'application/json';
    return fetch('/api/v1/profile', { credentials: 'same-origin', headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (profile) {
        var accounts = (profile && profile.accounts) || [];
        for (var i = 0; i < accounts.length; i++) {
          if (String(accounts[i].id) === String(accId) && accounts[i].role === 'administrator') return true;
        }
        return false;
      });
  }
  function mayBuild(accId, cb) {
    if (Object.prototype.hasOwnProperty.call(ACCESS_CACHE, accId)) { cb(ACCESS_CACHE[accId]); return; }
    if (ACCESS_PENDING[accId]) return;
    ACCESS_PENDING[accId] = true;
    profileIsAdmin(accId)
      .catch(function () { return false; })
      .then(function (ok) {
        ACCESS_CACHE[accId] = !!ok;
        ACCESS_PENDING[accId] = false;
        cb(!!ok);
      });
  }

  function removeItem() {
    var li = document.getElementById('jrn-nav-item');
    if (li && li.parentElement) li.parentElement.removeChild(li);
  }

  function inject() {
    if (document.getElementById('jrn-nav-item')) return;
    var anchor = document.getElementById('tpl-nav-item') || document.getElementById('drip-nav-item');
    if (!anchor || !anchor.parentElement) return;

    var li = document.createElement('li');
    li.id = 'jrn-nav-item';
    li.className = LI_CLASS;

    var a = document.createElement('a');
    a.className = A_CLASS;
    a.style.cursor = 'pointer';

    var icon = document.createElement('span');
    icon.className = 'size-4';
    icon.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
    icon.innerHTML = ICON;
    a.appendChild(icon);

    var lbl = document.createElement('div');
    lbl.className = LBL_CLASS;
    a.appendChild(lbl);
    li.appendChild(a);

    li.__jrnLocale = dripLocale();
    var text = jrnLabel();
    lbl.textContent = text;
    a.setAttribute('title', text);

    anchor.parentElement.insertBefore(li, anchor.nextSibling);
    markActive();
  }

  function relabel() {
    var li = document.getElementById('jrn-nav-item');
    if (!li) return;
    var loc = dripLocale();
    if (li.__jrnLocale === loc) return;
    li.__jrnLocale = loc;
    var text = jrnLabel();
    var lbl = li.querySelector('a > div');
    if (lbl) lbl.textContent = text;
    var a = li.querySelector('a');
    if (a) a.setAttribute('title', text);
  }

  function markActive() {
    var li = document.getElementById('jrn-nav-item');
    if (!li) return;
    var a = li.querySelector('a');
    if (!a) return;
    var t;
    try { t = new URL(location.href).searchParams.get('drip'); } catch (e) { t = null; }
    if (t === 'journeys') a.classList.add('bg-n-alpha-2', 'text-n-slate-12', 'font-medium');
    else a.classList.remove('bg-n-alpha-2', 'text-n-slate-12', 'font-medium');
  }

  function tick() {
    var accId = accountId();
    if (!accId) return;
    mayBuild(accId, function (ok) {
      if (accountId() !== accId) return;
      if (ok) { inject(); relabel(); markActive(); }
      else removeItem();
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var item = document.getElementById('jrn-nav-item');
    var link = e.target.closest('a');
    if (item && link && item.contains(link)) {
      e.preventDefault(); e.stopPropagation();
      if (window.__dripShowPanel) window.__dripShowPanel('journeys');
      markActive();
    }
  }, true);
  window.addEventListener('popstate', markActive);
  setInterval(markActive, 1000);

  new MutationObserver(function () { relabel(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['dir'], subtree: true });

  var navTimer;
  new MutationObserver(function () { clearTimeout(navTimer); navTimer = setTimeout(tick, 150); })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(tick, 500);
})();
