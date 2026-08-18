// schedule-send — injected as part of DASHBOARD_SCRIPTS (Chatwoot's InstallationConfig hook,
// loaded last in <body> on every dashboard page except login). Adds a clock button next to the
// reply box's Send button: it queues the reply the agent has already written and sends it at a
// chosen time, from the server, whether or not the browser is still open.
//
// The problem it fixes: Chatwoot schedules campaigns, never a single reply. An agent finishing
// an answer at 23:40 either wakes the customer or loses the answer; "I'll get back to you
// tomorrow morning" has nowhere to live except a personal reminder.
//
// Where the work happens: the engine (modules/sequences/engine — migration 051,
// src/scheduledMessages.js) owns the queue and the sending; this file is only the control. It
// talks to the same same-origin `/drip-api` endpoint every other part uses, so there is no new
// route, no CORS and no second login. If the engine is not installed the health probe fails and
// the button never appears — the module degrades to nothing rather than to a broken button.
//
// Native parity notes (verified against Chatwoot 4.16.2 sources + the compiled dashboard CSS on
// the server via lib/native-parity-check.sh):
// - WootWriter/ReplyBottomPanel.vue puts the Send button alone inside `<div class="right-wrap">`.
//   The clock is inserted as that div's first child, so it sits immediately before Send and
//   inherits the panel's own layout.
// - The button reproduces components-next/button/Button.vue verbatim for
//   variant=ghost color=slate size=sm icon-only: base + ghost + iconOnly + fontSize +
//   clickAnimation + justify-center. Those exact tokens are already asserted by
//   native-parity-check.sh, so a Chatwoot upgrade that drops one is caught before release.
// - `i-lucide-alarm-clock` and `i-lucide-trash-2` survive Tailwind's purge in 4.16.2; verify
//   before swapping icons.
// - Private notes are excluded: ReplyBottomPanel binds `:color="isNote ? 'amber' : 'blue'"` on
//   Send, so an amber Send button means note mode. A queued private note would arrive as a
//   normal outgoing message to the customer — the one failure mode worth designing out.
// Vue re-renders the panel freely; the tick re-inserts the button whenever it goes missing.
(function () {
  if (window.__cwptScheduleSend) return;
  window.__cwptScheduleSend = true;

  var BTN_ID = 'cwpt-sched-btn';
  var POP_ID = 'cwpt-sched-pop';
  var TICK_MS = 1200;
  var BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';

  function locale() {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
  }
  var I18N = {
    he: {
      tip: 'תזמון שליחה', inHour: 'בעוד שעה', tomorrow: 'מחר ב-9:00',
      custom: 'מועד אחר', queue: 'ממתינות בשיחה', none: 'אין הודעות מתוזמנות',
      empty: 'כתוב הודעה כדי לתזמן אותה', queued: 'ההודעה תוזמנה', failed: 'התזמון נכשל',
      cancel: 'ביטול', save: 'תזמן',
    },
    en: {
      tip: 'Schedule send', inHour: 'In an hour', tomorrow: 'Tomorrow 9:00',
      custom: 'Pick a time', queue: 'Queued in this conversation', none: 'Nothing scheduled',
      empty: 'Write a message to schedule it', queued: 'Message scheduled', failed: 'Scheduling failed',
      cancel: 'Cancel', save: 'Schedule',
    },
  };
  function t(k) { return (I18N[locale()] || I18N.en)[k]; }

  function route() {
    var m = location.pathname.match(/\/accounts\/(\d+)\/(?:custom_view\/\d+\/)?conversations\/(\d+)/);
    return m ? { acc: m[1], conv: m[2] } : null;
  }

  // ── engine availability: probed once; no engine ⇒ no button at all ──
  var engine = { checked: false, ok: false };
  function probeEngine() {
    if (engine.checked) return;
    engine.checked = true;
    fetch(BASE + '/drip-api/health', { credentials: 'same-origin' })
      .then(function (r) { engine.ok = r.ok; })
      .catch(function () { engine.ok = false; });
  }

  function call(acc, action, payload) {
    return fetch(BASE + '/drip-api?account_id=' + encodeURIComponent(acc), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, payload: payload || {} }),
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (j) {
      if (!j || j.ok === false) throw new Error((j && j.error) || 'failed');
      return j.data;
    });
  }

  // ── reply box helpers ──
  function panel() { return document.querySelector('.right-wrap'); }
  function editor() { return document.querySelector('.ProseMirror'); }
  function isNoteMode() {
    // amber Send button = private note (ReplyBottomPanel :color="isNote ? 'amber' : 'blue'")
    var w = panel();
    if (!w) return false;
    return !!w.querySelector('[class*="n-amber"]');
  }
  function draftText() {
    var e = editor();
    if (!e) return '';
    return (e.innerText || '').replace(/ /g, ' ').trim();
  }
  function clearDraft() {
    var e = editor();
    if (!e) return;
    try {
      e.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (err) { /* ProseMirror keeps the text; the agent clears it — never a lost message */ }
  }

  // ── time helpers ──
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toLocalInput(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function inAnHour() { return new Date(Date.now() + 3600000); }
  function tomorrow9() {
    var d = new Date();
    d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d;
  }
  function fmt(iso) {
    var d = new Date(iso);
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ── popover ──
  function closePop() {
    var p = document.getElementById(POP_ID);
    if (p) p.remove();
    document.removeEventListener('click', onDocClick, true);
  }
  function onDocClick(e) {
    var p = document.getElementById(POP_ID);
    if (!p) return;
    var b = document.getElementById(BTN_ID);
    if (p.contains(e.target)) return;
    if (b && b.contains(e.target)) return;
    closePop();
  }

  function row(label, onClick) {
    var it = document.createElement('button');
    it.type = 'button';
    it.className = 'text-sm rounded-lg hover:bg-n-alpha-2 text-n-slate-12';
    it.style.cssText = 'display:block;width:100%;text-align:start;padding:6px 10px;cursor:pointer;';
    it.textContent = label;
    it.addEventListener('click', onClick);
    return it;
  }
  function note(text) {
    var d = document.createElement('div');
    d.className = 'text-sm text-n-slate-11';
    d.style.cssText = 'padding:6px 10px;';
    d.textContent = text;
    return d;
  }

  function schedule(when) {
    var r = route();
    if (!r) return;
    var content = draftText();
    if (!content) { flash(t('empty')); return; }
    call(r.acc, 'schedule_message', {
      conversation_id: Number(r.conv), content: content, run_at: when.toISOString(),
    }).then(function () {
      closePop(); clearDraft(); flash(t('queued'));
    }).catch(function () { flash(t('failed')); });
  }

  function flash(msg) {
    var b = document.getElementById(BTN_ID);
    if (!b) return;
    b.setAttribute('title', msg);
    setTimeout(function () { b.setAttribute('title', t('tip')); }, 2500);
  }

  function openPop() {
    closePop();
    var r = route();
    if (!r) return;
    var b = document.getElementById(BTN_ID);
    if (!b) return;
    var rect = b.getBoundingClientRect();

    var pop = document.createElement('div');
    pop.id = POP_ID;
    pop.className = 'rounded-xl shadow-xl border border-n-strong bg-n-background text-n-slate-12';
    pop.style.cssText = 'position:fixed;z-index:9999;padding:4px;min-width:220px;max-height:340px;overflow:auto;' +
      'bottom:' + Math.round(window.innerHeight - rect.top + 8) + 'px;' +
      'inset-inline-end:' + Math.round(window.innerWidth - rect.right) + 'px;';

    pop.appendChild(row(t('inHour'), function () { schedule(inAnHour()); }));
    pop.appendChild(row(t('tomorrow'), function () { schedule(tomorrow9()); }));

    // custom time — a native datetime-local, so the browser's own picker and locale apply
    var wrap = document.createElement('div');
    wrap.style.cssText = 'padding:6px 10px;display:flex;gap:6px;align-items:center;';
    var inp = document.createElement('input');
    inp.type = 'datetime-local';
    inp.className = 'text-sm rounded-lg bg-n-alpha-1 text-n-slate-12 border border-n-weak';
    inp.style.cssText = 'padding:3px 6px;min-width:0;flex:1;';
    inp.value = toLocalInput(inAnHour());
    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'text-sm font-medium rounded-lg text-n-blue-11 hover:bg-n-alpha-2';
    go.style.cssText = 'padding:3px 8px;cursor:pointer;flex-shrink:0;';
    go.textContent = t('save');
    go.addEventListener('click', function () {
      var d = new Date(inp.value);
      if (isNaN(d.getTime())) { flash(t('failed')); return; }
      schedule(d);
    });
    wrap.appendChild(inp); wrap.appendChild(go);
    pop.appendChild(wrap);

    var hr = document.createElement('div');
    hr.style.cssText = 'height:1px;margin:4px 0;background:var(--slate-4, rgba(0,0,0,.08));';
    pop.appendChild(hr);
    pop.appendChild(note(t('queue')));
    var list = document.createElement('div');
    pop.appendChild(list);
    list.appendChild(note('…'));

    document.body.appendChild(pop);
    setTimeout(function () { document.addEventListener('click', onDocClick, true); }, 0);

    call(r.acc, 'scheduled_messages', { conversation_id: Number(r.conv) })
      .then(function (rows) {
        list.innerHTML = '';
        if (!rows || !rows.length) { list.appendChild(note(t('none'))); return; }
        rows.forEach(function (m) {
          var line = document.createElement('div');
          line.style.cssText = 'display:flex;gap:6px;align-items:center;padding:4px 10px;';
          var txt = document.createElement('span');
          txt.className = 'text-sm text-n-slate-11';
          txt.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;unicode-bidi:plaintext;';
          txt.textContent = fmt(m.run_at) + ' · ' + String(m.content || '').slice(0, 40);
          var del = document.createElement('button');
          del.type = 'button';
          del.className = 'rounded-lg text-n-slate-11 hover:bg-n-alpha-2';
          del.style.cssText = 'padding:2px;cursor:pointer;flex-shrink:0;';
          del.innerHTML = '<span class="i-lucide-trash-2 size-3.5" style="display:block;"></span>';
          del.setAttribute('title', t('cancel'));
          del.addEventListener('click', function () {
            call(r.acc, 'cancel_scheduled_message', { id: m.id })
              .then(function () { line.remove(); if (!list.children.length) list.appendChild(note(t('none'))); })
              .catch(function () { flash(t('failed')); });
          });
          line.appendChild(txt); line.appendChild(del);
          list.appendChild(line);
        });
      })
      .catch(function () { list.innerHTML = ''; list.appendChild(note(t('none'))); });
  }

  // ── the button ──
  // Button.vue: base + colors.slate.ghost + sizes.iconOnly.sm + fontSize.sm + clickAnimation.sm
  var BTN_CLASS = 'inline-flex items-center min-w-0 gap-2 transition-all duration-100 ease-out ' +
    'border-0 rounded-lg outline-1 outline disabled:opacity-50 ' +
    'text-n-slate-12 hover:enabled:bg-n-alpha-2 focus-visible:bg-n-alpha-2 outline-transparent ' +
    'h-8 w-8 p-0 text-sm active:enabled:scale-[0.97] justify-center';

  function ensureButton() {
    var w = panel();
    if (!w) return null;
    var b = document.getElementById(BTN_ID);
    if (b && b.parentNode === w) return b;
    if (b) b.remove();
    b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.className = BTN_CLASS;
    b.style.cssText = 'flex-shrink:0;cursor:pointer;';
    b.setAttribute('title', t('tip'));
    b.innerHTML = '<span class="i-lucide-alarm-clock size-4" style="display:block;"></span>';
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (document.getElementById(POP_ID)) { closePop(); return; }
      openPop();
    });
    w.insertBefore(b, w.firstChild);
    return b;
  }

  setInterval(function () {
    probeEngine();
    var b = document.getElementById(BTN_ID);
    // Outside a conversation, without the engine, or in private-note mode → no button.
    if (!route() || !engine.ok || isNoteMode()) { if (b) { b.remove(); closePop(); } return; }
    ensureButton();
  }, TICK_MS);
})();
