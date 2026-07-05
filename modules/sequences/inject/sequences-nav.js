// sequences-nav — injected as part of DASHBOARD_SCRIPTS (Chatwoot's InstallationConfig hook,
// loaded last in <body> on every dashboard page except login). Adds "WhatsApp Sequences" as a
// top-level nav group in the sidebar (after "Campaigns"), with 3 sub-items (overview /
// sequences / contacts) — exactly like Chatwoot's built-in features. Clicking a sub-item shows
// the sequences dashboard inline (filling <main>) and swaps tabs smoothly (postMessage). State
// persists in sessionStorage + the URL so a refresh stays on the same tab. Instance-wide.
// DOM-dependent (sidebar components-next) — fails silently if the structure changes.
//
// Note: Chatwoot only renders the sub-items <ul> while the group is expanded (v-if), so we
// *build* the <ul> from scratch with the exact classes (not cloned — at inject time
// "Campaigns" may be collapsed, so there's no <ul> to clone).
(function () {
  if (window.__dripNav) return;
  window.__dripNav = true;
  var ADDONS_BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';

  // ── disable Chatwoot's native highlight while the sequences panel is open ──
  // The panel is an overlay on the current route (URL=?drip=, the path itself doesn't
  // change), so the Vue router keeps the native active highlight (bg-n-alpha-2) on the
  // route's nav item → two items look active at once. A CSS override + a class on <body>
  // disables the native highlight (immune to Vue — it doesn't fight over a class Vue itself
  // manages).
  (function () {
    var st = document.createElement('style');
    st.textContent = 'body.drip-active a[href*="/accounts/"].router-link-active.bg-n-alpha-2{background-color:transparent !important;}';
    (document.head || document.documentElement).appendChild(st);
  })();
  var APP = ADDONS_BASE; // same-origin (single route /chatwoot-addons/*) — zero CORS/CSP

  // ── i18n: עברית ל-RTL (he), אנגלית לכל השאר — בדיוק כמו campaign-modal. Chatwoot לא
  // שם locale על ה-DOM, אבל מגדיר #app[dir]=rtl רק לעברית (אותו אות שה-theme משתמש בו). ──
  function dripLocale() {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
  }
  var NAV_I18N = {
    he: { title: 'רצפי WhatsApp', overview: 'סקירה', sequences: 'רצפים', contacts: 'אנשי קשר' },
    en: { title: 'WhatsApp Sequences', overview: 'Overview', sequences: 'Sequences', contacts: 'Contacts' },
  };
  function navLabels() { return NAV_I18N[dripLocale()] || NAV_I18N.en; }
  var TAB_KEYS = ['overview', 'sequences', 'contacts'];
  // exact classes lifted from Chatwoot's own DOM (components-next sidebar)
  var UL_CLASS = 'grid m-0 list-none sidebar-group-children min-w-0';
  var LI_CLASS = 'py-0.5 ltr:pl-2 rtl:pr-2 rtl:mr-3 ltr:ml-3 relative text-n-slate-11 child-item before:bg-n-slate-4 after:bg-transparent after:border-n-slate-4 before:left-0 rtl:before:right-0 min-w-0';
  var A_CLASS  = 'flex h-8 items-center gap-2 px-2 py-1 rounded-lg hover:bg-gradient-to-r from-transparent via-n-slate-3/70 to-n-slate-3/70 group min-w-0';
  var LBL_CLASS = 'flex-1 truncate min-w-0 text-sm';
  var LAYERS =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1rem;height:1rem;display:inline-block;">' +
    '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/>' +
    '<path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>' +
    '<path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>';

  function accountId() {
    var m = location.pathname.match(/\/accounts\/(\d+)/);
    return m ? m[1] : '';
  }
  function isDark() { return document.body.classList.contains('dark'); }
  function contentArea() {
    var mains = document.querySelectorAll('main'), best = null, ba = 0;
    for (var i = 0; i < mains.length; i++) {
      var r = mains[i].getBoundingClientRect(), a = r.width * r.height;
      if (r.width > 500 && r.height > 300 && a > ba) { ba = a; best = mains[i]; }
    }
    return best || document.querySelector('div.overflow-auto.bg-n-surface-1') || document.body;
  }

  // ── URL sync ("built-in" deep-link) ─────────────────────────────────────────
  // The active tab is persisted as ?drip= on Chatwoot's current route. Verified empirically:
  // a clean path (/app/accounts/N/sequences) gets overwritten by the Vue router back to the
  // dashboard on a hard refresh, so a query param (which survives a refresh — the router
  // ignores it) is the stable, non-breaking approach. We keep a reference to the original
  // pushState/replaceState so pushing our own state bypasses the interceptor (below) that
  // hides the panel on every navigation — otherwise we'd hide ourselves / loop.
  var _pushState = history.pushState.bind(history);
  var _replaceState = history.replaceState.bind(history);
  function dripFromUrl() {
    try {
      var t = new URL(location.href).searchParams.get('drip');
      return (t === 'overview' || t === 'sequences' || t === 'contacts') ? t : null;
    } catch (e) { return null; }
  }
  function urlWithDrip(tab) {
    var u = new URL(location.href); u.searchParams.set('drip', tab);
    return u.pathname + u.search + u.hash;
  }
  function urlWithoutDrip() {
    var u = new URL(location.href); u.searchParams.delete('drip');
    return u.pathname + u.search + u.hash;
  }
  // back/forward fallback: Chatwoot's Vue router keeps the route in history.state.current,
  // and location.search can lag behind it right after popstate. Read the param from there as
  // a fallback (graceful — if the state shape changes in a Chatwoot upgrade, this just
  // returns null and we fall back to hide(), no breakage).
  function dripFromState() {
    try {
      var cur = history.state && history.state.current;
      var m = cur && String(cur).match(/[?&]drip=(overview|sequences|contacts)\b/);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  var holder = null, frame = null, shown = false, loaded = false, curTab = 'overview', restored = false, restoreGuard = false;

  function build() {
    holder = document.createElement('div');
    holder.id = 'drip-inline';
    holder.style.cssText = 'position:fixed;z-index:40;display:none;background:rgb(var(--n-background));';
    frame = document.createElement('iframe');
    frame.title = navLabels().title;
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    holder.appendChild(frame);
    document.body.appendChild(holder);
  }
  function position() {
    if (!holder || !shown) return;
    var r = contentArea().getBoundingClientRect();
    var top = Math.max(0, r.top);
    holder.style.top = top + 'px';
    holder.style.left = r.left + 'px';
    holder.style.width = r.width + 'px';
    holder.style.height = (window.innerHeight - top) + 'px';
  }
  function markActiveSub(tab) {
    var item = document.getElementById('drip-nav-item'); if (!item) return;
    var subs = item.querySelectorAll('[data-drip-tab]');
    for (var i = 0; i < subs.length; i++) {
      var a = subs[i].querySelector('a') || subs[i];
      if (tab && subs[i].getAttribute('data-drip-tab') === tab) a.classList.add('bg-n-alpha-2', 'text-n-slate-12', 'font-medium');
      else a.classList.remove('bg-n-alpha-2', 'text-n-slate-12', 'font-medium');
    }
  }
  function show(tab) {
    tab = tab || 'overview';
    curTab = tab;
    if (!holder) build();
    if (!loaded) {
      var src = APP + '/?embed=1&nav=side&account_id=' + encodeURIComponent(accountId()) +
                '&tab=' + tab + '&theme=' + (isDark() ? 'dark' : 'light') +
                '&locale=' + dripLocale();
      frame.setAttribute('src', src);
      loaded = true;
    } else {
      try { frame.contentWindow.postMessage({ type: 'drip-nav', tab: tab }, '*'); } catch (e) {}
    }
    shown = true;
    document.body.classList.add('drip-active'); // disables Chatwoot's native highlight (see the style block above)
    holder.style.display = 'block';
    position();
    markActiveSub(tab);
    expand(true);
    try { sessionStorage.setItem('drip_open', tab); } catch (e) {}
    // URL sync (deep-link). Only push a new history entry on an actual selection (click); on
    // restore-from-URL (dripFromUrl already matches) skip it — otherwise we'd duplicate
    // history entries. _pushState bypasses the interceptor (which would otherwise hide the
    // panel we just showed).
    if (dripFromUrl() !== tab) {
      try { _pushState({ drip: tab }, '', urlWithDrip(tab)); } catch (e) {}
    }
  }
  function hide() {
    if (!shown) return;
    shown = false;
    document.body.classList.remove('drip-active'); // restores Chatwoot's native highlight
    if (holder) holder.style.display = 'none';
    markActiveSub(null);
    try { sessionStorage.removeItem('drip_open'); } catch (e) {}
    // Clear the drip param from the URL (if present), without a new history entry.
    // _replaceState bypasses the interceptor (prevents recursion — the interceptor itself
    // calls hide()).
    if (dripFromUrl()) {
      try { _replaceState(history.state, '', urlWithoutDrip()); } catch (e) {}
    }
  }
  // expand/collapse the sub-items (the "slider")
  function expand(open) {
    var item = document.getElementById('drip-nav-item'); if (!item) return;
    var ul = item.querySelector('[data-drip-ul]');
    var chev = item.querySelector('[data-drip-chev]');
    if (ul) ul.style.display = open ? '' : 'none';
    if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
  }
  function toggle() {
    var ul = document.querySelector('#drip-nav-item [data-drip-ul]');
    expand(!ul || ul.style.display === 'none');
  }

  // nav group with 3 sub-items — header cloned (exact styling), <ul> built from scratch
  function inject() {
    if (document.getElementById('drip-nav-item')) return;
    var camp = document.querySelector('div[name="Campaigns"]');
    if (!camp) return;
    var grp = camp.closest('li');
    if (!grp || !grp.parentElement) return;
    var clone = grp.cloneNode(true);
    clone.id = 'drip-nav-item';
    var oldUl = clone.querySelector('ul'); if (oldUl) oldUl.remove(); // in case it was cloned expanded

    // header — label + icon + visible chevron; no navigation
    var hdr = clone.querySelector('[role="button"]') || clone.firstElementChild;
    if (hdr) { hdr.setAttribute('title', navLabels().title); hdr.removeAttribute('name'); hdr.removeAttribute('href'); hdr.style.cursor = 'pointer'; hdr.setAttribute('data-drip-hdr', ''); }
    var icon = clone.querySelector('span[class*="megaphone"]') || clone.querySelector('span[class*="i-lucide-"]:not([class*="chevron"])');
    if (icon) {
      var s = document.createElement('span');
      s.className = 'size-4';
      s.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;';
      s.innerHTML = LAYERS;
      icon.replaceWith(s);
    }
    var lbl = clone.querySelector('.flex-grow'); if (lbl) lbl.textContent = navLabels().title;
    var chev = clone.querySelector('span[class*="chevron"]');
    if (chev) { chev.style.display = 'inline-flex'; chev.style.transition = 'transform .15s'; chev.setAttribute('data-drip-chev', ''); }

    // build the <ul> + 3 sub-items from scratch (Chatwoot's exact structure)
    var ul = document.createElement('ul');
    ul.className = UL_CLASS;
    ul.setAttribute('data-drip-ul', '');
    TAB_KEYS.forEach(function (key) {
      var label = navLabels()[key];
      var li = document.createElement('li');
      li.className = LI_CLASS;
      li.setAttribute('data-drip-tab', key);
      var a = document.createElement('a');
      a.className = A_CLASS;
      a.style.cursor = 'pointer';
      a.setAttribute('title', label);
      var d = document.createElement('div');
      d.className = LBL_CLASS;
      d.textContent = label;
      a.appendChild(d);
      li.appendChild(a);
      ul.appendChild(li);
    });
    clone.appendChild(ul); // expanded by default → the sub-items are visible right away

    grp.parentElement.insertBefore(clone, grp.nextSibling);
    if (shown) { markActiveSub(curTab); expand(true); }

    // state restore: if we refreshed while on the sequences panel, return to the same tab.
    // Guard the restore against Chatwoot's own pushState/replaceState calls that happen
    // during load (otherwise hide() would hide + clear drip_open right after we just
    // restored it).
    if (!restored) {
      restored = true;
      try {
        // the URL (?drip=) is the source of truth for restore; sessionStorage is just a fallback.
        var open = dripFromUrl() || sessionStorage.getItem('drip_open');
        if (open) {
          restoreGuard = true;
          setTimeout(function () { restoreGuard = false; }, 4000);
          show(open);
          setTimeout(position, 300); setTimeout(position, 800); setTimeout(position, 1500);
        }
      } catch (e) {}
    }
  }

  // event delegation — immune to Vue re-renders
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var nav = document.getElementById('drip-nav-item');
    var sub = e.target.closest('[data-drip-tab]');
    if (sub && nav && nav.contains(sub)) {
      e.preventDefault(); e.stopPropagation(); show(sub.getAttribute('data-drip-tab')); return;
    }
    if (e.target.closest('[data-drip-hdr]')) {
      e.preventDefault(); e.stopPropagation(); toggle(); return;
    }
    var link = e.target.closest('a[href*="/accounts/"]');
    if (link && !(nav && nav.contains(link))) hide();
  }, true);
  ['pushState', 'replaceState'].forEach(function (k) {
    var o = history[k]; history[k] = function () { if (!restoreGuard) hide(); return o.apply(this, arguments); };
  });
  // back/forward: the URL is the source of truth. drip param → show that tab; otherwise → hide.
  window.addEventListener('popstate', function () {
    if (restoreGuard) return;
    var t = dripFromUrl() || dripFromState();
    if (t) show(t); else hide();
  });
  window.addEventListener('resize', position);

  // live theme sync to the iframe
  new MutationObserver(function () {
    if (shown && frame && frame.contentWindow) {
      try { frame.contentWindow.postMessage({ type: 'drip-theme', theme: isDark() ? 'dark' : 'light' }, '*'); } catch (e) {}
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // live locale sync to the iframe (מקביל ל-theme). Chatwoot מחליף dir רק בהחלפת שפה
  // (אירוע נדיר, ברמת reload), אבל שומרים parity כך שהחלפה תתפשט בלי לרענן.
  new MutationObserver(function () {
    if (shown && frame && frame.contentWindow) {
      try { frame.contentWindow.postMessage({ type: 'drip-locale', locale: dripLocale() }, '*'); } catch (e) {}
    }
  }).observe(document.querySelector('#app') || document.documentElement, { attributes: true, attributeFilter: ['dir'] });

  // bootstrap: (re-)inject the nav item as Chatwoot's own Vue app re-renders the sidebar
  var navTimer;
  new MutationObserver(function () { clearTimeout(navTimer); navTimer = setTimeout(inject, 150); })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(inject, 500);
})();
