// sequences-nav — injected as part of DASHBOARD_SCRIPTS (Chatwoot's InstallationConfig hook,
// loaded last in <body> on every dashboard page except login). Adds "WhatsApp Sequences" as a
// top-level nav group in the sidebar (after "Campaigns"), with sub-items (overview /
// sequences / contacts / compliance) — exactly like Chatwoot's built-in features. Clicking a
// sub-item shows the sequences dashboard inline (filling <main>) and swaps tabs smoothly
// (postMessage). State persists in sessionStorage + the URL so a refresh stays on the same tab.
// Instance-wide. DOM-dependent (sidebar components-next) — fails silently if the structure
// changes.
//
// Native parity notes (verified against Chatwoot 4.16.1 sources, components-next/sidebar):
// - SidebarGroup.vue: a group renders its children <ul> only while expanded OR while one of
//   its children is the active route; when collapsed with an active child, ONLY that child
//   stays visible. Only one group is manually expanded at a time, and a group auto-expands
//   when its child becomes active. We mirror all of that: the group starts COLLAPSED, expands
//   when the panel opens, collapses back when the panel closes, and the header toggles.
// - SidebarGroupHeader.vue: idle = `text-n-slate-11 hover:bg-n-alpha-2`; has-active-child =
//   `text-n-slate-12 font-medium` (no bg); chevron = `i-lucide-chevron-up size-3`, VISIBLE
//   ONLY while expanded.
// - SidebarGroupLeaf.vue: the <a> hover is `ltr:hover:bg-gradient-to-r
//   rtl:hover:bg-gradient-to-l` — the direction-prefixed variants are the ONLY ones present
//   in Chatwoot's compiled CSS (an unprefixed hover:bg-gradient-to-r has no rule at all and
//   silently renders no hover). Active = `text-n-slate-12 bg-n-alpha-2 active`.
// - COLLAPSED sidebar (provider.js isCollapsed, width<160): the menu <ul> gains
//   `items-center` and every group renders as an icon-only `size-10` button; a group's
//   children move into a hover POPOVER next to the rail (SidebarCollapsedPopover.vue).
//   We render the same: icon-only trigger + hover popover with the 4 tabs. The mode is
//   re-detected on every observer tick, so dragging the sidebar narrower/wider rebuilds the
//   item in the right shape (before this, a collapsed rail showed our expanded markup as a
//   truncated text fragment).
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
    he: { title: 'רצפי WhatsApp', overview: 'סקירה', sequences: 'רצפים', contacts: 'אנשי קשר', compliance: 'ציות' },
    en: { title: 'WhatsApp Sequences', overview: 'Overview', sequences: 'Sequences', contacts: 'Contacts', compliance: 'Compliance' },
  };
  function navLabels() { return NAV_I18N[dripLocale()] || NAV_I18N.en; }
  // With nav=side the web app hides its own tab bar, so a tab that is missing here is a tab
  // the user cannot reach at all. 'compliance' surfaces Meta's quality rating, template
  // status, opt-outs and consent coverage — the screen an operator needs BEFORE a send goes
  // wrong, so it must be one click away.
  var TAB_KEYS = ['overview', 'sequences', 'contacts', 'compliance'];
  // Panel tabs that live OUTSIDE this group's sub-list (own top-level nav items in sibling
  // part-modules) but still open the same inline panel and must survive refresh/back-forward.
  var EXTRA_TABS = ['templates', 'journeys'];
  function isPanelTab(t) { return TAB_KEYS.indexOf(t) !== -1 || EXTRA_TABS.indexOf(t) !== -1; }

  // ── class strings copied verbatim from Chatwoot 4.16.1 (components-next/sidebar) ──
  // SidebarGroup.vue children list:
  var UL_CLASS = 'grid m-0 list-none min-w-0';
  // SidebarGroupLeaf.vue <li> (base + TREE_CONNECTOR — logical props, start-0 etc.):
  var LI_CLASS = 'py-0.5 ps-2 ms-3 relative text-n-slate-11 min-w-0 ' +
    "child-item before:content-[''] before:absolute before:start-0 before:w-0.5 before:h-full before:bg-n-slate-4 first:before:rounded-t last:before:h-1/5 last:after:content-[''] last:after:absolute last:after:start-0 last:after:bottom-[calc(50%_-_2px)] last:after:h-3 last:after:w-2.5 last:after:border-b-2 last:after:border-s-2 last:after:rounded-es last:after:border-n-slate-4";
  // SidebarGroupLeaf.vue <a> (the direction-prefixed hover gradient is what makes the row
  // light up on hover — identical to native sub-items):
  var A_CLASS = 'flex h-8 items-center gap-2 px-2 py-1 rounded-lg ltr:hover:bg-gradient-to-r rtl:hover:bg-gradient-to-l from-transparent via-n-slate-3/70 to-n-slate-3/70 group min-w-0';
  var A_ACTIVE = ['text-n-slate-12', 'bg-n-alpha-2', 'active']; // native leaf active classes
  var LBL_CLASS = 'flex-1 truncate min-w-0 text-sm';
  // SidebarGroup.vue collapsed trigger + SidebarCollapsedPopover.vue:
  var COL_LI_CLASS = 'grid gap-1 text-sm cursor-pointer select-none min-w-0';
  var COL_BTN_CLASS = 'flex items-center justify-center size-10 rounded-lg';
  var COL_POP_ITEM = 'flex items-center gap-2 px-2 py-1.5 w-full rounded-lg text-sm text-left rtl:text-right transition-colors duration-150 ease-out';

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

  // ── anchor + sidebar mode detection ─────────────────────────────────────────
  // Expanded: the Campaigns group header carries name="Campaigns". Collapsed: that header is
  // replaced by an icon-only size-10 button — the ONLY stable, locale-independent signal left
  // is its i-lucide-megaphone icon (titles are translated). The parent <ul> also gains
  // `items-center` in collapsed mode (Sidebar.vue), which we use as a sanity check.
  function findAnchor() {
    var byName = document.querySelector('div[name="Campaigns"]');
    if (byName) {
      var li = byName.closest('li');
      if (li && li.parentElement) return { li: li, collapsed: false };
    }
    var icons = document.querySelectorAll('span.i-lucide-megaphone');
    for (var i = 0; i < icons.length; i++) {
      var btn = icons[i].closest('.size-10');
      var li2 = icons[i].closest('li');
      if (btn && li2 && li2.parentElement && li2.parentElement.tagName === 'UL') {
        return { li: li2, collapsed: true };
      }
    }
    return null;
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
      return isPanelTab(t) ? t : null;
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
      var m = cur && String(cur).match(/[?&]drip=(overview|sequences|contacts|compliance|templates|journeys)\b/);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  var holder = null, frame = null, spinner = null, shown = false, loaded = false, curTab = 'overview', restored = false, restoreGuard = false;
  // Native slider semantics (SidebarGroup.vue expandedItem): the group starts collapsed and
  // is expanded either manually (header click) or automatically when a sub-item becomes
  // active. Closing the panel collapses it back — nothing stays open "just because".
  var groupExpanded = false;

  function build() {
    holder = document.createElement('div');
    holder.id = 'drip-inline';
    // bg-n-background = the exact class the webapp root uses — correct in light AND dark.
    // (The previous inline `rgb(var(--n-background))` referenced a CSS variable that does
    // not exist in Chatwoot's compiled CSS → transparent holder → white flash in dark mode.)
    holder.className = 'bg-n-background';
    holder.style.cssText = 'position:fixed;z-index:40;display:none;';
    frame = document.createElement('iframe');
    frame.title = navLabels().title;
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    // Native loading state while the iframe boots — the same centered brand spinner
    // Chatwoot's own Dashboard-App Frame.vue shows (LoadingState → Spinner, animate-spin).
    spinner = document.createElement('div');
    spinner.className = 'flex items-center justify-center text-n-brand';
    spinner.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    spinner.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
    holder.appendChild(frame);
    holder.appendChild(spinner);
    frame.addEventListener('load', function () { spinner.style.display = 'none'; });
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

  // ── render the group's visual state (native SidebarGroup semantics) ──
  // activeSub = the drip tab currently open, when it belongs to this group.
  function activeSub() { return (shown && TAB_KEYS.indexOf(curTab) !== -1) ? curTab : null; }
  function renderNav() {
    var item = document.getElementById('drip-nav-item'); if (!item) return;
    var active = activeSub();

    if (item.getAttribute('data-drip-mode') === 'collapsed') {
      // icon-only trigger: active → text-n-slate-12 bg-n-alpha-2 (SidebarGroup.vue collapsed)
      var trg = item.querySelector('[data-drip-hdr]');
      if (trg) {
        if (active) {
          trg.classList.add('text-n-slate-12', 'bg-n-alpha-2');
          trg.classList.remove('text-n-slate-11', 'hover:bg-n-alpha-2');
        } else {
          trg.classList.remove('text-n-slate-12', 'bg-n-alpha-2');
          trg.classList.add('text-n-slate-11', 'hover:bg-n-alpha-2');
        }
      }
      renderPopoverActive();
      return;
    }

    // children: all visible while expanded; only the active leaf while collapsed-with-active;
    // none otherwise (v-show="isExpanded || hasActiveChild" + per-leaf v-show, SidebarGroup.vue)
    var ul = item.querySelector('[data-drip-ul]');
    if (ul) {
      ul.style.display = (groupExpanded || active) ? '' : 'none';
      var subs = ul.querySelectorAll('[data-drip-tab]');
      for (var i = 0; i < subs.length; i++) {
        var key = subs[i].getAttribute('data-drip-tab');
        subs[i].style.display = (groupExpanded || key === active) ? '' : 'none';
        var a = subs[i].querySelector('a') || subs[i];
        if (active && key === active) a.classList.add.apply(a.classList, A_ACTIVE);
        else a.classList.remove.apply(a.classList, A_ACTIVE);
      }
    }

    // chevron: native shows it ONLY while expanded (v-show="isExpanded", i-lucide-chevron-up)
    var chev = item.querySelector('[data-drip-chev]');
    if (chev) chev.style.display = groupExpanded ? 'inline-flex' : 'none';

    // header: has-active-child → text-n-slate-12 font-medium (no bg), else idle slate-11.
    // The label <span class="truncate"> carries its own weight class (text-body-main idle /
    // font-medium text-sm active, SidebarGroupHeader.vue) — toggle it too, or the span's own
    // class would override the weight inherited from the header.
    var hdr = item.querySelector('[data-drip-hdr]');
    if (hdr) {
      var span = hdr.querySelector('span.truncate');
      if (active) {
        hdr.classList.add('text-n-slate-12', 'font-medium');
        hdr.classList.remove('text-n-slate-11');
        if (span) { span.classList.remove('text-body-main'); span.classList.add('font-medium', 'text-sm'); }
      } else {
        hdr.classList.remove('text-n-slate-12', 'font-medium');
        hdr.classList.add('text-n-slate-11');
        if (span) { span.classList.add('text-body-main'); span.classList.remove('font-medium', 'text-sm'); }
      }
    }
  }

  function show(tab) {
    tab = tab || 'overview';
    curTab = tab;
    if (window.__cwptReportHide) { try { window.__cwptReportHide(); } catch (e) {} } // close campaign-stats overlay if open
    if (!holder) build();
    if (!loaded) {
      var src = APP + '/?embed=1&nav=side&account_id=' + encodeURIComponent(accountId()) +
                '&tab=' + tab + '&theme=' + (isDark() ? 'dark' : 'light') +
                '&locale=' + dripLocale();
      frame.setAttribute('src', src);
      loaded = true;
    } else {
      try { frame.contentWindow.postMessage({ type: 'drip-nav', tab: tab }, location.origin); } catch (e) {}
    }
    shown = true;
    document.body.classList.add('drip-active'); // disables Chatwoot's native highlight (see the style block above)
    holder.style.display = 'block';
    position();
    // native: a group auto-expands when one of its children becomes active (SidebarGroup.vue
    // watch on hasActiveChild) — and collapses again once none of its children is active
    // (switching to templates/journeys, which are their own top-level items).
    groupExpanded = TAB_KEYS.indexOf(tab) !== -1;
    renderNav();
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
    groupExpanded = false; // native: leaving the feature collapses its group (no active child)
    closePopover();
    renderNav();
    try { sessionStorage.removeItem('drip_open'); } catch (e) {}
    // Clear the drip param from the URL (if present), without a new history entry.
    // _replaceState bypasses the interceptor (prevents recursion — the interceptor itself
    // calls hide()).
    if (dripFromUrl()) {
      try { _replaceState(history.state, '', urlWithoutDrip()); } catch (e) {}
    }
  }
  window.__cwptSeqHide = hide; // let campaign-stats close this panel before opening its overlay
  window.__dripShowPanel = show; window.__dripHidePanel = hide; // hook for templates-nav.js / journeys-nav.js (separate part modules, same window)

  // header click — native SidebarGroupHeader toggle semantics (SidebarGroup.vue
  // toggleTrigger): collapsed with no active child → open the first sub-item AND expand;
  // otherwise just toggle the expansion.
  function toggle() {
    if (!groupExpanded && !activeSub()) { show('overview'); return; }
    groupExpanded = !groupExpanded;
    renderNav();
  }

  // ── collapsed-rail hover popover (native SidebarCollapsedPopover.vue) ──────
  var popCloseTimer = null;
  function closePopover() {
    var p = document.getElementById('drip-collapsed-pop');
    if (p) p.remove();
    clearTimeout(popCloseTimer);
  }
  function scheduleClosePopover(ms) {
    clearTimeout(popCloseTimer);
    popCloseTimer = setTimeout(closePopover, ms);
  }
  function renderPopoverActive() {
    var p = document.getElementById('drip-collapsed-pop'); if (!p) return;
    var active = activeSub();
    var btns = p.querySelectorAll('[data-drip-pop-tab]');
    for (var i = 0; i < btns.length; i++) {
      var key = btns[i].getAttribute('data-drip-pop-tab');
      if (active && key === active) {
        btns[i].classList.add('text-n-slate-12', 'bg-n-alpha-2');
        btns[i].classList.remove('text-n-slate-11', 'hover:bg-n-alpha-2');
      } else {
        btns[i].classList.remove('text-n-slate-12', 'bg-n-alpha-2');
        btns[i].classList.add('text-n-slate-11', 'hover:bg-n-alpha-2');
      }
    }
  }
  function openPopover(trigger) {
    if (document.getElementById('drip-collapsed-pop')) { clearTimeout(popCloseTimer); return; }
    var labels = navLabels();
    var pop = document.createElement('div');
    pop.id = 'drip-collapsed-pop';
    pop.className = 'fixed z-[100] min-w-[200px] max-w-[280px]';
    var card = document.createElement('div');
    card.className = 'bg-n-alpha-3 backdrop-blur-[100px] outline outline-1 -outline-offset-1 w-56 outline-n-weak rounded-xl shadow-lg py-2 px-2';
    var title = document.createElement('div');
    title.className = 'px-2 py-1.5 text-xs font-medium text-n-slate-11 uppercase tracking-wider border-b border-n-weak mb-1';
    title.textContent = labels.title;
    card.appendChild(title);
    var ul = document.createElement('ul');
    ul.className = 'm-0 p-0 list-none max-h-[400px] overflow-y-auto no-scrollbar';
    TAB_KEYS.forEach(function (key) {
      var li = document.createElement('li');
      li.className = 'py-0.5';
      var b = document.createElement('button');
      b.type = 'button';
      b.className = COL_POP_ITEM + ' text-n-slate-11 hover:bg-n-alpha-2';
      b.setAttribute('data-drip-pop-tab', key);
      var lbl = document.createElement('span');
      lbl.className = 'flex-1 truncate';
      lbl.textContent = labels[key];
      b.appendChild(lbl);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        show(key);
        closePopover();
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
    card.appendChild(ul);
    pop.appendChild(card);
    pop.addEventListener('mouseenter', function () { clearTimeout(popCloseTimer); });
    pop.addEventListener('mouseleave', function () { scheduleClosePopover(100); });
    document.body.appendChild(pop);

    // position: next to the rail (LTR: right of it, RTL: left of it), at the trigger's top,
    // clamped to the viewport — same math as the native popover.
    var rail = trigger.closest('nav') || trigger.closest('ul') || trigger;
    var railRect = rail.getBoundingClientRect();
    var trgRect = trigger.getBoundingClientRect();
    if (dripLocale() === 'he') {
      pop.style.right = Math.round(window.innerWidth - railRect.left + 8) + 'px';
    } else {
      pop.style.left = Math.round(railRect.right + 8) + 'px';
    }
    var popH = pop.offsetHeight || 200;
    var top = trgRect.top + popH > window.innerHeight - 20
      ? Math.max(20, window.innerHeight - popH - 20)
      : trgRect.top;
    pop.style.top = Math.round(top) + 'px';
    renderPopoverActive();
  }
  window.addEventListener('blur', closePopover);

  // ── build the nav item — expanded group OR collapsed icon-only trigger ─────
  function buildExpanded(anchorLi) {
    var clone = anchorLi.cloneNode(true);
    clone.id = 'drip-nav-item';
    clone.setAttribute('data-drip-mode', 'expanded');
    var oldUl = clone.querySelector('ul'); if (oldUl) oldUl.remove(); // in case it was cloned expanded

    // header — label + icon + chevron; no navigation. Strip the cloned state classes and
    // re-apply the idle set (the Campaigns group may have been cloned while active).
    var hdr = clone.querySelector('[role="button"]') || clone.firstElementChild;
    if (hdr) {
      hdr.setAttribute('title', navLabels().title);
      hdr.removeAttribute('name'); hdr.removeAttribute('href');
      hdr.style.cursor = 'pointer';
      hdr.setAttribute('data-drip-hdr', '');
      hdr.classList.remove('text-n-slate-12', 'bg-n-alpha-2', 'font-medium');
      hdr.classList.add('text-n-slate-11', 'hover:bg-n-alpha-2');
    }
    var icon = clone.querySelector('span[class*="megaphone"]') || clone.querySelector('span[class*="i-lucide-"]:not([class*="chevron"])');
    if (icon) {
      // i-lucide-layers is present in Chatwoot's compiled CSS → render exactly like a native
      // sidebar icon (mask), no inline SVG needed.
      var s = document.createElement('span');
      s.className = 'i-lucide-layers size-4';
      icon.replaceWith(s);
    }
    // set the label WITHOUT flattening the native structure (span.truncate carries the
    // text-body-main/font-medium weight classes renderNav toggles); drop any count badge.
    var lblWrap = clone.querySelector('.flex-grow');
    var lblSpan = lblWrap && lblWrap.querySelector('span.truncate');
    if (lblSpan) {
      lblSpan.textContent = navLabels().title;
      // idle weight class (the clone may have been taken from an ACTIVE group)
      lblSpan.classList.add('text-body-main');
      lblSpan.classList.remove('font-medium', 'text-sm');
      var extras = lblWrap.querySelectorAll('span:not(.truncate)');
      for (var x = 0; x < extras.length; x++) extras[x].remove();
    } else if (lblWrap) {
      lblWrap.textContent = navLabels().title;
    }
    var chev = clone.querySelector('span[class*="chevron"]');
    if (!chev && hdr) {
      chev = document.createElement('span');
      hdr.appendChild(chev);
    }
    if (chev) {
      chev.className = 'i-lucide-chevron-up size-3';
      chev.removeAttribute('style');
      chev.style.display = 'none'; // native: visible only while expanded (renderNav toggles)
      chev.setAttribute('data-drip-chev', '');
    }

    // build the <ul> + sub-items from scratch (Chatwoot's exact 4.16.1 structure).
    // Note: Chatwoot only renders the sub-items <ul> while the group is expanded (v-if), so
    // we *build* it rather than clone it — at inject time "Campaigns" may be collapsed.
    var ul = document.createElement('ul');
    ul.className = UL_CLASS;
    ul.setAttribute('data-drip-ul', '');
    ul.style.display = 'none'; // collapsed until expanded / active (native default)
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
    clone.appendChild(ul);
    return clone;
  }

  function buildCollapsed() {
    var li = document.createElement('li');
    li.id = 'drip-nav-item';
    li.setAttribute('data-drip-mode', 'collapsed');
    li.className = COL_LI_CLASS;
    var wrap = document.createElement('div');
    wrap.className = 'relative';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = COL_BTN_CLASS + ' text-n-slate-11 hover:bg-n-alpha-2';
    btn.setAttribute('title', navLabels().title);
    btn.setAttribute('data-drip-hdr', '');
    var icon = document.createElement('span');
    icon.className = 'i-lucide-layers size-4';
    btn.appendChild(icon);
    wrap.appendChild(btn);
    li.appendChild(wrap);
    // native collapsed groups open their children in a popover on hover
    wrap.addEventListener('mouseenter', function () { clearTimeout(popCloseTimer); openPopover(btn); });
    wrap.addEventListener('mouseleave', function () { scheduleClosePopover(200); });
    return li;
  }

  function inject() {
    var anchor = findAnchor();
    if (!anchor) return;
    watchRail(anchor.li.parentElement);
    var mode = anchor.collapsed ? 'collapsed' : 'expanded';
    var existing = document.getElementById('drip-nav-item');
    if (existing && existing.getAttribute('data-drip-mode') === mode) return;
    var flipped = !!existing;
    if (existing) { existing.remove(); closePopover(); }

    var item = anchor.collapsed ? buildCollapsed() : buildExpanded(anchor.li);
    anchor.li.parentElement.insertBefore(item, anchor.li.nextSibling);
    renderNav();
    // mode flip: rebuild the sibling top-level items (templates / flow-builder)
    // SYNCHRONOUSLY, in the same task — they follow #drip-nav-item's mode, and waiting for
    // their own observers would leave them in the stale shape for a beat.
    if (flipped) {
      var pings = window.__cwptNavPing || [];
      for (var p = 0; p < pings.length; p++) { try { pings[p](); } catch (e) {} }
    }

    // state restore: if we refreshed while on the sequences panel, return to the same tab.
    // Guard the restore against Chatwoot's own pushState/replaceState calls that happen
    // during load (otherwise hide() would hide + clear drip_open right after we just
    // restored it).
    if (!restored) {
      restored = true;
      try {
        // the URL (?drip=) is the source of truth for restore; sessionStorage is just a fallback.
        // Validate the stored value too — an old session may hold a tab that no longer exists.
        var stored = sessionStorage.getItem('drip_open');
        var open = dripFromUrl() || (isPanelTab(stored) ? stored : null);
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
      e.preventDefault(); e.stopPropagation();
      var item = document.getElementById('drip-nav-item');
      if (item && item.getAttribute('data-drip-mode') === 'collapsed') {
        // native collapsed click → first accessible child (handleCollapsedClick); the
        // popover (hover) is the way to reach a specific tab
        closePopover();
        show(activeSub() || 'overview');
      } else {
        toggle();
      }
      return;
    }
    // click-outside closes the collapsed popover (parity with onClickOutside)
    var pop = document.getElementById('drip-collapsed-pop');
    if (pop && !pop.contains(e.target)) closePopover();
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
      try { frame.contentWindow.postMessage({ type: 'drip-theme', theme: isDark() ? 'dark' : 'light' }, location.origin); } catch (e) {}
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // live locale sync to the iframe (מקביל ל-theme). Chatwoot מחליף dir רק בהחלפת שפה
  // (אירוע נדיר, ברמת reload), אבל שומרים parity כך שהחלפה תתפשט בלי לרענן.
  new MutationObserver(function () {
    if (shown && frame && frame.contentWindow) {
      try { frame.contentWindow.postMessage({ type: 'drip-locale', locale: dripLocale() }, location.origin); } catch (e) {}
    }
  }).observe(document.querySelector('#app') || document.documentElement, { attributes: true, attributeFilter: ['dir'] });

  // ── immediate mode-flip: watch the menu <ul>'s class directly ──────────────
  // Collapsing the sidebar toggles `items-center` on the menu <ul> (Sidebar.vue) in the very
  // frame the threshold is crossed. A generic trailing debounce misses that moment: dragging
  // the sidebar floods the page with unrelated mutations (lists reflowing), and a debounce
  // that resets on every mutation only fires seconds later, once everything settles — the
  // user sees the stale shape squeezed into the rail. This dedicated attribute observer
  // rebuilds the items in the SAME task as the native flip. Re-attached whenever the <ul>
  // itself is replaced by a Vue re-render.
  var railObs = new MutationObserver(function () { inject(); if (shown) position(); });
  var railWatched = null;
  function watchRail(ul) {
    if (!ul || railWatched === ul) return;
    railObs.disconnect();
    railObs.observe(ul, { attributes: true, attributeFilter: ['class'] });
    railWatched = ul;
  }

  // bootstrap: (re-)inject the nav item as Chatwoot's own Vue app re-renders the sidebar.
  // THROTTLE with a guaranteed run (not a trailing debounce): fire ~120ms after the FIRST
  // mutation of a burst, so a mutation storm (sidebar drag, live list updates) can never
  // starve re-injection. inject() is cheap when nothing changed. Also keeps the open panel
  // aligned with the content area while the sidebar is resized (no window resize event).
  var navTimer = null;
  new MutationObserver(function () {
    if (navTimer) return;
    navTimer = setTimeout(function () {
      navTimer = null;
      inject();
      if (shown) position();
    }, 120);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(inject, 500);
})();
