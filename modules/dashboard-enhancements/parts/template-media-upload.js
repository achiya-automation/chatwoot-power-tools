// Upload button for a WhatsApp template's media header.
// Chatwoot's WhatsAppTemplateParser asks for a public media URL (image / video / document)
// and offers no way to attach a file. This adds one native-looking button beside that field:
// pick a file -> it is stored by the addons engine (POST /drip-api/media, WhatsApp limits
// enforced there) -> the public URL lands in the field through Vue's own v-model path.
// Nothing else on the form is touched: no chips, no overlays, no remembered media.
//
// A template whose header is a picture or a document can have a twin with the other format
// (<name>__image / <name>__document, made by template_media_twin.rb). For such a template the
// button takes both kinds and the server sends whichever of the pair fits the file, so the
// agent works with one template. The twins themselves are hidden from the template lists.
(function () {
  if (window.__cwptTemplateMediaUpload) return;
  window.__cwptTemplateMediaUpload = true;

  var ACCEPT = {
    IMAGE: 'image/jpeg,image/png',
    VIDEO: 'video/mp4,video/3gpp',
    DOCUMENT: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt',
  };
  var I18N = {
    he: { upload: 'העלאת קובץ', uploading: 'מעלה…', failed: 'ההעלאה נכשלה' },
    en: { upload: 'Upload file', uploading: 'Uploading…', failed: 'Upload failed' },
  };
  // Chatwoot sets #app[dir=rtl] only for RTL locales. Read lazily: the script loads before Vue.
  function locale() {
    var app = document.querySelector('#app[dir]');
    return (app || document.documentElement).getAttribute('dir') === 'rtl' ? 'he' : 'en';
  }
  function t(key) { return I18N[locale()][key]; }

  // The same classes Chatwoot's own <Button slate faded sm> renders, so the button follows
  // the native palette in light and dark mode.
  var BUTTON_CLASS = 'inline-flex items-center justify-center min-w-0 gap-2 transition-all duration-100 ease-out ' +
    'border-0 rounded-lg outline-1 outline disabled:opacity-50 bg-n-slate-9/10 text-n-slate-12 ' +
    'hover:enabled:bg-n-slate-9/20 focus-visible:bg-n-slate-9/20 outline-transparent h-8 px-3 text-sm ' +
    'active:enabled:scale-[0.97] flex-shrink-0';

  // The placeholder carries the header format: "Enter Image URL" inside a conversation,
  // "Enter Document header" on the campaign form (and their translations, which keep the
  // format word). A placeholder that is itself a URL (https://example.com/image.jpg) is a
  // different field and is left alone, like every other url input.
  function formatOf(input) {
    var placeholder = (input && input.placeholder) || '';
    if (placeholder.indexOf('://') !== -1) return '';
    var match = /\b(Image|Video|Document)\b/i.exec(placeholder);
    return match ? match[1].toUpperCase() : '';
  }
  function accountId() {
    var match = location.pathname.match(/accounts\/(\d+)/);
    return match ? match[1] : '';
  }

  // ── twins ────────────────────────────────────────────────────────────────────────────
  var TWIN_SUFFIX = { IMAGE: '__image', DOCUMENT: '__document' };
  var TWIN_NAME = /^[a-z0-9_]+__(image|document)$/;
  // The campaign form shows "offer__image" as "Offer  Image (he)": underscores become spaces.
  var TWIN_LABEL = /\S {2}(Image|Document) \([A-Za-z_]+\)$/;
  function friendly(template) {
    return template.name.replace(/_/g, ' ').replace(/\b\w/g, function (l) { return l.toUpperCase(); }) +
      ' (' + (template.language || 'en') + ')';
  }
  function headerFormat(template) {
    var components = template.components || [];
    for (var i = 0; i < components.length; i++) if (components[i].type === 'HEADER') return components[i].format;
    return '';
  }
  // Same auth pattern as the other dashboard parts: devise-token-auth headers from the
  // non-httpOnly cw_d_session_info cookie.
  function authHeaders() {
    try {
      var raw = (document.cookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
      var d = raw && JSON.parse(decodeURIComponent(raw));
      if (!d || !d['access-token']) return {};
      return { 'access-token': d['access-token'], 'token-type': d['token-type'], client: d.client, expiry: String(d.expiry), uid: d.uid };
    } catch (e) { return {}; }
  }
  // The names (as a conversation shows them) and labels (as the campaign form shows them) of
  // the templates that have an approved partner with the other header format. Read from
  // Chatwoot's own inbox list, at most once a minute; any failure just means "no twins".
  var paired = { at: 0, account: '', names: {} };
  function loadPaired() {
    var account = accountId();
    if (!account || (paired.account === account && Date.now() - paired.at < 60000)) return;
    paired.account = account;
    paired.at = Date.now();
    fetch('/api/v1/accounts/' + account + '/inboxes', { credentials: 'same-origin', headers: authHeaders() })
      .then(function (response) { return response.ok ? response.json() : {}; })
      .then(function (json) {
        var names = {};
        (json.payload || []).forEach(function (inbox) {
          var approved = (inbox.message_templates || []).filter(function (template) {
            return String(template.status).toUpperCase() === 'APPROVED' && TWIN_SUFFIX[headerFormat(template)];
          });
          approved.forEach(function (template) {
            var base = template.name.replace(/__(image|document)$/, '');
            var other = headerFormat(template) === 'IMAGE' ? 'DOCUMENT' : 'IMAGE';
            var partner = approved.some(function (candidate) {
              return candidate.language === template.language && headerFormat(candidate) === other &&
                (candidate.name === base || candidate.name === base + TWIN_SUFFIX[other]);
            });
            if (partner) { names[template.name] = true; names[friendly(template)] = true; }
          });
        });
        paired.names = names;
      })
      .catch(function () {});
  }
  function takesBothKinds(input) {
    return !!TWIN_SUFFIX[formatOf(input)] && paired.names[templateName(input)] === true;
  }
  // Hide the twins wherever a template list shows them: the row is the nearest button, option,
  // list item or table row around the element whose whole text is the twin's name or label.
  function hideTwins() {
    var nodes = document.querySelectorAll('p, span, td, li, h4, [role="option"]');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.children.length || node.hasAttribute('data-cwpt-twin')) continue;
      var text = node.textContent || '';
      if (!TWIN_NAME.test(text.trim()) && !TWIN_LABEL.test(text.replace(/^\s+|\s+$/g, ''))) continue;
      node.setAttribute('data-cwpt-twin', '1');
      var row = node.closest('button, [role="option"], li, tr') || node;
      row.style.display = 'none';
    }
  }
  // The picked template's name tells two templates apart when Vue reuses the same <input>
  // node for both: an <h3> above the fields in a conversation, the picker on the campaign form.
  function templateName(input) {
    var node = input;
    for (var i = 0; i < 10 && node; i++) {
      var title = node.querySelector && node.querySelector('h3');
      if (title) return (title.textContent || '').trim();
      node = node.parentElement;
    }
    var picker = document.querySelector('#campaign-template button');
    return picker ? (picker.textContent || '').trim() : '';
  }
  function setValue(input, value) {
    var descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // A document header has a second field for the file name the recipient sees.
  // It sits in the element after ours (beside the field, our own error line stands between).
  function fileNameInput(after) {
    var next = after && after.nextElementSibling;
    return next ? next.querySelector('input[type="text"]') : null;
  }

  function attach(input) {
    // Chatwoot's <Input> wraps the field in a column. In a conversation that column sits in a
    // row, so the button goes beside the field; on the campaign form there is no row, so the
    // button goes under the field, inside the column that is removed together with it.
    var column = input.parentElement;
    var outer = column.parentElement;
    var beside = !!(outer && outer.classList.contains('items-center'));
    var row = beside ? outer : column;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    if (beside) button.style.marginInlineStart = '8px'; else button.style.alignSelf = 'flex-start';
    button.setAttribute('data-cwpt-media-upload', '1');
    button.textContent = t('upload');

    var picker = document.createElement('input');
    picker.type = 'file';
    picker.hidden = true;

    var error = document.createElement('p');
    error.className = beside ? 'text-xs text-n-ruby-9 mb-2.5' : 'text-xs text-n-ruby-9';
    error.setAttribute('role', 'alert');
    error.hidden = true;

    row.appendChild(button);
    row.appendChild(picker);
    if (beside) row.insertAdjacentElement('afterend', error); else row.appendChild(error);

    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      picker.accept = takesBothKinds(input) ? ACCEPT.IMAGE + ',' + ACCEPT.DOCUMENT : (ACCEPT[formatOf(input)] || '');
      picker.click();
    });

    picker.addEventListener('change', function () {
      var file = picker.files && picker.files[0];
      picker.value = ''; // the same file can be picked again after a failure
      if (!file) return;
      var startedFor = templateName(input);
      var base = window.__CW_ADDONS_BASE || '/chatwoot-addons';
      // With a twin behind the template the file decides the format, not the field.
      var format = formatOf(input);
      if (takesBothKinds(input)) format = /^image\//.test(file.type) ? 'IMAGE' : 'DOCUMENT';
      error.hidden = true;
      button.disabled = true;
      button.textContent = t('uploading');
      fetch(base + '/drip-api/media?account_id=' + encodeURIComponent(accountId()) +
            '&format=' + encodeURIComponent(format) + '&locale=' + locale(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'x-filename': encodeURIComponent(file.name || 'file'),
        },
        body: file,
      })
        .then(function (response) {
          return response.json().catch(function () { return {}; }).then(function (json) {
            if (!response.ok || json.ok === false || !json.data || !json.data.url) {
              throw new Error(json.error || t('failed'));
            }
            return json.data.url;
          });
        })
        .then(function (url) {
          // The agent switched template (or closed the form) while the file was uploading:
          // never drop one template's file into another.
          if (!input.isConnected || templateName(input) !== startedFor) return;
          setValue(input, url);
          var nameInput = fileNameInput(beside ? error : row);
          if (nameInput && !(nameInput.value || '').trim() && file.name) setValue(nameInput, file.name);
        })
        .catch(function (failure) {
          error.textContent = (failure && failure.message) || t('failed');
          error.hidden = false;
        })
        .then(function () {
          button.disabled = false;
          button.textContent = t('upload');
        });
    });
  }

  function scan() {
    // The button must never depend on the twins: whatever goes wrong there, it still appears.
    try { loadPaired(); hideTwins(); } catch (e) { /* no twins */ }
    var inputs = document.querySelectorAll('input[type="url"]:not([data-cwpt-media])');
    for (var i = 0; i < inputs.length; i++) {
      if (!formatOf(inputs[i])) continue;
      inputs[i].setAttribute('data-cwpt-media', '1');
      attach(inputs[i]);
    }
  }

  var timer;
  new MutationObserver(function () {
    clearTimeout(timer);
    timer = setTimeout(scan, 150);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(scan, 500);
})();
