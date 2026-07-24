// journey-launch — injected as part of DASHBOARD_SCRIPTS. A small floating "הפעל פלואו"
// pill that appears ONLY inside a conversation view, for every member of the account
// (agents launch flows; building them stays admin-only — see journeys-nav.js). Opens a
// tiny popover listing the account's ACTIVE journeys; picking one calls jrn_launch on the
// current conversation. Fixed-position on purpose: it anchors to the viewport, not to
// Chatwoot's DOM, so Vue re-renders can't detach it (the fragile-anchor failure mode).
(function () {
  if (window.__jrnLaunch) return;
  window.__jrnLaunch = true;

  var ADDONS_BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';

  function dripLocale() {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
  }
  var I18N = {
    he: { launch: 'הפעל פלואו', none: 'אין פלואו פעיל', started: 'הפלואו הופעל ✓', failed: 'ההפעלה נכשלה', busy: 'פלואו אחר כבר פעיל בשיחה' },
    en: { launch: 'Run flow', none: 'No active flows', started: 'Flow started ✓', failed: 'Launch failed', busy: 'Another flow is already live here' },
  };
  function t(k) { return (I18N[dripLocale()] || I18N.en)[k]; }

  function convoCtx() {
    var m = location.pathname.match(/\/accounts\/(\d+)\/(?:custom_view\/\d+\/)?conversations\/(\d+)/);
    return m ? { accountId: m[1], displayId: m[2] } : null;
  }

  function api(accId, action, payload) {
    return fetch(ADDONS_BASE + '/drip-api?account_id=' + encodeURIComponent(accId), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, payload: payload || {} }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.ok === false) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j.data;
      });
    });
  }

  // ── UI ──
  var BTN_ID = 'jrn-launch-btn';
  var POP_ID = 'jrn-launch-pop';

  function ensureButton() {
    var btn = document.getElementById(BTN_ID);
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'text-sm font-medium rounded-full shadow-lg border border-n-weak bg-n-background text-n-blue-11 hover:bg-n-alpha-2';
    btn.style.cssText = 'position:fixed;bottom:92px;inset-inline-end:18px;z-index:9998;padding:6px 14px;display:none;cursor:pointer;';
    btn.innerHTML = '⚡ <span></span>';
    btn.addEventListener('click', togglePopover);
    document.body.appendChild(btn);
    return btn;
  }

  function closePopover() {
    var p = document.getElementById(POP_ID);
    if (p) p.remove();
  }

  function togglePopover() {
    if (document.getElementById(POP_ID)) { closePopover(); return; }
    var ctx = convoCtx();
    if (!ctx) return;
    var pop = document.createElement('div');
    pop.id = POP_ID;
    pop.className = 'rounded-xl shadow-xl border border-n-strong bg-n-background text-n-slate-12';
    pop.style.cssText = 'position:fixed;bottom:132px;inset-inline-end:18px;z-index:9999;min-width:220px;max-width:300px;padding:6px;';
    pop.innerHTML = '<div class="text-xs text-n-slate-11" style="padding:4px 8px;">…</div>';
    document.body.appendChild(pop);

    api(ctx.accountId, 'jrn_list').then(function (list) {
      var active = launchable(list);
      cache[ctx.accountId] = { ts: Date.now(), n: active.length }; // רענון אגבי של הקאש
      pop.innerHTML = '';
      if (!active.length) {
        pop.innerHTML = '<div class="text-sm text-n-slate-11" style="padding:8px 10px;">' + t('none') + '</div>';
        return;
      }
      active.forEach(function (j) {
        var it = document.createElement('button');
        it.type = 'button';
        it.className = 'text-sm rounded-lg hover:bg-n-alpha-2 text-n-slate-12';
        it.style.cssText = 'display:block;width:100%;text-align:start;padding:7px 10px;cursor:pointer;background:none;border:none;';
        it.textContent = j.name;
        it.addEventListener('click', function () { launch(ctx, j, it); });
        pop.appendChild(it);
      });
    }).catch(function () {
      pop.innerHTML = '<div class="text-sm text-n-ruby-11" style="padding:8px 10px;">' + t('failed') + '</div>';
    });
  }

  function launch(ctx, journey, itemEl) {
    itemEl.disabled = true;
    itemEl.style.opacity = '0.6';
    api(ctx.accountId, 'jrn_launch', { id: journey.id, display_id: Number(ctx.displayId) })
      .then(function () { flash(t('started'), 'ok'); })
      .catch(function (e) {
        flash(/פעיל בשיחה|already/.test(String(e.message)) ? t('busy') : t('failed'), 'err');
      })
      .then(closePopover);
  }

  function flash(text, kind) {
    var el = document.createElement('div');
    el.className = 'text-sm rounded-lg shadow-lg border ' +
      (kind === 'ok' ? 'bg-n-background text-n-teal-11 border-n-weak' : 'bg-n-background text-n-ruby-11 border-n-weak');
    el.style.cssText = 'position:fixed;bottom:92px;inset-inline-end:18px;z-index:10000;padding:8px 14px;';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  }

  // click-away closes the popover (capture — before Vue swallows the event)
  document.addEventListener('click', function (e) {
    var pop = document.getElementById(POP_ID);
    if (!pop) return;
    var btn = document.getElementById(BTN_ID);
    if (pop.contains(e.target) || (btn && btn.contains(e.target))) return;
    closePopover();
  }, true);

  // פלואו שזמין להפעלה ידנית: פעיל, ולא סומן במפורש manual=false (המנוע אוכף את אותו כלל).
  function launchable(list) {
    return (list || []).filter(function (j) {
      return j.status === 'active' && !(j.trigger && j.trigger.manual === false);
    });
  }

  // הכפתור מוצג רק כשלחשבון יש לפחות פלואו אחד כזה — אחרת הוא רעש צף לכל נציג
  // בכל חשבון על השרת. נבדק פעם ב-5 דקות לכל חשבון (וכל פתיחת-popover מרעננת אגבית).
  var cache = {}; // accountId → { ts, n }
  var CACHE_MS = 5 * 60 * 1000;
  function hasLaunchable(accId, cb) {
    var c = cache[accId];
    if (c && Date.now() - c.ts < CACHE_MS) { cb(c.n > 0); return; }
    if (c && c.pending) { cb(c.n > 0); return; }
    cache[accId] = { ts: c ? c.ts : 0, n: c ? c.n : 0, pending: true };
    api(accId, 'jrn_list').then(function (list) {
      cache[accId] = { ts: Date.now(), n: launchable(list).length };
      cb(cache[accId].n > 0);
    }).catch(function () {
      // שגיאה (למשל נציג בלי הרשאה) → לא מציגים; ננסה שוב בעוד 5 דקות.
      cache[accId] = { ts: Date.now(), n: 0 };
      cb(false);
    });
  }

  // show/hide by URL + keep the label in the current locale. 1s poll — same self-healing
  // idiom the other injectors use (SPA navigation has no reliable event).
  var lastKey = '';
  setInterval(function () {
    var ctx = convoCtx();
    var btn = ensureButton();
    if (!ctx) {
      if (btn.style.display !== 'none') { btn.style.display = 'none'; closePopover(); }
      lastKey = '';
      return;
    }
    hasLaunchable(ctx.accountId, function (show) {
      var cur = convoCtx(); // ייתכן שניווטו בזמן הבדיקה
      if (!cur || cur.accountId !== ctx.accountId) return;
      btn.style.display = show ? '' : 'none';
      if (!show) closePopover();
    });
    btn.querySelector('span').textContent = t('launch');
    var key = ctx.accountId + '/' + ctx.displayId;
    if (key !== lastKey) { lastKey = key; closePopover(); }
  }, 1000);
})();
