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

  // Top-level item — native childless-group styling (see templates-nav.js for the 4.16.1
  // provenance of these class strings; the old child-item/unprefixed-hover classes rendered
  // an orphan tree line and no hover highlight at all).
  var LI_CLASS = 'grid gap-1 text-sm cursor-pointer select-none min-w-0';
  var A_CLASS = 'flex items-center gap-2 px-1.5 py-1 rounded-lg h-8 min-w-0';
  var A_IDLE = ['text-n-slate-11', 'hover:bg-n-alpha-2'];
  var A_ACTIVE = ['text-n-slate-12', 'bg-n-alpha-2', 'font-medium'];

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

  // sidebar mode follows #drip-nav-item (detected by sequences-nav.js) — see templates-nav.js
  function sidebarMode() {
    var seq = document.getElementById('drip-nav-item');
    return seq ? (seq.getAttribute('data-drip-mode') || 'expanded') : null;
  }

  function inject() {
    var mode = sidebarMode();
    if (!mode) return;
    var existing = document.getElementById('jrn-nav-item');
    if (existing && existing.getAttribute('data-jrn-mode') === mode) return;
    if (existing) existing.remove();
    var anchor = document.getElementById('tpl-nav-item') || document.getElementById('drip-nav-item');
    if (!anchor || !anchor.parentElement) return;

    var li = document.createElement('li');
    li.id = 'jrn-nav-item';
    li.setAttribute('data-jrn-mode', mode);
    var text = jrnLabel();
    li.__jrnLocale = dripLocale();

    if (mode === 'collapsed') {
      li.className = 'grid gap-1 text-sm cursor-pointer select-none min-w-0';
      var btn = document.createElement('a');
      btn.className = 'flex items-center justify-center size-10 rounded-lg text-n-slate-11 hover:bg-n-alpha-2';
      btn.style.cursor = 'pointer';
      btn.setAttribute('title', text);
      var cicon = document.createElement('span');
      cicon.className = 'i-lucide-workflow size-4';
      btn.appendChild(cicon);
      li.appendChild(btn);
    } else {
      li.className = LI_CLASS;
      var a = document.createElement('a');
      a.className = A_CLASS + ' ' + A_IDLE.join(' ');
      a.style.cursor = 'pointer';

      // i-lucide-workflow is bundled in Chatwoot's compiled icon CSS (verified) — render it
      // exactly like a native sidebar icon (mask span), no inline SVG needed.
      var icon = document.createElement('span');
      icon.className = 'i-lucide-workflow size-4';
      a.appendChild(icon);

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
    var lbl = li.querySelector('span.truncate');
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
    var on = t === 'journeys';
    if (li.getAttribute('data-jrn-mode') === 'collapsed') {
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
      a.classList.remove('text-n-slate-11');
      if (span) { span.classList.remove('text-body-main'); span.classList.add('font-medium', 'text-sm'); }
    } else {
      a.classList.remove.apply(a.classList, A_ACTIVE);
      a.classList.add('text-n-slate-11');
      if (span) { span.classList.add('text-body-main'); span.classList.remove('font-medium', 'text-sm'); }
    }
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
