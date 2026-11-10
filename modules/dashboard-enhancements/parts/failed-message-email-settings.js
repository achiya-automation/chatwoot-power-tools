// Account setting: email someone when an outgoing message fails to send.
// The Rails side (failed_message_email.rb) sends the email and lets Chatwoot's own account
// update accept the setting. This adds its section to Settings -> Account, built from the
// markup Chatwoot renders for its own sections there, so it follows the native look in
// light and dark mode. Only administrators reach that page, and only they may save.
(function () {
  if (window.__cwptFailedMessageEmail) return;
  window.__cwptFailedMessageEmail = true;

  var KEY = 'failed_message_email';
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var I18N = {
    he: {
      title: 'מייל כשהודעה לא נשלחת',
      about: 'כשהודעה שנשלחה ללקוח נכשלת, נשלח מייל עם שם הלקוח, הסיבה וקישור לשיחה. הודעות של קמפיין לא נכללות.',
      to: 'לאן לשלוח',
      hint: 'אפשר כמה כתובות, עם פסיק ביניהן',
      sender: 'גם לנציג ששלח את ההודעה',
      save: 'שמירה',
      saving: 'שומר…',
      saved: 'נשמר',
      empty: 'צריך לפחות כתובת אחת, או לסמן את הנציג ששלח',
      invalid: 'הכתובת לא תקינה: ',
      failed: 'השמירה נכשלה',
    },
    en: {
      title: 'Email when a message fails to send',
      about: 'When a message to a customer fails, an email goes out with the customer, the reason and a link to the conversation. Campaign messages are not included.',
      to: 'Send to',
      hint: 'Several addresses can be separated with commas',
      sender: 'Also the agent who sent the message',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      empty: 'Add at least one address, or tick the sending agent',
      invalid: 'Not a valid address: ',
      failed: 'Could not save',
    },
  };
  // Chatwoot sets #app[dir=rtl] only for RTL locales.
  function locale() {
    var app = document.querySelector('#app[dir]');
    return (app || document.documentElement).getAttribute('dir') === 'rtl' ? 'he' : 'en';
  }
  function t(key) { return I18N[locale()][key]; }

  // The classes of Chatwoot's own settings section, switch, input and button.
  var CLASS = {
    section: 'grid grid-cols-1 pt-8 gap-5 [interpolate-size:allow-keywords] border-t border-n-weak pb-8',
    title: 'text-heading-2 text-n-slate-12 flex items-center gap-2',
    about: 'text-n-slate-11 text-body-main mt-2',
    toggle: 'group relative h-4 rounded-full w-7 flex-shrink-0 select-none focus:outline-none focus:ring-1 ' +
      'focus:ring-n-brand focus:ring-offset-n-slate-2 focus:ring-offset-2 transition-colors duration-200 ' +
      'ease-in-out disabled:cursor-not-allowed disabled:opacity-50 ',
    knob: 'absolute top-1/2 ltr:left-0.5 rtl:right-0.5 -translate-y-1/2 transition-transform duration-[350ms] ' +
      'ease-[cubic-bezier(0.34,1.56,0.64,1)] ',
    knobOn: 'ltr:translate-x-3 rtl:-translate-x-3',
    knobOff: 'ltr:translate-x-0 rtl:translate-x-0',
    dot: 'block h-3 w-3 rounded-full bg-n-background shadow-md',
    label: 'flex justify-between text-sm font-medium leading-6 text-n-slate-12',
    input: 'w-full outline-n-weak hover:outline-n-slate-6 focus:outline-n-brand h-10 !px-3 !py-2.5 block ' +
      'reset-base text-sm !mb-0 outline outline-1 border-none border-0 outline-offset-[-1px] rounded-lg ' +
      'bg-n-alpha-black2 placeholder:text-n-slate-10 text-n-slate-12',
    button: 'inline-flex items-center min-w-0 gap-2 transition-all duration-100 ease-out border-0 rounded-lg ' +
      'outline-1 outline disabled:opacity-50 bg-n-brand text-white hover:enabled:brightness-110 ' +
      'focus-visible:brightness-110 outline-transparent h-10 px-4 text-sm font-medium ' +
      'active:enabled:scale-[0.98] justify-center',
  };

  function accountId() {
    var match = location.pathname.match(/accounts\/(\d+)/);
    return match ? match[1] : '';
  }
  // Same auth pattern as the other dashboard parts: devise-token-auth headers from the
  // non-httpOnly cw_d_session_info cookie.
  function authHeaders() {
    try {
      var raw = (document.cookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
      if (!raw) return null;
      var d = JSON.parse(decodeURIComponent(raw));
      if (typeof d === 'string') d = JSON.parse(d);
      if (!d || !d['access-token']) return null;
      return { 'access-token': d['access-token'], 'token-type': d['token-type'], client: d.client, expiry: String(d.expiry), uid: d.uid };
    } catch (e) { return null; }
  }
  // GET reads the account, PATCH saves the setting; both answer with the account payload,
  // whose `settings` carries the stored list.
  function account(list) {
    var headers = authHeaders() || {};
    if (list) headers['Content-Type'] = 'application/json';
    var body = {};
    body[KEY] = list;
    return fetch('/api/v1/accounts/' + accountId(), {
      method: list ? 'PATCH' : 'GET',
      credentials: 'same-origin',
      headers: headers,
      body: list ? JSON.stringify(body) : undefined,
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (json) {
        if (!response.ok) throw new Error(json.message || json.error || t('failed'));
        var stored = json.settings && json.settings[KEY];
        return Array.isArray(stored) ? stored : [];
      });
    });
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function build() {
    var section = el('section', CLASS.section);
    section.setAttribute('data-cwpt-failed-message-email', '1');

    var header = el('header', 'grid grid-cols-4');
    var words = el('div', 'col-span-3');
    words.appendChild(el('h4', CLASS.title, t('title')));
    words.appendChild(el('p', CLASS.about, t('about')));
    var side = el('div', 'col-span-1');
    var sideRow = el('div', 'flex justify-end');
    var toggle = el('button');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', t('title'));
    var knob = el('span');
    knob.appendChild(el('span', CLASS.dot));
    toggle.appendChild(knob);
    sideRow.appendChild(toggle);
    side.appendChild(sideRow);
    header.appendChild(words);
    header.appendChild(side);

    var form = el('div', 'grid gap-4 text-n-slate-12');
    var field = el('div', 'space-y-1');
    var label = el('label', CLASS.label, t('to'));
    var input = el('input', CLASS.input);
    input.type = 'text';
    input.dir = 'ltr';
    input.placeholder = 'name@example.com';
    input.id = 'cwpt-failed-message-email';
    label.htmlFor = input.id;
    field.appendChild(label);
    field.appendChild(input);
    field.appendChild(el('p', 'text-xs text-n-slate-11', t('hint')));

    var senderRow = el('label', 'flex items-center gap-2 text-sm text-n-slate-12');
    var sender = el('input');
    sender.type = 'checkbox';
    senderRow.appendChild(sender);
    senderRow.appendChild(el('span', '', t('sender')));

    var actions = el('div', 'flex items-center gap-3');
    var save = el('button', CLASS.button, t('save'));
    save.type = 'button';
    var note = el('p', 'text-xs');
    note.setAttribute('role', 'status');
    actions.appendChild(save);
    actions.appendChild(note);

    form.appendChild(field);
    form.appendChild(senderRow);
    form.appendChild(actions);
    section.appendChild(header);
    section.appendChild(form);

    function say(text, bad) {
      note.textContent = text;
      note.className = 'text-xs ' + (bad ? 'text-n-ruby-9' : 'text-n-slate-11');
    }
    function setOn(on) {
      toggle.setAttribute('aria-checked', on ? 'true' : 'false');
      toggle.className = CLASS.toggle + (on ? 'bg-n-brand' : 'bg-n-slate-6');
      knob.className = CLASS.knob + (on ? CLASS.knobOn : CLASS.knobOff);
      form.hidden = !on;
    }
    function show(list) {
      input.value = list.filter(function (entry) { return entry !== 'sender'; }).join(', ');
      sender.checked = list.indexOf('sender') !== -1;
      setOn(list.length > 0);
    }
    function store(list, done) {
      toggle.disabled = save.disabled = true;
      account(list)
        .then(function (stored) {
          // A Chatwoot without the Rails half answers 200 and silently drops the setting.
          if (list.length && !stored.length) throw new Error(t('failed'));
          show(stored);
          if (done) done();
        })
        .catch(function (failure) { setOn(true); say((failure && failure.message) || t('failed'), true); })
        .then(function () { toggle.disabled = save.disabled = false; save.textContent = t('save'); });
    }

    toggle.addEventListener('click', function () {
      say('');
      if (toggle.getAttribute('aria-checked') === 'true') { store([]); return; }
      // Switching on only opens the form: nothing is stored until Save, and the
      // administrator's own address is offered as the first recipient.
      if (!input.value.trim()) input.value = (authHeaders() || {}).uid || '';
      setOn(true);
      input.focus();
    });
    save.addEventListener('click', function () {
      var addresses = input.value.split(/[\s,;]+/).filter(Boolean);
      for (var i = 0; i < addresses.length; i++) {
        if (!EMAIL.test(addresses[i])) { say(t('invalid') + addresses[i], true); return; }
      }
      var list = (sender.checked ? ['sender'] : []).concat(addresses);
      if (!list.length) { say(t('empty'), true); return; }
      save.textContent = t('saving');
      say('');
      store(list, function () { say(t('saved')); });
    });

    setOn(false);
    return { section: section, show: show };
  }

  function mount() {
    if (!/\/settings\/general\/?$/.test(location.pathname)) return;
    if (document.querySelector('[data-cwpt-failed-message-email]')) return;
    // Chatwoot's own sections on this page; ours goes in before the last one (the account id).
    var sections = document.querySelectorAll('section');
    var last = null;
    for (var i = 0; i < sections.length; i++) if (sections[i].querySelector('header h4')) last = sections[i];
    if (!last) return;
    var ui = build();
    last.parentElement.insertBefore(ui.section, last);
    // No answer (signed out, or a Chatwoot without the Rails half): show nothing at all
    // rather than a switch that cannot be trusted.
    account().then(ui.show).catch(function () { ui.section.hidden = true; });
  }

  var timer;
  new MutationObserver(function () {
    clearTimeout(timer);
    timer = setTimeout(mount, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(mount, 500);
})();
