// campaign-stats — integrates WhatsApp-campaign delivery analytics DIRECTLY into Chatwoot's own
// campaigns page (/app/accounts/:id/campaigns/whatsapp), so it looks like a native Chatwoot
// feature rather than a bolted-on panel:
//   1. A delivery-stats row (sent / delivered / read / failed) injected INTO every campaign card,
//      in the card's own `slot="after"` area, styled with Chatwoot's own Tailwind n-tokens
//      (text-n-teal-11, border-n-weak, …) so it matches the surrounding UI pixel-for-pixel and is
//      theme-aware (light/dark) for free.
//   2. "Full report" per card → drills into that campaign's detail (funnel / recipients / cost),
//      and a "Statistics" button in the page header → the campaigns overview (KPIs / trend /
//      comparison). Both fill the content area (like the sequences panel does) via the drip webapp
//      iframe — not a floating modal.
//
// Card stats come from ONE bulk call to /drip-api {action:'campaigns'} (every WhatsApp campaign
// with its aggregated counts) — NOT one call per card. Cards carry no campaign id in the DOM, and
// the API orders by created_at while Chatwoot's list orders by id, so cards are matched to stats
// by TITLE (the card's title span === campaigns.title, verbatim). Read-only; idempotent against
// Vue re-renders (MutationObserver); fails silently off-page / on any DOM change. Part of
// DASHBOARD_SCRIPTS (InstallationConfig hook, loaded last in <body> on every dashboard page).
(function () {
  if (window.__dripCampaignStats) return;
  window.__dripCampaignStats = true;
  var ADDONS_BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';

  // ── i18n: Hebrew for RTL (he) users, English for everyone else — same #app[dir]=rtl signal the
  // sibling injectors use (Chatwoot doesn't expose the locale on the DOM otherwise). ──
  function locale() {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
  }
  var I18N = {
    he: { sent: 'נשלחו', delivered: 'נמסרו', read: 'נקראו', failed: 'נכשלו', report: 'דוח מלא', overview: 'סטטיסטיקה', close: 'סגירה', total: 'קמפיינים' },
    en: { sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed', report: 'Full report', overview: 'Statistics', close: 'Close', total: 'Campaigns' },
  };
  function t(k) { return (I18N[locale()] || I18N.en)[k] || I18N.en[k] || k; }

  function onPage() { return /\/accounts\/\d+\/campaigns\/whatsapp\b/.test(location.pathname); }
  function accountId() { var m = location.pathname.match(/\/accounts\/(\d+)/); return m ? m[1] : ''; }
  function isDark() { return document.body.classList.contains('dark'); }
  function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

  // bar-chart-3 (lucide) — direction-neutral, so it reads the same in RTL and LTR
  var REPORT_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M3 3v18h18"/>' +
    '<path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>';

  // ── stats: one bulk fetch, cached as { title → row }. Re-fetched when the account changes. ──
  var statsByTitle = {}, statsAcc = null, fetching = false;
  function fetchStats() {
    var acc = accountId();
    if (!acc || fetching) return;
    fetching = true;
    fetch(ADDONS_BASE + '/drip-api?account_id=' + encodeURIComponent(acc), {
      method: 'POST',
      credentials: 'same-origin', // same-origin embed → forwards the Chatwoot session cookie the authGate needs
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'campaigns', payload: {} }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        // failed / non-2xx response (j === null) → do NOT mark this account as done, so the next
        // tick retries (this deployment has a documented history of transient Caddy↔Puma 502s).
        if (!j) { fetching = false; return; }
        var map = {};
        // ponytail: last-wins on duplicate titles (two campaigns, same name) — rare; a per-title
        // scheduled_at tiebreak isn't worth it (the card's date format differs from the API's).
        (j.data || []).forEach(function (c) { map[(c.title || '').trim()] = c; });
        statsByTitle = map;
        statsAcc = acc;
        fetching = false;
        renderCards();
      })
      .catch(function () { fetching = false; });
  }

  function metric(value, label, colorClass) {
    return '<span class="flex items-baseline gap-1.5 text-sm">' +
             '<span class="font-semibold ' + colorClass + '">' + value + '</span>' +
             '<span class="text-n-slate-11">' + label + '</span>' +
           '</span>';
  }
  function statsHtml(c) {
    var dPct = c.sent ? ' · ' + pct(c.delivered, c.sent) + '%' : '';
    var rPct = c.sent ? ' · ' + pct(c.read, c.sent) + '%' : '';
    return metric(c.sent, t('sent'), 'text-n-slate-12') +
           metric(c.delivered, t('delivered') + dPct, 'text-n-teal-11') +
           metric(c.read, t('read') + rPct, 'text-n-blue-11') +
           metric(c.failed, t('failed'), 'text-n-ruby-11');
  }

  // Inject / refresh the stats row inside each campaign card. Idempotent: reuses an existing row,
  // and only rewrites its innerHTML when the numbers or locale actually change (cheap on re-runs).
  function renderCards() {
    if (!onPage()) return;
    var cards = document.querySelectorAll('.group\\/cardLayout');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var titleEl = card.querySelector('.text-base.font-medium.capitalize');
      if (!titleEl) continue;
      var c = statsByTitle[titleEl.textContent.trim()];
      if (!c) continue; // stats not loaded yet, or title didn't match a campaign — leave the card untouched

      var bar = card.querySelector(':scope > .cwpt-stats');
      if (!bar) {
        bar = document.createElement('div');
        // border-t + mx-6 aligns the divider with the card's own px-6 content padding; the row
        // lands in CardLayout's empty slot="after" (appended as the card root's last child).
        bar.className = 'cwpt-stats flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-n-weak mx-6 py-2.5';
        card.appendChild(bar);
      }
      var sig = c.id + ':' + c.sent + '/' + c.delivered + '/' + c.read + '/' + c.failed + '|' + locale();
      if (bar.__sig === sig) continue;
      bar.__sig = sig;
      bar.innerHTML = statsHtml(c) +
        '<button type="button" data-cwpt-report="' + c.id + '" ' +
        'class="ms-auto inline-flex items-center gap-1.5 text-sm text-n-slate-11 hover:text-n-slate-12" ' +
        'style="cursor:pointer">' + REPORT_ICON + '<span>' + t('report') + '</span></button>';
    }
  }

  // "Statistics" button in the page header (next to "+ New Campaign") → the campaigns overview
  // (KPIs / trend / comparison). Idempotent (guarded by id).
  function renderHeader() {
    if (!onPage() || document.getElementById('cwpt-overview-btn')) return;
    var headerRow = document.querySelector('.h-20.justify-between') ||
                    document.querySelector('header .items-center.justify-between');
    if (!headerRow) return;
    var btnWrap = headerRow.querySelector(':scope > div:last-child'); // the "+ New Campaign" wrapper
    if (!btnWrap || btnWrap === headerRow.firstElementChild) return;   // need the title + the button wrapper
    var b = document.createElement('button');
    b.id = 'cwpt-overview-btn';
    b.type = 'button';
    b.className = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium text-n-slate-11 hover:text-n-slate-12 hover:bg-n-alpha-2';
    b.style.cssText = 'margin-inline-end:8px;cursor:pointer;';
    b.innerHTML = REPORT_ICON + '<span>' + t('overview') + '</span>';
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); showReport(null); });
    btnWrap.insertBefore(b, btnWrap.firstChild); // sits inline, just before "+ New Campaign"
  }

  // Native aggregate-KPI bar at the top of the campaigns list (totals across all campaigns), so the
  // headline numbers are visible without opening the overview overlay. Same card design as the
  // webapp's KPI row. Idempotent (guarded by id + __sig).
  function renderKpiBar() {
    if (!onPage()) return;
    var titles = Object.keys(statsByTitle);
    if (!titles.length) return; // stats not loaded yet
    var a = { count: titles.length, sent: 0, delivered: 0, read: 0, failed: 0 };
    titles.forEach(function (k) {
      var c = statsByTitle[k];
      a.sent += c.sent || 0; a.delivered += c.delivered || 0; a.read += c.read || 0; a.failed += c.failed || 0;
    });
    var main = contentArea();
    var wrap = (main && main.querySelector('.max-w-5xl')) || main; // CampaignLayout's content wrapper
    if (!wrap) return;
    var bar = document.getElementById('cwpt-kpi-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cwpt-kpi-bar';
      bar.className = 'grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5';
      wrap.insertBefore(bar, wrap.firstChild);
    }
    var sig = a.count + ':' + a.sent + '/' + a.delivered + '/' + a.read + '/' + a.failed + '|' + locale();
    if (bar.__sig === sig) return;
    bar.__sig = sig;
    var KPIS = [
      { label: t('total'), value: a.count, cls: 'text-n-blue-11' },
      { label: t('sent'), value: a.sent, cls: 'text-n-slate-12' },
      { label: t('delivered'), value: pct(a.delivered, a.sent) + '%', cls: 'text-n-teal-11' },
      { label: t('read'), value: pct(a.read, a.sent) + '%', cls: 'text-n-blue-11' },
      { label: t('failed'), value: pct(a.failed, a.sent) + '%', cls: 'text-n-ruby-11' },
    ];
    bar.innerHTML = KPIS.map(function (k) {
      return '<div class="flex flex-col items-start rounded-xl bg-n-alpha-1 px-4 py-3 ring-1 ring-n-weak">' +
               '<span class="text-2xl font-semibold leading-none ' + k.cls + '">' + k.value + '</span>' +
               '<span class="mt-1 text-xs text-n-slate-11">' + k.label + '</span>' +
             '</div>';
    }).join('');
  }

  // ── drill-down overlay: fills the content area (the big <main>) with the report, exactly like
  // the sequences panel — not a floating modal. ──
  function contentArea() {
    var mains = document.querySelectorAll('main'), best = null, ba = 0;
    for (var i = 0; i < mains.length; i++) {
      var r = mains[i].getBoundingClientRect(), a = r.width * r.height;
      if (r.width > 500 && r.height > 300 && a > ba) { ba = a; best = mains[i]; }
    }
    return best || document.querySelector('div.overflow-auto.bg-n-surface-1') || document.body;
  }

  var holder = null, frame = null, shown = false, loaded = false, loadedSolo = null;
  function buildOverlay() {
    holder = document.createElement('div');
    holder.id = 'cwpt-report-overlay';
    holder.style.cssText = 'position:fixed;z-index:40;display:none;background:rgb(var(--background,255 255 255));';
    frame = document.createElement('iframe');
    frame.title = t('overview');
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    holder.appendChild(frame);
    // close control (×) — returns to the native campaigns list. z above the iframe.
    var close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', t('close'));
    close.className = 'inline-flex items-center justify-center rounded-lg bg-n-alpha-2 text-n-slate-11 hover:text-n-slate-12';
    close.style.cssText = 'position:absolute;top:10px;inset-inline-end:14px;width:28px;height:28px;z-index:2;cursor:pointer;';
    close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
    close.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); hideReport(); });
    holder.appendChild(close);
    document.body.appendChild(holder);
  }
  function positionOverlay() {
    if (!holder || !shown) return;
    var r = contentArea().getBoundingClientRect();
    var top = Math.max(0, r.top);
    holder.style.top = top + 'px';
    holder.style.left = r.left + 'px';
    holder.style.width = r.width + 'px';
    holder.style.height = (window.innerHeight - top) + 'px';
  }
  function reportSrc(cid) {
    // cid → deep-link straight to that campaign's detail, solo=1 so its Back button closes the
    // overlay (drip-close); no cid → the campaigns overview list.
    return ADDONS_BASE + '/?embed=1&nav=side&account_id=' + encodeURIComponent(accountId()) +
      '&tab=campaigns' + (cid ? '&campaign=' + encodeURIComponent(cid) + '&solo=1' : '') +
      '&theme=' + (isDark() ? 'dark' : 'light') + '&locale=' + locale();
  }
  function showReport(cid) {
    if (!holder) buildOverlay();
    hideSiblingPanels(); // never stack on top of the sequences-nav panel
    var wantSolo = !!cid;
    // (Re)load only when switching between the two modes (solo detail vs. overview list); within a
    // mode we just postMessage, so switching campaigns doesn't flash the iframe.
    if (!loaded || loadedSolo !== wantSolo) {
      frame.setAttribute('src', reportSrc(cid));
      loaded = true; loadedSolo = wantSolo;
    } else if (cid) {
      try { frame.contentWindow.postMessage({ type: 'drip-open-campaign', id: parseInt(cid, 10) }, '*'); } catch (e) {}
    } else {
      try { frame.contentWindow.postMessage({ type: 'drip-nav', tab: 'campaigns' }, '*'); } catch (e) {}
    }
    shown = true;
    holder.style.display = 'block';
    positionOverlay();
  }
  function hideReport() {
    if (!shown) return;
    shown = false;
    if (holder) holder.style.display = 'none';
  }
  window.__cwptReportHide = hideReport; // let sequences-nav close this overlay before opening its panel
  // close the sequences-nav sidebar panel (if open) so the two full-content overlays never stack
  function hideSiblingPanels() { if (window.__cwptSeqHide) { try { window.__cwptSeqHide(); } catch (e) {} } }

  // open report on click (event delegation — immune to Vue re-renders)
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var btn = e.target.closest('[data-cwpt-report]');
    if (btn) { e.preventDefault(); e.stopPropagation(); showReport(btn.getAttribute('data-cwpt-report')); }
  }, true);

  // close when a solo detail view's Back button posts drip-close
  window.addEventListener('message', function (e) {
    if (e.origin !== window.location.origin) return; // same-origin embed only
    if (e.data && e.data.type === 'drip-close') hideReport();
  });
  window.addEventListener('resize', positionOverlay);

  // live theme/locale sync to the iframe (parity with sequences-nav)
  new MutationObserver(function () {
    if (shown && frame && frame.contentWindow) {
      try { frame.contentWindow.postMessage({ type: 'drip-theme', theme: isDark() ? 'dark' : 'light' }, '*'); } catch (e) {}
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(function () {
    if (shown && frame && frame.contentWindow) {
      try { frame.contentWindow.postMessage({ type: 'drip-locale', locale: locale() }, '*'); } catch (e) {}
    }
  }).observe(document.querySelector('#app') || document.documentElement, { attributes: true, attributeFilter: ['dir'] });

  // bootstrap: fetch on entering the page (or account change), render cards + header button as Vue
  // re-renders the list, and close the overlay when navigating away.
  function tick() {
    if (onPage()) {
      if (statsAcc !== accountId()) fetchStats();
      renderCards();
      renderHeader();
      renderKpiBar();
    } else if (shown) {
      hideReport();
    }
  }
  var timer;
  new MutationObserver(function () { clearTimeout(timer); timer = setTimeout(tick, 150); })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(tick, 500);
})();
