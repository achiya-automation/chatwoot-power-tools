// bot-mode — injected as part of DASHBOARD_SCRIPTS (Chatwoot's InstallationConfig hook, loaded
// last in <body> on every dashboard page except login). Inside a conversation, shows WHO is
// answering it right now — the bot or a human — and gives one button to switch, in both
// directions.
//
// The problem it fixes: Chatwoot ships no control for this at all. `assignee_agent_bot` decides
// whether the webhook bot is called (agent_bot_listener.rb#agent_bots_for pushes every event to
// `conversation.assignee_agent_bot` regardless of the inbox-level AgentBotInbox status), but the
// dashboard never shows the field and offers no way to set or clear it. The obvious workaround —
// a Macro with `assign_agent`/`remove_specific_agent_bot` — is broken in stock Chatwoot 4.16.2:
//   • `assign_agent(["AgentBot:12"])` → ActionService#agent_belongs_to_inbox? compares that
//     STRING against an array of integer user ids, so it returns false and the action returns
//     silently, having done nothing.
//   • `remove_specific_agent_bot` exists only in the dashboard's own macro editor
//     (useMacros.js, macros/constants.js) — there is NO server-side method by that name, so
//     Macros::ExecutionService#perform raises NoMethodError straight into its `rescue
//     StandardError` and swallows it into the exception tracker.
// Both fail with no error surfaced to the agent, which is why a conversation can sit in `open`
// with the bot still attached and still replying underneath a human.
//
// ⚠️ The MACRO is the primary fix, not this file — see
// modules/sequences/deploy/chatwoot-initializers/macro_agent_bot_actions.rb, which implements
// both actions server-side. That matters because macros are the only conversation action the
// Chatwoot MOBILE app exposes, and DASHBOARD_SCRIPTS never runs there. This part is the web
// dashboard's companion: it supplies the piece a macro cannot — the STANDING INDICATOR of who
// is answering right now — plus a one-click shortcut. Removing it costs the indicator; removing
// the initializer costs the ability to switch at all from a phone.
//
// How the two directions are performed — both are stock, documented Chatwoot endpoints:
//   → to a human: POST conversations/:id/toggle_status {status:'open'}. The controller's
//     `handle_human_open` clears `assignee_agent_bot` and assigns the conversation to the
//     calling agent. It runs whenever the RESULTING status is open, so it also detaches the bot
//     from a conversation that was already open — which is exactly the stuck state above.
//   → back to the bot: POST conversations/:id/assignments {assignee_id:<botId>,
//     assignee_type:'AgentBot'}. Conversations::AssignmentService#assign_agent_bot clears the
//     human assignee and sets `assignee_agent_bot`. This is the direction that has no
//     equivalent anywhere in the UI today: once a bot is detached it can never be reattached.
//
// ⚠️ Do NOT copy 99digital's status mapping (open=bot / pending=manual). Stock Chatwoot is the
// reverse (a bot inbox opens conversations as `pending`, conversation.rb:296-308) — and status
// is the wrong signal either way, because an agent can set `pending` by hand with no bot in
// sight, and a bot can stay attached to an `open` one. `meta.assignee_type` is the only
// authoritative answer, and it is already in the payload the dashboard receives.
//
// Native parity notes (verified against Chatwoot 4.16.2 sources + the compiled dashboard CSS on
// the server via lib/native-parity-check.sh):
// - conversations/partials/_conversation.json.jbuilder emits meta.assignee_type='AgentBot'
//   whenever conversation.assigned_entity is the bot.
// - Icons are Tailwind-purged: only icons Chatwoot itself uses survive. `i-lucide-headset` (the
//   obvious "human agent" icon) is NOT compiled and renders as an empty box; `i-lucide-bot` and
//   `i-lucide-user-round` are. Re-verify before swapping any icon here.
// - Positioning mirrors sequences/inject/journey-launch.js: fixed, `inset-inline-end` (logical,
//   correct in both RTL and LTR), stacked above that pill so the two never overlap.
// - Like journey-launch, it gates itself: accounts with no conversational bot render nothing at
//   all, so this adds no chrome to the accounts it cannot help.
// DOM-independent — anchored to <body>, not to Chatwoot's component tree.
(function () {
  if (window.__cwptBotMode) return;
  window.__cwptBotMode = true;

  var PILL_ID = 'cwpt-bot-mode';
  var POP_ID = 'cwpt-bot-mode-pop';
  var CONV_TTL = 15000;        // re-read the current conversation at most this often
  var BOTS_TTL = 300000;       // re-list the account's bots at most every 5 minutes
  var TICK_MS = 1200;

  function locale() {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
  }
  var I18N = {
    he: {
      bot: 'הבוט מטפל בשיחה', human: 'בטיפול אישי',
      toHuman: 'העברה לטיפול אישי', toBot: 'החזרה לבוט',
      working: 'רגע…', failed: 'הפעולה נכשלה', pick: 'בחר בוט',
    },
    en: {
      bot: 'A bot is handling this', human: 'Handled by a human',
      toHuman: 'Take over', toBot: 'Hand back to bot',
      working: 'Working…', failed: 'Action failed', pick: 'Choose a bot',
    },
  };
  function t(k) { return (I18N[locale()] || I18N.en)[k]; }

  function route() {
    var m = location.pathname.match(/\/accounts\/(\d+)\/(?:custom_view\/\d+\/)?conversations\/(\d+)/);
    return m ? { acc: m[1], conv: m[2] } : null;
  }

  // devise-token-auth headers out of the session cookie — same helper shape as campaign-modal.
  function authHeaders() {
    try {
      var raw = (document.cookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
      if (!raw) return null;
      var d = JSON.parse(decodeURIComponent(raw));
      if (typeof d === 'string') d = JSON.parse(d);
      if (!d || !d['access-token']) return null;
      return {
        'access-token': d['access-token'], 'token-type': d['token-type'] || 'Bearer',
        client: d.client, expiry: d.expiry, uid: d.uid,
      };
    } catch (e) { return null; }
  }
  function jsonHeaders() {
    var h = authHeaders();
    if (!h) return null;
    h.Accept = 'application/json';
    return h;
  }

  // ── account bots ─────────────────────────────────────────────────────────────
  // Only CONVERSATIONAL bots belong in this menu. The engine provisions its own AgentBot per
  // account purely to hold an API token (see store.js#makeAccountClient / drip.account_tokens);
  // it has an empty outgoing_url and answers nothing, so handing a conversation to it would
  // silence the conversation instead of automating it. Empty url ⇒ not a destination.
  var bots = { acc: '', at: 0, list: [], inflight: false };
  function loadBots(acc) {
    if (bots.inflight) return;
    if (acc === bots.acc && Date.now() - bots.at < BOTS_TTL) return;
    var h = jsonHeaders();
    if (!h) return;
    bots.inflight = true;
    fetch('/api/v1/accounts/' + acc + '/agent_bots', { credentials: 'same-origin', headers: h })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (list) {
        bots.acc = acc; bots.at = Date.now();
        bots.list = (list || [])
          .filter(function (b) { return b && b.id && b.outgoing_url; })
          .map(function (b) { return { id: b.id, name: b.name || ('#' + b.id) }; });
      })
      .catch(function () { bots.acc = acc; bots.at = Date.now(); bots.list = []; })
      .finally(function () { bots.inflight = false; });
  }

  // ── current conversation ─────────────────────────────────────────────────────
  var conv = { key: '', byBot: false, at: 0, inflight: false };
  function loadConv(r) {
    var key = r.acc + '/' + r.conv;
    if (conv.inflight) return;
    if (key === conv.key && Date.now() - conv.at < CONV_TTL) return;
    var h = jsonHeaders();
    if (!h) return;
    conv.inflight = true;
    fetch('/api/v1/accounts/' + r.acc + '/conversations/' + r.conv,
          { credentials: 'same-origin', headers: h })
      .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
      .then(function (j) {
        var cur = route();
        if (!cur || cur.acc + '/' + cur.conv !== key) return;   // navigated away mid-flight
        var meta = (j && (j.meta || (j.payload && j.payload.meta))) || {};
        conv.key = key; conv.at = Date.now(); conv.byBot = meta.assignee_type === 'AgentBot';
      })
      .catch(function () { conv.key = key; conv.at = Date.now(); conv.byBot = false; })
      .finally(function () { conv.inflight = false; });
  }
  function invalidate() { conv.at = 0; conv.key = ''; }

  // ── UI ───────────────────────────────────────────────────────────────────────
  function ensurePill() {
    var el = document.getElementById(PILL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = PILL_ID;
    el.className = 'text-sm rounded-full shadow-lg border border-n-weak bg-n-background text-n-slate-12';
    el.style.cssText = 'position:fixed;bottom:140px;inset-inline-end:18px;z-index:9998;' +
      'padding:6px 12px;display:none;align-items:center;gap:8px;';
    el.innerHTML =
      '<span data-cwpt="icon" class="i-lucide-bot size-4 text-n-blue-11" style="display:inline-block;vertical-align:-3px;"></span>' +
      '<span data-cwpt="label"></span>' +
      '<button type="button" data-cwpt="act" class="text-sm font-medium rounded-lg text-n-blue-11 hover:bg-n-alpha-2" ' +
      'style="padding:2px 8px;cursor:pointer;">' +
      '<span data-cwpt="act-label"></span></button>';
    el.querySelector('[data-cwpt="act"]').addEventListener('click', onAction);
    document.body.appendChild(el);
    return el;
  }

  function closePop() {
    var p = document.getElementById(POP_ID);
    if (p) p.remove();
    document.removeEventListener('click', onDocClick, true);
  }
  function onDocClick(e) {
    var p = document.getElementById(POP_ID);
    if (!p) return;
    var pill = document.getElementById(PILL_ID);
    if (p.contains(e.target)) return;
    if (pill && pill.contains(e.target)) return;
    closePop();
  }
  function openBotPicker() {
    closePop();
    var pop = document.createElement('div');
    pop.id = POP_ID;
    pop.className = 'rounded-xl shadow-xl border border-n-strong bg-n-background text-n-slate-12';
    pop.style.cssText = 'position:fixed;bottom:180px;inset-inline-end:18px;z-index:9999;padding:4px;min-width:190px;';
    bots.list.forEach(function (b) {
      var it = document.createElement('button');
      it.type = 'button';
      it.className = 'text-sm rounded-lg hover:bg-n-alpha-2 text-n-slate-12';
      it.style.cssText = 'display:block;width:100%;text-align:start;padding:6px 10px;cursor:pointer;';
      it.textContent = b.name;
      it.addEventListener('click', function () { closePop(); handToBot(b.id); });
      pop.appendChild(it);
    });
    document.body.appendChild(pop);
    setTimeout(function () { document.addEventListener('click', onDocClick, true); }, 0);
  }

  var busy = false;
  function withBusy(promise) {
    var el = ensurePill();
    var btn = el.querySelector('[data-cwpt="act"]');
    var lbl = el.querySelector('[data-cwpt="act-label"]');
    busy = true; btn.disabled = true; lbl.textContent = t('working');
    return promise
      .then(function () { invalidate(); })
      .catch(function () { lbl.textContent = t('failed'); })
      .finally(function () {
        busy = false; btn.disabled = false;
        setTimeout(function () { if (!busy) render(); }, 1200);
      });
  }

  function takeOver() {
    var r = route();
    if (!r) return;
    var h = jsonHeaders();
    if (!h) return;
    h['Content-Type'] = 'application/json';
    withBusy(
      fetch('/api/v1/accounts/' + r.acc + '/conversations/' + r.conv + '/toggle_status',
            { method: 'POST', credentials: 'same-origin', headers: h, body: JSON.stringify({ status: 'open' }) })
        .then(function (res) { if (!res.ok) throw new Error(res.status); })
    );
  }

  function handToBot(botId) {
    var r = route();
    if (!r) return;
    var h = jsonHeaders();
    if (!h) return;
    h['Content-Type'] = 'application/json';
    withBusy(
      fetch('/api/v1/accounts/' + r.acc + '/conversations/' + r.conv + '/assignments',
            { method: 'POST', credentials: 'same-origin', headers: h,
              body: JSON.stringify({ assignee_id: botId, assignee_type: 'AgentBot' }) })
        .then(function (res) { if (!res.ok) throw new Error(res.status); })
    );
  }

  function onAction() {
    if (busy) return;
    if (conv.byBot) { closePop(); takeOver(); return; }
    if (bots.list.length === 1) { handToBot(bots.list[0].id); return; }
    if (bots.list.length > 1) { openBotPicker(); }
  }

  function render() {
    var r = route();
    var el = document.getElementById(PILL_ID);
    // Not in a conversation, or this account has no conversational bot → render nothing.
    if (!r || !bots.list.length) { if (el) { el.style.display = 'none'; } closePop(); return; }
    el = ensurePill();
    var icon = el.querySelector('[data-cwpt="icon"]');
    var lbl = el.querySelector('[data-cwpt="label"]');
    var act = el.querySelector('[data-cwpt="act-label"]');
    if (conv.byBot) {
      icon.className = 'i-lucide-bot size-4 text-n-blue-11';
      lbl.textContent = t('bot');
      if (!busy) act.textContent = t('toHuman');
    } else {
      icon.className = 'i-lucide-user-round size-4 text-n-slate-11';
      lbl.textContent = t('human');
      if (!busy) act.textContent = t('toBot');
    }
    icon.style.cssText = 'display:inline-block;vertical-align:-3px;';
    el.style.display = 'flex';
  }

  setInterval(function () {
    var r = route();
    if (!r) { render(); return; }
    loadBots(r.acc);
    loadConv(r);
    if (!busy) render();
  }, TICK_MS);
})();
