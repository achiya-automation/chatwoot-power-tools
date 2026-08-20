// waha-controls — native-looking quick replies inside WAHA's Chatwoot command conversation.
//
// WAHA exposes operational commands by listening to outgoing messages in a special Chatwoot
// conversation. The command protocol stays untouched; this enhancement presents the common
// commands as an inline bot-style message and keeps the composer for advanced/manual commands.
(function () {
  if (window.__cwptWahaControls) return;
  window.__cwptWahaControls = true;

  var PANEL_ID = 'cwpt-waha-controls';
  var STYLE_ID = 'cwpt-waha-controls-style';
  var CONTROL_CHAT_ID = 'whatsapp.integration';
  var detectionCache = { key: '', isControl: false, checkedAt: 0 };
  var activeRouteKey = '';
  var tickTimer = null;
  var requestGeneration = 0;

  function routeInfo() {
    var parts = location.pathname.split('/').filter(Boolean);
    var accountIndex = parts.indexOf('accounts');
    var conversationIndex = parts.indexOf('conversations');
    if (accountIndex === -1 || conversationIndex === -1) return null;
    var accountId = parts[accountIndex + 1];
    var conversationId = parts[conversationIndex + 1];
    if (!/^\d+$/.test(accountId || '') || !/^\d+$/.test(conversationId || '')) return null;
    return {
      accountId: accountId,
      conversationId: conversationId,
      key: accountId + ':' + conversationId,
    };
  }

  function authHeaders() {
    try {
      var raw = (document.cookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
      if (!raw) return null;
      var data = JSON.parse(decodeURIComponent(raw));
      if (typeof data === 'string') data = JSON.parse(data);
      if (!data || !data['access-token']) return null;
      return {
        'access-token': data['access-token'],
        'token-type': data['token-type'] || 'Bearer',
        client: data.client,
        expiry: data.expiry,
        uid: data.uid,
      };
    } catch (error) {
      return null;
    }
  }

  function apiUrl(info, suffix) {
    return '/api/v1/accounts/' + info.accountId + '/conversations/' + info.conversationId + (suffix || '');
  }

  function delay(ms) {
    var scale = typeof window.__CWPT_WAHA_DELAY_SCALE === 'number' ? window.__CWPT_WAHA_DELAY_SCALE : 1;
    return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, ms * scale)); });
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + PANEL_ID + '{direction:rtl;display:flex;justify-content:flex-start;width:100%;margin:0 0 8px;list-style:none;color:rgb(var(--slate-12,15 23 42));font-family:inherit}',
      '#' + PANEL_ID + ' *{box-sizing:border-box}',
      '#' + PANEL_ID + ' .cwpt-waha-bubble{width:min(28rem,calc(100% - 2rem));padding:12px 14px;border-radius:12px 12px 4px 12px;background:rgb(var(--slate-1,255 255 255));box-shadow:0 1px 2px rgba(15,23,42,.08)}',
      '#' + PANEL_ID + ' .cwpt-waha-title{margin:0;font-size:14px;line-height:1.5;font-weight:500;color:rgb(var(--slate-12,15 23 42))}',
      '#' + PANEL_ID + ' .cwpt-waha-intro{margin:3px 0 10px;font-size:12px;line-height:1.5;color:rgb(var(--slate-11,71 85 105))}',
      '#' + PANEL_ID + ' .cwpt-waha-options,#' + PANEL_ID + ' .cwpt-waha-more{display:flex;flex-wrap:wrap;gap:8px}',
      '#' + PANEL_ID + ' .cwpt-waha-button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;max-width:100%;padding:8px 14px;border:1px solid rgb(var(--blue-9,37 99 235));border-radius:999px;background:transparent;color:rgb(var(--blue-11,30 64 175));font:inherit;font-size:13px;line-height:1.3;font-weight:500;text-align:center;white-space:normal;cursor:pointer;transition:background-color .1s ease,color .1s ease,transform .1s ease}',
      '#' + PANEL_ID + ' .cwpt-waha-button:hover{background:rgb(var(--blue-3,219 234 254))}',
      '#' + PANEL_ID + ' .cwpt-waha-button:active{transform:scale(.98)}',
      '#' + PANEL_ID + ' .cwpt-waha-button:focus-visible,#' + PANEL_ID + ' summary:focus-visible,#' + PANEL_ID + ' .cwpt-waha-confirm-actions button:focus-visible{outline:2px solid rgb(var(--blue-9,37 99 235));outline-offset:2px}',
      '#' + PANEL_ID + ' .cwpt-waha-button[disabled]{cursor:not-allowed;opacity:.5}',
      '#' + PANEL_ID + ' details{margin-top:4px}',
      '#' + PANEL_ID + ' summary{display:inline-flex;align-items:center;min-height:40px;color:rgb(var(--blue-11,30 64 175));font-size:12px;font-weight:500;cursor:pointer;list-style:none;user-select:none}',
      '#' + PANEL_ID + ' summary::-webkit-details-marker{display:none}',
      '#' + PANEL_ID + ' summary::before{content:"";width:7px;height:7px;margin-left:9px;border-left:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s ease}',
      '#' + PANEL_ID + ' details[open] summary::before{transform:rotate(135deg)}',
      '#' + PANEL_ID + ' .cwpt-waha-more{padding-bottom:6px}',
      '#' + PANEL_ID + ' .cwpt-waha-more .cwpt-waha-button{min-height:36px;padding:7px 12px;font-size:12px}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm{margin-top:8px;padding:10px;border-radius:8px;background:rgb(var(--amber-3,254 243 199));color:rgb(var(--amber-12,120 53 15))}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm[hidden]{display:none}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm-title{margin:0 0 3px;font-size:13px;font-weight:700}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm-text{margin:0;font-size:12px;line-height:1.5}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm-actions{display:flex;gap:7px;margin-top:10px}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm-actions button{min-height:38px;padding:7px 12px;border:1px solid rgb(var(--amber-8,245 158 11));border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:600;cursor:pointer}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm-actions .cwpt-waha-confirm-run{background:rgb(var(--amber-9,217 119 6));border-color:rgb(var(--amber-9,217 119 6));color:white}',
      '#' + PANEL_ID + ' .cwpt-waha-status{margin-top:8px;font-size:11px;line-height:1.45;color:rgb(var(--slate-11,71 85 105))}',
      '#' + PANEL_ID + ' .cwpt-waha-status[hidden]{display:none}',
      '#' + PANEL_ID + ' .cwpt-waha-status[data-state="success"]{color:rgb(var(--green-11,21 128 61))}',
      '#' + PANEL_ID + ' .cwpt-waha-status[data-state="error"]{color:rgb(var(--red-11,185 28 28))}',
      '#' + PANEL_ID + ' .cwpt-waha-status[data-state="busy"]{color:rgb(var(--blue-11,30 64 175))}',
      '@media(max-width:640px){#' + PANEL_ID + ' .cwpt-waha-bubble{width:calc(100% - 1rem)}#' + PANEL_ID + ' .cwpt-waha-button{min-height:44px}}',
      '@media(prefers-reduced-motion:reduce){#' + PANEL_ID + ' .cwpt-waha-button,#' + PANEL_ID + ' summary::before{transition:none}}',
    ].join('');
    document.head.appendChild(style);
  }

  function appendText(parent, className, value, tagName) {
    var node = document.createElement(tagName || 'span');
    node.className = className;
    node.textContent = value;
    parent.appendChild(node);
    return node;
  }

  function actionButton(action, label) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'cwpt-waha-button';
    button.setAttribute('data-action', action);
    button.textContent = label;
    return button;
  }

  function setBusy(panel, busy) {
    panel.setAttribute('aria-busy', busy ? 'true' : 'false');
    var buttons = panel.querySelectorAll('button[data-action]');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = busy;
  }

  function showStatus(panel, message, state) {
    var status = panel.querySelector('.cwpt-waha-status');
    if (!status) return;
    status.textContent = message;
    status.hidden = false;
    status.setAttribute('data-state', state || 'idle');
  }

  async function sendCommand(info, command) {
    var headers = authHeaders();
    if (!headers) throw new Error('missing-auth');
    headers['Content-Type'] = 'application/json';
    var response = await fetch(apiUrl(info, '/messages'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: JSON.stringify({
        content: command,
        private: false,
        echo_id: 'cwpt-waha-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        content_attributes: {},
      }),
    });
    if (!response.ok) throw new Error('command-failed-' + response.status);
  }

  async function runCommands(panel, info, steps, successMessage) {
    setBusy(panel, true);
    try {
      for (var i = 0; i < steps.length; i++) {
        showStatus(panel, steps[i].progress, 'busy');
        await sendCommand(info, steps[i].command);
        if (steps[i].waitAfter) await delay(steps[i].waitAfter);
      }
      showStatus(panel, successMessage || 'הפעולה הופעלה. התוצאה תופיע בשיחה.', 'success');
    } catch (error) {
      showStatus(panel, 'לא הצלחנו להפעיל את הפעולה. רעננו את העמוד ונסו שוב.', 'error');
    } finally {
      setBusy(panel, false);
    }
  }

  var ACTIONS = {
    status: {
      steps: [{ command: 'status', progress: 'בודק את מצב החיבור…' }],
      success: 'הבדיקה נשלחה. מצב החיבור יופיע בשיחה.',
    },
    qr: {
      steps: [{ command: 'qr', progress: 'מבקש קוד QR לסריקה…' }],
      success: 'הבקשה נשלחה. קוד ה-QR יופיע בשיחה אם נדרשת סריקה.',
    },
    messages: {
      steps: [{ command: 'messages pull', progress: 'מפעיל סנכרון הודעות מהיממה האחרונה…' }],
      success: 'סנכרון ההודעות התחיל. אפשר להמשיך לעבוד בזמן שהוא פועל.',
    },
    contacts: {
      steps: [{ command: 'contacts pull', progress: 'מפעיל סנכרון אנשי קשר…' }],
      success: 'סנכרון אנשי הקשר התחיל. אפשר להמשיך לעבוד בזמן שהוא פועל.',
    },
    messageStatus: {
      steps: [{ command: 'messages status', progress: 'בודק את מצב סנכרון ההודעות…' }],
      success: 'הבדיקה נשלחה. מצב הסנכרון יופיע בשיחה.',
    },
    contactStatus: {
      steps: [{ command: 'contacts status', progress: 'בודק את מצב סנכרון אנשי הקשר…' }],
      success: 'הבדיקה נשלחה. מצב הסנכרון יופיע בשיחה.',
    },
    help: {
      steps: [{ command: 'help', progress: 'טוען את רשימת הפקודות המלאה…' }],
      success: 'רשימת הפקודות המלאה תופיע בשיחה.',
    },
    restart: {
      confirmTitle: 'לאתחל את חיבור WhatsApp?',
      confirmText: 'החיבור ייעצר לרגע ויעלה מחדש. בזמן הזה ייתכן עיכוב קצר בקבלת הודעות.',
      confirmLabel: 'אתחל את החיבור',
      steps: [{ command: 'restart', progress: 'מאתחל את החיבור…' }],
      success: 'האתחול הופעל. בדקו את מצב החיבור בעוד כמה שניות.',
    },
    reconnect: {
      confirmTitle: 'לנתק ולחבר מחדש עם קוד QR?',
      confirmText: 'החשבון יתנתק זמנית. הודעות לא יסתנכרנו עד שתסרקו בטלפון את קוד ה-QR החדש שיופיע בשיחה.',
      confirmLabel: 'נתק והצג קוד QR',
      steps: [
        { command: 'logout', progress: 'מנתק את החשבון הישן…', waitAfter: 1500 },
        { command: 'start', progress: 'מכין חיבור חדש…', waitAfter: 5000 },
        { command: 'qr', progress: 'מבקש קוד QR חדש לסריקה…' },
      ],
      success: 'החיבור נותק וקוד QR חדש התבקש. סרקו אותו מהטלפון כשהוא מופיע בשיחה.',
    },
  };

  function hideConfirmation(panel, restoreFocus) {
    var confirm = panel.querySelector('.cwpt-waha-confirm');
    if (!confirm) return;
    confirm.hidden = true;
    confirm.removeAttribute('data-action');
    if (restoreFocus) {
      var trigger = panel.querySelector('button[data-action="' + restoreFocus + '"]');
      if (trigger) trigger.focus();
    }
  }

  function askForConfirmation(panel, actionName) {
    var action = ACTIONS[actionName];
    var confirm = panel.querySelector('.cwpt-waha-confirm');
    confirm.setAttribute('data-action', actionName);
    confirm.querySelector('.cwpt-waha-confirm-title').textContent = action.confirmTitle;
    confirm.querySelector('.cwpt-waha-confirm-text').textContent = action.confirmText;
    confirm.querySelector('.cwpt-waha-confirm-run').textContent = action.confirmLabel;
    confirm.hidden = false;
    confirm.querySelector('.cwpt-waha-confirm-run').focus();
  }

  function bindPanel(panel, info) {
    panel.addEventListener('click', function (event) {
      var button = event.target.closest('button');
      if (!button || !panel.contains(button)) return;
      if (button.classList.contains('cwpt-waha-confirm-cancel')) {
        hideConfirmation(panel, panel.querySelector('.cwpt-waha-confirm').getAttribute('data-action'));
        return;
      }
      if (button.classList.contains('cwpt-waha-confirm-run')) {
        var pendingAction = panel.querySelector('.cwpt-waha-confirm').getAttribute('data-action');
        var confirmed = ACTIONS[pendingAction];
        hideConfirmation(panel);
        if (confirmed) runCommands(panel, info, confirmed.steps, confirmed.success);
        return;
      }
      var actionName = button.getAttribute('data-action');
      var action = ACTIONS[actionName];
      if (!action) return;
      if (action.confirmTitle) askForConfirmation(panel, actionName);
      else runCommands(panel, info, action.steps, action.success);
    });
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !panel.querySelector('.cwpt-waha-confirm').hidden) {
        var actionName = panel.querySelector('.cwpt-waha-confirm').getAttribute('data-action');
        hideConfirmation(panel, actionName);
      }
    });
  }

  function buildPanel(info) {
    addStyle();
    var panel = document.createElement('li');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-labelledby', 'cwpt-waha-title');

    var bubble = appendText(panel, 'cwpt-waha-bubble', '', 'section');
    var title = appendText(bubble, 'cwpt-waha-title', 'מה תרצו לעשות?', 'h2');
    title.id = 'cwpt-waha-title';
    appendText(bubble, 'cwpt-waha-intro', 'בחרו פעולה. התוצאה תופיע כאן בשיחה.', 'p');

    var options = appendText(bubble, 'cwpt-waha-options', '', 'div');
    options.setAttribute('role', 'group');
    options.setAttribute('aria-label', 'פעולות נפוצות');
    options.appendChild(actionButton('status', 'בדיקת חיבור'));
    options.appendChild(actionButton('reconnect', 'חיבור מחדש עם QR'));
    options.appendChild(actionButton('messages', 'סנכרון הודעות'));
    options.appendChild(actionButton('contacts', 'סנכרון אנשי קשר'));

    var details = document.createElement('details');
    var summary = document.createElement('summary');
    summary.textContent = 'פעולות נוספות';
    details.appendChild(summary);
    var more = appendText(details, 'cwpt-waha-more', '', 'div');
    more.appendChild(actionButton('messageStatus', 'מצב סנכרון הודעות'));
    more.appendChild(actionButton('contactStatus', 'מצב סנכרון אנשי קשר'));
    more.appendChild(actionButton('restart', 'אתחול החיבור'));
    more.appendChild(actionButton('qr', 'הצגת קוד QR'));
    more.appendChild(actionButton('help', 'כל הפקודות'));
    bubble.appendChild(details);

    var confirm = appendText(bubble, 'cwpt-waha-confirm', '', 'div');
    confirm.hidden = true;
    confirm.setAttribute('role', 'alertdialog');
    confirm.setAttribute('aria-modal', 'false');
    confirm.setAttribute('aria-labelledby', 'cwpt-waha-confirm-title');
    confirm.setAttribute('aria-describedby', 'cwpt-waha-confirm-text');
    appendText(confirm, 'cwpt-waha-confirm-title', '', 'p').id = 'cwpt-waha-confirm-title';
    appendText(confirm, 'cwpt-waha-confirm-text', '', 'p').id = 'cwpt-waha-confirm-text';
    var confirmActions = appendText(confirm, 'cwpt-waha-confirm-actions', '', 'div');
    appendText(confirmActions, 'cwpt-waha-confirm-run', '', 'button').type = 'button';
    var cancel = appendText(confirmActions, 'cwpt-waha-confirm-cancel', 'ביטול', 'button');
    cancel.type = 'button';

    var status = appendText(bubble, 'cwpt-waha-status', '', 'div');
    status.hidden = true;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('data-state', 'idle');

    bindPanel(panel, info);
    return panel;
  }

  function messageList() {
    return document.querySelector('ul.conversation-panel') || document.querySelector('.conversation-panel');
  }

  async function isControlConversation(info) {
    var now = Date.now();
    if (detectionCache.key === info.key && now - detectionCache.checkedAt < 15000) {
      return detectionCache.isControl;
    }
    var headers = authHeaders();
    if (!headers) return false;
    try {
      var response = await fetch(apiUrl(info), { credentials: 'same-origin', headers: headers });
      if (!response.ok) return false;
      var data = await response.json();
      var attrs = data && data.meta && data.meta.sender && data.meta.sender.custom_attributes;
      var matches = !!attrs && attrs.waha_whatsapp_chat_id === CONTROL_CHAT_ID;
      detectionCache = { key: info.key, isControl: matches, checkedAt: now };
      return matches;
    } catch (error) {
      return false;
    }
  }

  async function tick() {
    var generation = ++requestGeneration;
    var info = routeInfo();
    var existing = document.getElementById(PANEL_ID);
    if (!info) {
      activeRouteKey = '';
      if (existing) existing.remove();
      return;
    }
    if (activeRouteKey && activeRouteKey !== info.key && existing) existing.remove();
    activeRouteKey = info.key;
    if (document.getElementById(PANEL_ID)) return;
    var list = messageList();
    if (!list) return;
    var matches = await isControlConversation(info);
    var currentRoute = routeInfo();
    if (generation !== requestGeneration || !matches || !currentRoute || currentRoute.key !== info.key) return;
    var shouldFollowBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 160;
    list.appendChild(buildPanel(info));
    if (shouldFollowBottom) {
      setTimeout(function () { list.scrollTop = list.scrollHeight; }, 0);
    }
  }

  function scheduleTick() {
    if (tickTimer) return;
    tickTimer = setTimeout(function () {
      tickTimer = null;
      tick();
    }, 180);
  }

  new MutationObserver(scheduleTick).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', scheduleTick);
  setTimeout(tick, 500);
})();
