// templates-nav — injected as part of DASHBOARD_SCRIPTS (see sequences-nav.js for the full
// mechanism). Adds a single top-level "WhatsApp Templates" sidebar item, right after the
// "WhatsApp Sequences" group (#drip-nav-item), visible ONLY to administrators of the current
// account. Clicking it opens the same inline panel sequences-nav.js already builds, on
// tab=templates (window.__dripShowPanel, exported by sequences-nav.js). This file is its own
// <script> block (own IIFE scope) — it shares window/document with sequences-nav.js but not
// its local variables, so small helpers (dripLocale, accountId) are duplicated on purpose,
// same as campaign-modal.js already does.
(function () {
  if (window.__tplNav) return;
  window.__tplNav = true;

  function dripLocale() {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
  }
  var I18N = {
    he: { label: 'תבניות WhatsApp' },
    en: { label: 'WhatsApp Templates' },
  };
  function tplLabel() { return (I18N[dripLocale()] || I18N.en).label; }

  // exact classes lifted from sequences-nav.js's own sub-item structure (LI/A/LBL) — this item
  // is top-level (sibling of #drip-nav-item), not a sequences sub-tab, but reuses the same
  // small/single-line styling rather than cloning the heavier expandable-group markup.
  var LI_CLASS = 'py-0.5 ltr:pl-2 rtl:pr-2 rtl:mr-3 ltr:ml-3 relative text-n-slate-11 child-item before:bg-n-slate-4 after:bg-transparent after:border-n-slate-4 before:left-0 rtl:before:right-0 min-w-0';
  var A_CLASS  = 'flex h-8 items-center gap-2 px-2 py-1 rounded-lg hover:bg-gradient-to-r from-transparent via-n-slate-3/70 to-n-slate-3/70 group min-w-0';
  var LBL_CLASS = 'flex-1 truncate min-w-0 text-sm';
  // lucide "layout-template" — header bar + two columns, same viewBox/stroke style as
  // sequences-nav.js's LAYERS icon.
  var ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1rem;height:1rem;display:inline-block;">' +
    '<rect width="18" height="7" x="3" y="3" rx="1"/>' +
    '<rect width="9" height="7" x="3" y="14" rx="1"/>' +
    '<rect width="5" height="7" x="16" y="14" rx="1"/></svg>';

  function accountId() {
    var m = location.pathname.match(/\/accounts\/(\d+)/);
    return m ? m[1] : '';
  }

  // Chatwoot's API requires devise-token-auth headers (not just the session cookie) — same
  // cw_d_session_info cookie parsing as campaign-modal.js's getChatwootAuthHeaders().
  function authHeaders() {
    try {
      var raw = (document.cookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
      if (!raw) return null;
      var d = JSON.parse(decodeURIComponent(raw));
      if (typeof d === 'string') d = JSON.parse(d);   // js-cookie sometimes wraps the JSON as a string
      if (!d || !d['access-token']) return null;
      return {
        'access-token': d['access-token'],
        'token-type': d['token-type'] || 'Bearer',
        client: d.client, expiry: d.expiry, uid: d.uid,
      };
    } catch (e) { return null; }
  }

  // admin check — fetched once per accountId, cached; any error/non-admin → false (fail-closed,
  // the nav item simply never appears — safer than a flash of a link that then 403s).
  var ADMIN_CACHE = {};
  var ADMIN_PENDING = {};
  function isAdmin(accId, cb) {
    if (Object.prototype.hasOwnProperty.call(ADMIN_CACHE, accId)) { cb(ADMIN_CACHE[accId]); return; }
    if (ADMIN_PENDING[accId]) return; // already in flight — the tick that started it will cache the result
    ADMIN_PENDING[accId] = true;
    var headers = authHeaders() || {};
    headers.Accept = 'application/json';
    fetch('/api/v1/profile', { credentials: 'same-origin', headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (profile) {
        var ok = false;
        var accounts = (profile && profile.accounts) || [];
        for (var i = 0; i < accounts.length; i++) {
          if (String(accounts[i].id) === String(accId) && accounts[i].role === 'administrator') { ok = true; break; }
        }
        ADMIN_CACHE[accId] = ok;
        ADMIN_PENDING[accId] = false;
        cb(ok);
      })
      .catch(function () {
        ADMIN_CACHE[accId] = false;
        ADMIN_PENDING[accId] = false;
        cb(false);
      });
  }

  function removeItem() {
    var li = document.getElementById('tpl-nav-item');
    if (li && li.parentElement) li.parentElement.removeChild(li);
  }

  // idempotent — builds a fresh <li> once, right after #drip-nav-item. Live updates (label on
  // dir flip, active class on ?drip=) are separate functions below, not re-runs of this one.
  function inject() {
    if (document.getElementById('tpl-nav-item')) return;
    var seq = document.getElementById('drip-nav-item');
    if (!seq || !seq.parentElement) return;

    var li = document.createElement('li');
    li.id = 'tpl-nav-item';
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

    li.__tplLocale = dripLocale();
    var text = tplLabel();
    lbl.textContent = text;
    a.setAttribute('title', text);

    seq.parentElement.insertBefore(li, seq.nextSibling);
    markActive();
  }

  // re-render the label when #app[dir] flips (he/en depend on it, computed at render time —
  // caching the locale once at load time is the documented failure mode: Vue hasn't set dir
  // yet when this script runs, so a one-time read would freeze on 'en' forever).
  function relabel() {
    var li = document.getElementById('tpl-nav-item');
    if (!li) return;
    var loc = dripLocale();
    if (li.__tplLocale === loc) return;
    li.__tplLocale = loc;
    var text = tplLabel();
    var lbl = li.querySelector('a > div');
    if (lbl) lbl.textContent = text;
    var a = li.querySelector('a');
    if (a) a.setAttribute('title', text);
  }

  function markActive() {
    var li = document.getElementById('tpl-nav-item');
    if (!li) return;
    var a = li.querySelector('a');
    if (!a) return;
    var t;
    try { t = new URL(location.href).searchParams.get('drip'); } catch (e) { t = null; }
    if (t === 'templates') a.classList.add('bg-n-alpha-2', 'text-n-slate-12', 'font-medium');
    else a.classList.remove('bg-n-alpha-2', 'text-n-slate-12', 'font-medium');
  }

  // one tick = re-check admin (cached per accountId) → inject/remove + refresh label/active state.
  function tick() {
    var accId = accountId();
    if (!accId) return;
    isAdmin(accId, function (ok) {
      if (accountId() !== accId) return; // account switched again while the fetch was in flight
      if (ok) { inject(); relabel(); markActive(); }
      else removeItem();
    });
  }

  // event delegation — immune to Vue re-renders (same idiom as sequences-nav.js)
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var item = document.getElementById('tpl-nav-item');
    var link = e.target.closest('a');
    if (item && link && item.contains(link)) {
      e.preventDefault(); e.stopPropagation();
      if (window.__dripShowPanel) window.__dripShowPanel('templates');
      markActive(); // highlight on immediately — don't wait for the poll below
    }
  }, true);
  window.addEventListener('popstate', markActive);

  // sequences-nav.js's own sub-item clicks (and hide()) switch tabs via pushState/postMessage,
  // not a DOM event this module can observe — there is no reliable hook for "the panel switched
  // away from templates" or "templates was already open when I arrived". A 1s self-healing poll
  // re-reads ?drip= and syncs the highlight either way; the top-of-file window.__tplNav guard
  // means this IIFE runs once per page load, so exactly one interval is ever created.
  setInterval(markActive, 1000);

  // dedicated dir observer — only relabels, never re-checks admin/injects
  new MutationObserver(function () { relabel(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['dir'], subtree: true });

  // bootstrap: re-tick as Chatwoot's own Vue app re-renders the sidebar (mirrors sequences-nav.js)
  var navTimer;
  new MutationObserver(function () { clearTimeout(navTimer); navTimer = setTimeout(tick, 150); })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(tick, 500);
})();
