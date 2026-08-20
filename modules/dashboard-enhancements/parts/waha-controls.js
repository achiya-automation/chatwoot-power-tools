// waha-controls — a clear, clickable control panel for WAHA's Chatwoot command conversation.
//
// WAHA exposes operational commands by listening to outgoing messages in a special Chatwoot
// conversation. The command protocol stays untouched; this enhancement simply turns the common
// commands into labelled controls and keeps the composer available for advanced/manual commands.
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
      '#' + PANEL_ID + '{direction:rtl;margin:0 16px 10px;padding:14px;border:1px solid rgb(var(--slate-4,226 232 240));border-radius:12px;background:rgb(var(--slate-1,255 255 255));color:rgb(var(--slate-12,15 23 42));font-family:inherit;box-shadow:0 8px 24px rgba(15,23,42,.08)}',
      '#' + PANEL_ID + ' *{box-sizing:border-box}',
      '#' + PANEL_ID + ' .cwpt-waha-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}',
      '#' + PANEL_ID + ' .cwpt-waha-title{margin:0 0 3px;font-size:14px;line-height:1.4;font-weight:700;color:rgb(var(--slate-12,15 23 42))}',
      '#' + PANEL_ID + ' .cwpt-waha-intro{margin:0;max-width:65ch;font-size:12px;line-height:1.5;color:rgb(var(--slate-11,71 85 105))}',
      '#' + PANEL_ID + ' .cwpt-waha-badge{display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:4px 9px;border-radius:999px;background:rgb(var(--green-3,220 252 231));color:rgb(var(--green-11,21 128 61));font-size:11px;font-weight:600;white-space:nowrap}',
      '#' + PANEL_ID + ' .cwpt-waha-dot{width:7px;height:7px;border-radius:50%;background:rgb(var(--green-9,34 197 94))}',
      '#' + PANEL_ID + ' .cwpt-waha-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}',
      '#' + PANEL_ID + ' .cwpt-waha-button{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;padding:9px 11px;border:1px solid rgb(var(--slate-5,203 213 225));border-radius:9px;background:rgb(var(--slate-2,248 250 252));color:rgb(var(--slate-12,15 23 42));font:inherit;text-align:right;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,box-shadow .15s ease}',
      '#' + PANEL_ID + ' .cwpt-waha-button:hover{background:rgb(var(--slate-3,241 245 249));border-color:rgb(var(--slate-7,148 163 184))}',
      '#' + PANEL_ID + ' .cwpt-waha-button:focus-visible,#' + PANEL_ID + ' summary:focus-visible,#' + PANEL_ID + ' .cwpt-waha-confirm-actions button:focus-visible{outline:2px solid rgb(var(--blue-9,37 99 235));outline-offset:2px}',
      '#' + PANEL_ID + ' .cwpt-waha-button[disabled]{cursor:not-allowed;opacity:.55}',
      '#' + PANEL_ID + ' .cwpt-waha-button.cwpt-waha-primary{background:rgb(var(--blue-3,219 234 254));border-color:rgb(var(--blue-6,147 197 253));color:rgb(var(--blue-12,30 58 138))}',
      '#' + PANEL_ID + ' .cwpt-waha-button.cwpt-waha-primary:hover{background:rgb(var(--blue-4,191 219 254))}',
      '#' + PANEL_ID + ' .cwpt-waha-icon{display:grid;place-items:center;flex:0 0 32px;width:32px;height:32px;border-radius:8px;background:rgb(var(--slate-4,226 232 240));color:currentColor}',
      '#' + PANEL_ID + ' .cwpt-waha-primary .cwpt-waha-icon{background:rgb(var(--blue-5,147 197 253))}',
      '#' + PANEL_ID + ' .cwpt-waha-icon svg{width:18px;height:18px}',
      '#' + PANEL_ID + ' .cwpt-waha-copy{display:flex;min-width:0;flex-direction:column;gap:1px}',
      '#' + PANEL_ID + ' .cwpt-waha-label{font-size:13px;line-height:1.35;font-weight:650}',
      '#' + PANEL_ID + ' .cwpt-waha-help{font-size:11px;line-height:1.35;color:rgb(var(--slate-11,71 85 105))}',
      '#' + PANEL_ID + ' .cwpt-waha-primary .cwpt-waha-help{color:rgb(var(--blue-11,30 64 175))}',
      '#' + PANEL_ID + ' details{margin-top:9px;border-top:1px solid rgb(var(--slate-4,226 232 240))}',
      '#' + PANEL_ID + ' summary{display:flex;align-items:center;min-height:44px;color:rgb(var(--slate-11,71 85 105));font-size:12px;font-weight:600;cursor:pointer;list-style:none;user-select:none}',
      '#' + PANEL_ID + ' summary::-webkit-details-marker{display:none}',
      '#' + PANEL_ID + ' summary::before{content:"";width:7px;height:7px;margin-left:9px;border-left:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s ease}',
      '#' + PANEL_ID + ' details[open] summary::before{transform:rotate(135deg)}',
      '#' + PANEL_ID + ' .cwpt-waha-more{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding-bottom:2px}',
      '#' + PANEL_ID + ' .cwpt-waha-more .cwpt-waha-button{min-height:44px;padding:7px 10px}',
      '#' + PANEL_ID + ' .cwpt-waha-more .cwpt-waha-icon{width:28px;height:28px;flex-basis:28px}',
      '#' + PANEL_ID + ' .cwpt-waha-more .cwpt-waha-help{display:none}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm{margin-top:9px;padding:11px;border:1px solid rgb(var(--amber-6,252 211 77));border-radius:9px;background:rgb(var(--amber-2,255 251 235));color:rgb(var(--amber-12,120 53 15))}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm[hidden]{display:none}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm-title{margin:0 0 3px;font-size:13px;font-weight:700}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm-text{margin:0;font-size:12px;line-height:1.5}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm-actions{display:flex;gap:7px;margin-top:10px}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm-actions button{min-height:38px;padding:7px 12px;border:1px solid rgb(var(--amber-7,245 158 11));border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12px;font-weight:650;cursor:pointer}',
      '#' + PANEL_ID + ' .cwpt-waha-confirm-actions .cwpt-waha-confirm-run{background:rgb(var(--amber-9,217 119 6));border-color:rgb(var(--amber-9,217 119 6));color:white}',
      '#' + PANEL_ID + ' .cwpt-waha-status{display:flex;align-items:center;min-height:30px;margin-top:8px;padding:5px 8px;border-radius:7px;background:rgb(var(--slate-3,241 245 249));color:rgb(var(--slate-11,71 85 105));font-size:11px;line-height:1.45}',
      '#' + PANEL_ID + ' .cwpt-waha-status[data-state="success"]{background:rgb(var(--green-3,220 252 231));color:rgb(var(--green-11,21 128 61))}',
      '#' + PANEL_ID + ' .cwpt-waha-status[data-state="error"]{background:rgb(var(--red-3,254 226 226));color:rgb(var(--red-11,185 28 28))}',
      '#' + PANEL_ID + ' .cwpt-waha-status[data-state="busy"]{background:rgb(var(--blue-3,219 234 254));color:rgb(var(--blue-11,30 64 175))}',
      '@media(max-width:640px){#' + PANEL_ID + '{margin-right:8px;margin-left:8px;padding:11px}#' + PANEL_ID + ' .cwpt-waha-grid,#' + PANEL_ID + ' .cwpt-waha-more{grid-template-columns:1fr}#' + PANEL_ID + ' .cwpt-waha-head{align-items:flex-start}#' + PANEL_ID + ' .cwpt-waha-badge{display:none}}',
      '@media(prefers-reduced-motion:reduce){#' + PANEL_ID + ' .cwpt-waha-button,#' + PANEL_ID + ' summary::before{transition:none}}',
    ].join('');
    document.head.appendChild(style);
  }

  var ICONS = {
    activity: ['M3 12h4l2.5-6 5 12 2.5-6H21'],
    qr: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h2v2h-2z', 'M18 14h2v6h-2z', 'M14 18h2v2h-2z'],
    messages: ['M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z', 'M8 9h8', 'M8 13h5'],
    contacts: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M19 8v6', 'M22 11h-6'],
    refresh: ['M20 6v6h-6', 'M20 12a8 8 0 1 0-2.34 5.66'],
    info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
    logout: ['M10 17l5-5-5-5', 'M15 12H3', 'M21 19V5a2 2 0 0 0-2-2h-6'],
  };

  function icon(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    (ICONS[name] || ICONS.info).forEach(function (d) {
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  }

  function appendText(parent, className, value, tagName) {
    var node = document.createElement(tagName || 'span');
    node.className = className;
    node.textContent = value;
    parent.appendChild(node);
    return node;
  }

  function actionButton(action, label, help, iconName, primary) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'cwpt-waha-button' + (primary ? ' cwpt-waha-primary' : '');
    button.setAttribute('data-action', action);
    var iconWrap = appendText(button, 'cwpt-waha-icon', '');
    iconWrap.appendChild(icon(iconName));
    var copy = appendText(button, 'cwpt-waha-copy', '');
    appendText(copy, 'cwpt-waha-label', label);
    if (help) appendText(copy, 'cwpt-waha-help', help);
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
    var panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-labelledby', 'cwpt-waha-title');

    var head = appendText(panel, 'cwpt-waha-head', '', 'div');
    var headingCopy = appendText(head, 'cwpt-waha-heading-copy', '', 'div');
    var title = appendText(headingCopy, 'cwpt-waha-title', 'ניהול חיבור WhatsApp', 'h2');
    title.id = 'cwpt-waha-title';
    appendText(headingCopy, 'cwpt-waha-intro', 'בחרו פעולה — אין צורך לזכור או להקליד פקודות.', 'p');
    var badge = appendText(head, 'cwpt-waha-badge', '', 'span');
    appendText(badge, 'cwpt-waha-dot', '', 'span').setAttribute('aria-hidden', 'true');
    badge.appendChild(document.createTextNode('שיחת ניהול'));

    var grid = appendText(panel, 'cwpt-waha-grid', '', 'div');
    grid.appendChild(actionButton('status', 'בדיקת חיבור', 'מציג אם WhatsApp מחובר', 'activity'));
    grid.appendChild(actionButton('reconnect', 'חיבור באמצעות קוד QR', 'מנתק ומציג קוד חדש לסריקה', 'qr', true));
    grid.appendChild(actionButton('messages', 'סנכרון הודעות', 'מייבא הודעות מהיממה האחרונה', 'messages'));
    grid.appendChild(actionButton('contacts', 'סנכרון אנשי קשר', 'מעדכן את אנשי הקשר ב-Chatwoot', 'contacts'));

    var details = document.createElement('details');
    var summary = document.createElement('summary');
    summary.textContent = 'פעולות נוספות';
    details.appendChild(summary);
    var more = appendText(details, 'cwpt-waha-more', '', 'div');
    more.appendChild(actionButton('messageStatus', 'מצב סנכרון הודעות', '', 'messages'));
    more.appendChild(actionButton('contactStatus', 'מצב סנכרון אנשי קשר', '', 'contacts'));
    more.appendChild(actionButton('restart', 'אתחול החיבור', '', 'refresh'));
    more.appendChild(actionButton('qr', 'הצגת קוד QR קיים', '', 'qr'));
    more.appendChild(actionButton('help', 'כל הפקודות המתקדמות', '', 'info'));
    panel.appendChild(details);

    var confirm = appendText(panel, 'cwpt-waha-confirm', '', 'div');
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

    var status = appendText(panel, 'cwpt-waha-status', 'התוצאה של כל פעולה תופיע כאן בשיחת הניהול.', 'div');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('data-state', 'idle');

    bindPanel(panel, info);
    return panel;
  }

  function composerAnchor() {
    return document.querySelector('.resizable-editor-wrapper') || document.querySelector('.reply-box');
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
    var anchor = composerAnchor();
    if (!anchor) return;
    var matches = await isControlConversation(info);
    var currentRoute = routeInfo();
    if (generation !== requestGeneration || !matches || !currentRoute || currentRoute.key !== info.key) return;
    anchor.parentNode.insertBefore(buildPanel(info), anchor);
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
