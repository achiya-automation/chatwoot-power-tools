// Upload button for a WhatsApp template's media header.
// Chatwoot's WhatsAppTemplateParser asks for a public media URL (image / video / document)
// and offers no way to attach a file. This adds one native-looking button beside that field:
// pick a file -> it is stored by the addons engine (POST /drip-api/media, WhatsApp limits
// enforced there) -> the public URL lands in the field through Vue's own v-model path.
// Nothing else on the form is touched: no chips, no overlays, no remembered media.
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

  // The parser's placeholder carries the header format: "Enter Image URL" / "הזן כתובת URL של
  // Document". Requiring both "URL" and a format word keeps every other url input untouched.
  function formatOf(input) {
    var placeholder = (input && input.placeholder) || '';
    if (!/url/i.test(placeholder)) return '';
    var match = /\b(Image|Video|Document)\b/i.exec(placeholder);
    return match ? match[1].toUpperCase() : '';
  }
  function accountId() {
    var match = location.pathname.match(/accounts\/(\d+)/);
    return match ? match[1] : '';
  }
  // The parser shows the picked template's name in an <h3>; it tells two templates apart when
  // Vue reuses the same <input> node for both.
  function templateName(input) {
    var node = input;
    for (var i = 0; i < 10 && node; i++) {
      var title = node.querySelector && node.querySelector('h3');
      if (title) return (title.textContent || '').trim();
      node = node.parentElement;
    }
    return '';
  }
  function setValue(input, value) {
    var descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(input, value); else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // A document header has a second field for the file name the recipient sees.
  // It sits in the row after ours (our own error line stands between the two).
  function fileNameInput(after) {
    var next = after && after.nextElementSibling;
    return next ? next.querySelector('input[type="text"]') : null;
  }

  function attach(input) {
    var row = input.closest('.flex.items-center') || input.parentElement;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.style.marginInlineStart = '8px';
    button.setAttribute('data-cwpt-media-upload', '1');
    button.textContent = t('upload');

    var picker = document.createElement('input');
    picker.type = 'file';
    picker.hidden = true;

    var error = document.createElement('p');
    error.className = 'text-xs text-n-ruby-9 mb-2.5';
    error.setAttribute('role', 'alert');
    error.hidden = true;

    row.appendChild(button);
    row.appendChild(picker);
    row.insertAdjacentElement('afterend', error);

    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      picker.accept = ACCEPT[formatOf(input)] || '';
      picker.click();
    });

    picker.addEventListener('change', function () {
      var file = picker.files && picker.files[0];
      picker.value = ''; // the same file can be picked again after a failure
      if (!file) return;
      var startedFor = templateName(input);
      var base = window.__CW_ADDONS_BASE || '/chatwoot-addons';
      error.hidden = true;
      button.disabled = true;
      button.textContent = t('uploading');
      fetch(base + '/drip-api/media?account_id=' + encodeURIComponent(accountId()) +
            '&format=' + encodeURIComponent(formatOf(input)) + '&locale=' + locale(), {
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
          var nameInput = fileNameInput(error);
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
