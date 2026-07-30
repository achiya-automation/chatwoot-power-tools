// templates-nav — injected as part of DASHBOARD_SCRIPTS (see sequences-nav.js for the full
// mechanism). Adds a single top-level "WhatsApp Templates" sidebar item, right after the
// "WhatsApp Sequences" group (#drip-nav-item), visible ONLY to administrators of the current
// account and to users an administrator granted access to (see mayUseTemplates below —
// same two doors the engine enforces). Clicking it opens the same inline panel
// sequences-nav.js already builds, on
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

  // This item is TOP-LEVEL (sibling of the #drip-nav-item group), so it must look like a
  // native childless sidebar group — NOT like a sub-item (the old child-item/tree-line
  // classes drew an orphan tree connector and their unprefixed hover class doesn't even
  // exist in Chatwoot 4.16 compiled CSS → no hover at all). Class strings below are copied
  // from SidebarGroup.vue / SidebarGroupHeader.vue (4.16.1):
  var LI_CLASS = 'grid gap-1 text-sm cursor-pointer select-none min-w-0';
  var A_CLASS = 'flex items-center gap-2 px-1.5 py-1 rounded-lg h-8 min-w-0';
  var A_IDLE = ['text-n-slate-11', 'hover:bg-n-alpha-2'];
  var A_ACTIVE = ['text-n-slate-12', 'bg-n-alpha-2', 'font-medium'];
  // lucide "layout-template" — NOT bundled in Chatwoot's compiled icon CSS (verified), so an
  // inline SVG with the exact native size (size-4 = 16px) stands in for the mask icon.
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

  // access check — fetched once per accountId, cached; any error → false (fail-closed, the
  // nav item simply never appears — safer than a flash of a link that then 403s).
  //
  // Two doors, same order the engine uses (api.js mayUseTemplates): administrator of THIS
  // account from the Chatwoot profile, or — when they're not — a grant an administrator gave
  // them (drip.template_access). The grant lives in the engine's DB, so only the engine can
  // answer that; tpl_my_access is the one tpl_ action open to every member of the account.
  var ADDONS_BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';
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

  function grantedByAdmin(accId) {
    return fetch(ADDONS_BASE + '/drip-api?account_id=' + encodeURIComponent(accId), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tpl_my_access', payload: {} }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return !!(j && j.data && j.data.allowed); });
  }

  function mayUseTemplates(accId, cb) {
    if (Object.prototype.hasOwnProperty.call(ACCESS_CACHE, accId)) { cb(ACCESS_CACHE[accId]); return; }
    if (ACCESS_PENDING[accId]) return; // already in flight — the tick that started it will cache the result
    ACCESS_PENDING[accId] = true;
    profileIsAdmin(accId)
      .then(function (admin) { return admin || grantedByAdmin(accId); })
      .catch(function () { return false; })
      .then(function (ok) {
        ACCESS_CACHE[accId] = !!ok;
        ACCESS_PENDING[accId] = false;
        cb(!!ok);
      });
  }

  function removeItem() {
    var li = document.getElementById('tpl-nav-item');
    if (li && li.parentElement) li.parentElement.removeChild(li);
  }

  // The sidebar mode (expanded rail vs icon-only collapsed rail) is already detected by
  // sequences-nav.js and stamped on #drip-nav-item — follow it, so all injected items flip
  // together. In collapsed mode a childless item is just an icon-only size-10 button
  // (SidebarGroup.vue collapsed template), no label, tooltip = title.
  function sidebarMode() {
    var seq = document.getElementById('drip-nav-item');
    return seq ? (seq.getAttribute('data-drip-mode') || 'expanded') : null;
  }

  // idempotent — builds a fresh <li> right after #drip-nav-item, rebuilt when the sidebar
  // mode flips. Live updates (label on dir flip, active class on ?drip=) are separate
  // functions below, not re-runs of this one.
  function inject() {
    var mode = sidebarMode();
    if (!mode) return;
    var existing = document.getElementById('tpl-nav-item');
    if (existing && existing.getAttribute('data-tpl-mode') === mode) return;
    if (existing) existing.remove();
    var seq = document.getElementById('drip-nav-item');
    if (!seq || !seq.parentElement) return;

    var li = document.createElement('li');
    li.id = 'tpl-nav-item';
    li.setAttribute('data-tpl-mode', mode);
    var text = tplLabel();
    li.__tplLocale = dripLocale();

    if (mode === 'collapsed') {
      li.className = 'grid gap-1 text-sm cursor-pointer select-none min-w-0';
      var colWrap = document.createElement('div');
      colWrap.className = 'relative';
      var btn = document.createElement('a');
      btn.className = 'flex items-center justify-center size-10 rounded-lg text-n-slate-11 hover:bg-n-alpha-2';
      btn.style.cursor = 'pointer';
      btn.setAttribute('title', text);
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.setAttribute('draggable', 'false');
      var cicon = document.createElement('span');
      cicon.className = 'size-4';
      cicon.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
      cicon.innerHTML = ICON;
      btn.appendChild(cicon);
      colWrap.appendChild(btn);
      li.appendChild(colWrap);
    } else {
      li.className = LI_CLASS;
      // native SidebarGroupHeader structure: icon span (size-4) + label wrapper (flex-grow) +
      // span.truncate carrying the weight class (text-body-main idle / font-medium text-sm active)
      var a = document.createElement('a');
      a.className = A_CLASS + ' ' + A_IDLE.join(' ');
      a.style.cursor = 'pointer';
      a.setAttribute('role', 'button');
      a.setAttribute('tabindex', '0');
      a.setAttribute('draggable', 'false');

      var iconWrap = document.createElement('div');
      iconWrap.className = 'relative flex items-center gap-2';
      var icon = document.createElement('span');
      icon.className = 'size-4';
      icon.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
      icon.innerHTML = ICON;
      iconWrap.appendChild(icon);
      a.appendChild(iconWrap);

      var wrap = document.createElement('div');
      wrap.className = 'flex items-center gap-1.5 flex-grow justify-between min-w-0 flex-1';
      var lbl = document.createElement('span');
      lbl.className = 'truncate text-body-main';
      lbl.textContent = text;
      wrap.appendChild(lbl);
      a.appendChild(wrap);
      a.setAttribute('title', text);
      li.appendChild(a);
    }

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
    var lbl = li.querySelector('span.truncate');
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
    var on = t === 'templates';
    if (li.getAttribute('data-tpl-mode') === 'collapsed') {
      // icon-only trigger: active = text-n-slate-12 bg-n-alpha-2 (SidebarGroup.vue collapsed)
      if (on) {
        a.classList.add('text-n-slate-12', 'bg-n-alpha-2');
        a.classList.remove('text-n-slate-11', 'hover:bg-n-alpha-2');
      } else {
        a.classList.remove('text-n-slate-12', 'bg-n-alpha-2');
        a.classList.add('text-n-slate-11', 'hover:bg-n-alpha-2');
      }
      return;
    }
    var span = li.querySelector('span.truncate');
    if (on) {
      a.classList.add.apply(a.classList, A_ACTIVE);
      a.classList.remove('text-n-slate-11', 'hover:bg-n-alpha-2');
      if (span) { span.classList.remove('text-body-main'); span.classList.add('font-medium', 'text-sm'); }
    } else {
      a.classList.remove.apply(a.classList, A_ACTIVE);
      a.classList.add('text-n-slate-11', 'hover:bg-n-alpha-2');
      if (span) { span.classList.add('text-body-main'); span.classList.remove('font-medium', 'text-sm'); }
    }
  }

  // one tick = re-check access (cached per accountId) → inject/remove + refresh label/active state.
  function tick() {
    var accId = accountId();
    if (!accId) return;
    mayUseTemplates(accId, function (ok) {
      if (accountId() !== accId) return; // account switched again while the fetch was in flight
      if (ok) { inject(); relabel(); markActive(); }
      else removeItem();
    });
  }

  // event delegation — immune to Vue re-renders (same idiom as sequences-nav.js)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!e.target.closest) return;
    var item = document.getElementById('tpl-nav-item');
    var link = e.target.closest('a');
    if (item && link && item.contains(link)) { e.preventDefault(); link.click(); }
  }, true);

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

  // register for the synchronous mode-flip ping from sequences-nav.js (the mode authority) —
  // when the rail collapses/expands, all injected items must flip in the same task, not each
  // on its own observer delay.
  window.__cwptNavPing = window.__cwptNavPing || [];
  window.__cwptNavPing.push(tick);

  // throttle with a guaranteed run (not a trailing debounce) — a mutation storm during a
  // sidebar drag must not starve the rebuild (see sequences-nav.js bootstrap note).
  var navTimer = null;
  new MutationObserver(function () {
    if (navTimer) return;
    navTimer = setTimeout(function () { navTimer = null; tick(); }, 120);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(tick, 500);
})();
