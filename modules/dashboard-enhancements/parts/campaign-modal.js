// campaign-modal — enhances Chatwoot's native campaign (broadcast) modal: for every WhatsApp
// template variable field ({{N}}), shows chips that fill in a Chatwoot Liquid value
// (contact.first_name etc.) and displays a friendly "token" pill instead of the raw {{...}}.
// The Liquid value is written into the Vue model (dispatched input event) behind the scenes;
// custom attributes are loaded from the API. Also prettifies the template preview card (name,
// language, category badges).
(function () {
  if (window.__dripCampaignEnhance) return;
  window.__dripCampaignEnhance = true;

  // ── i18n: Hebrew for RTL (he) users, English for everyone else. Chatwoot doesn't put the
  // locale on the DOM, but it sets #app[dir]=rtl only for Hebrew — the same signal the import
  // wizard already relies on. he→Hebrew, ltr→English (also the sane fallback for fr/es/…). ──
  var DRIP_LOCALE = (function () {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
  })();
  var I18N = {
    he: { firstName: 'שם פרטי', fullName: 'שם מלא', phone: 'טלפון', email: 'אימייל',
          remove: 'הסר', addField: 'הוסף שדה:',
          lang_he: 'עברית', lang_en: 'אנגלית', lang_ar: 'ערבית',
          cat_MARKETING: 'שיווקי', cat_UTILITY: 'שירותי', cat_AUTHENTICATION: 'אימות',
          uploadBtn: '📎 העלה קובץ', uploading: 'מעלה…', uploaded: '✓ הועלה', uploadFailed: '✗ נכשל' },
    en: { firstName: 'First name', fullName: 'Full name', phone: 'Phone', email: 'Email',
          remove: 'Remove', addField: 'Add field:',
          lang_he: 'Hebrew', lang_en: 'English', lang_ar: 'Arabic',
          cat_MARKETING: 'Marketing', cat_UTILITY: 'Utility', cat_AUTHENTICATION: 'Authentication',
          uploadBtn: '📎 Upload', uploading: 'Uploading…', uploaded: '✓ Uploaded', uploadFailed: '✗ Failed' },
  };
  function t(k) { return (I18N[DRIP_LOCALE] || I18N.en)[k] || I18N.en[k] || k; }

  (function () {
    var st = document.createElement('style');
    st.id = 'drip-campaign-style';
    st.textContent = [
      '.drip-var-chips{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-bottom:7px}',
      '.drip-chip{font-size:12px;line-height:1.45;padding:2px 11px;border-radius:9999px;cursor:pointer;border:1px solid transparent;background:var(--n-alpha-2,rgba(0,0,0,.06));color:var(--n-slate-11,#64748b);transition:background .12s,color .12s,border-color .12s}',
      '.drip-chip:hover{background:var(--n-alpha-3,rgba(0,0,0,.1));color:var(--n-slate-12,#1e293b)}',
      '.drip-chip-custom{border-color:var(--n-blue-6,#bfdbfe);color:var(--n-blue-11,#1d4ed8)}',
      '.drip-chip-custom:hover{background:var(--n-blue-3,#dbeafe)}',
      '.drip-chip:disabled{cursor:default;opacity:.6}',
      // token overlay — shows a friendly label, hides the raw Liquid
      '.drip-token-wrap{position:relative;width:100%;display:block}',
      '.drip-token-wrap.has-token > input{color:transparent!important;caret-color:transparent}',
      '.drip-token{position:absolute;top:0;bottom:0;inset-inline-start:9px;inset-inline-end:9px;display:flex;align-items:center;pointer-events:none}',
      '.drip-token-pill{display:inline-flex;align-items:center;gap:7px;pointer-events:auto;font-size:13px;font-weight:500;line-height:1;padding:5px 7px 5px 12px;border-radius:7px;background:var(--n-blue-3,#dbeafe);color:var(--n-blue-11,#1d4ed8);max-width:100%}',
      '.drip-token-pill .lbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px}',
      '.drip-token-pill .lbl::before{content:"";width:6px;height:6px;border-radius:9999px;background:currentColor;opacity:.55;flex-shrink:0}',
      '.drip-token-pill .x{pointer-events:auto;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:9999px;font-size:10px;opacity:.65;background:var(--n-blue-5,#bfdbfe);flex-shrink:0}',
      '.drip-token-pill .x:hover{opacity:1}',
      // preview card prettification
      '.drip-tpl-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}',
      '.drip-tpl-name{font-size:13.5px;font-weight:600;line-height:1.4;flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.drip-tpl-badges{display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap}',
      '.drip-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:500;padding:2px 9px;border-radius:9999px;background:var(--n-alpha-2,rgba(0,0,0,.06));color:var(--n-slate-11,#64748b);white-space:nowrap}',
      // media upload button (sits below the campaign form's media_url field)
      '.drip-media-upload{margin:2px 0 10px;display:flex}',
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  })();

  var BASE_FIELDS = [
    { label: t('firstName'), liquid: '{{contact.first_name}}' },
    { label: t('fullName'),  liquid: '{{contact.name}}' },
    { label: t('phone'),     liquid: '{{contact.phone_number}}' },
    { label: t('email'),     liquid: '{{contact.email}}' },
  ];
  var CUSTOM_FIELDS = [];          // loaded dynamically from the API
  var liquidToLabel = {};          // reverse map Liquid→label (for token display)
  function allFields() { return BASE_FIELDS.concat(CUSTOM_FIELDS); }
  function rebuildLabelMap() {
    liquidToLabel = {};
    allFields().forEach(function (f) { liquidToLabel[f.liquid] = f.label; });
  }
  rebuildLabelMap();

  // Chatwoot's API requires devise-token-auth headers (not just the session cookie). The
  // frontend keeps them in the (non-httpOnly) cw_d_session_info cookie — read and forward
  // them the same way.
  function getChatwootAuthHeaders() {
    try {
      var raw = (document.cookie.match(/(?:^|;\s*)cw_d_session_info=([^;]+)/) || [])[1];
      if (!raw) return null;
      var d = JSON.parse(decodeURIComponent(raw));
      if (typeof d === 'string') d = JSON.parse(d);   // js-cookie sometimes wraps the JSON as a string
      if (!d || !d['access-token']) return null;
      return {
        'access-token': d['access-token'],
        'token-type': d['token-type'] || 'Bearer',
        client: d.client, expiry: d.expiry, uid: d.uid,
      };
    } catch (e) { return null; }
  }

  // load contacts' custom attributes from the API (with devise-token-auth headers from the cookie)
  function loadCustomFields() {
    var m = location.pathname.match(/accounts\/(\d+)/);
    if (!m) return;
    var headers = getChatwootAuthHeaders() || {};
    headers.Accept = 'application/json';
    fetch('/api/v1/accounts/' + m[1] + '/custom_attribute_definitions',
          { credentials: 'same-origin', headers: headers })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) {
        CUSTOM_FIELDS = (list || [])
          .filter(function (d) { return d.attribute_model === 'contact_attribute'; })
          .map(function (d) {
            return { label: d.attribute_display_name || d.attribute_key,
                     liquid: '{{contact.custom_attribute.' + d.attribute_key + '}}', custom: true };
          });
        rebuildLabelMap();
        refreshAllChips();         // update holders that were already built before the fetch returned
      })
      .catch(function () {});
  }

  function setNativeValue(el, val) {
    var d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (d && d.set) d.set.call(el, val); else el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── token overlay: when the value is a known Liquid expression, show a friendly pill
  // instead of the raw {{...}} ──
  function syncToken(wrap, inp) {
    var label = liquidToLabel[(inp.value || '').trim()];
    var pill = wrap.querySelector('.drip-token');
    if (label) {
      wrap.classList.add('has-token');
      if (!pill) {
        pill = document.createElement('div');
        pill.className = 'drip-token';
        pill.innerHTML = '<span class="drip-token-pill"><span class="lbl"></span><span class="x" title="' + t('remove') + '">✕</span></span>';
        pill.querySelector('.x').addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          setNativeValue(inp, ''); syncToken(wrap, inp); inp.focus();
        });
        wrap.appendChild(pill);
      }
      pill.querySelector('.lbl').textContent = label;
    } else {
      wrap.classList.remove('has-token');
      if (pill) pill.remove();
    }
  }

  function buildChips(holder, inp, wrap) {
    holder.innerHTML = '';
    var lab = document.createElement('span');
    lab.className = 'text-xs text-n-slate-11';
    lab.style.cssText = 'font-size:12px;color:var(--n-slate-11,#64748b)';
    lab.textContent = t('addField');
    holder.appendChild(lab);
    allFields().forEach(function (f) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = f.label;
      b.className = 'drip-chip' + (f.custom ? ' drip-chip-custom' : '');
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        setNativeValue(inp, f.liquid); syncToken(wrap, inp);
      });
      holder.appendChild(b);
    });
  }

  function refreshAllChips() {
    document.querySelectorAll('.drip-var-chips').forEach(function (holder) {
      var wrap = holder.nextElementSibling;
      var inp = wrap && wrap.querySelector('input');
      if (inp) buildChips(holder, inp, wrap);
    });
  }

  function augmentVarInput(inp) {
    var col = inp.closest('.flex.flex-col') || inp.parentElement;
    if (!col) return;
    // wrap the input in a container for the token overlay (the input itself stays the same
    // element — the Vue ref remains valid)
    var wrap = document.createElement('div');
    wrap.className = 'drip-token-wrap';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    // the chips row above the field
    var holder = document.createElement('div');
    holder.className = 'drip-var-chips';
    col.insertBefore(holder, wrap);
    buildChips(holder, inp, wrap);
    inp.addEventListener('input', function () { syncToken(wrap, inp); });
    syncToken(wrap, inp);          // initial state (e.g. if there's already a value, when editing)
  }

  function enhanceCampaign() {
    // Match Chatwoot's own variable-input placeholder in BOTH locales — "הזן ערך עבור {…}"
    // (he) and "Enter value for {…}" (en). Anchoring on only the Hebrew text silently broke
    // the whole feature for English users (the inputs were never found).
    var inputs = document.querySelectorAll('input[placeholder^="הזן ערך"], input[placeholder^="Enter value"]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].getAttribute('data-drip-var')) continue;
      inputs[i].setAttribute('data-drip-var', '1');
      augmentVarInput(inputs[i]);
    }
  }

  // ── prettify the template preview card ──
  var LANG_NAMES = { he: t('lang_he'), en: t('lang_en'), en_us: t('lang_en'), ar: t('lang_ar') };
  var LANG_FLAGS = { he: '🇮🇱', en: '🇺🇸', en_us: '🇺🇸', ar: '🇸🇦' };
  var CAT_NAMES  = { MARKETING: t('cat_MARKETING'), UTILITY: t('cat_UTILITY'), AUTHENTICATION: t('cat_AUTHENTICATION') };
  function prettifyName(raw) {
    return (raw || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  // robust against Vue: we don't remove/alter elements Vue manages (that gets overwritten on
  // every render and breaks reactivity). Instead: hide Vue's own elements (Vue keeps updating
  // their text), and show our own overlay that updates idempotently on every run — survives a
  // template swap too (same card element, text just gets refreshed).
  function enhancePreviewCard() {
    var cards = document.querySelectorAll('div.bg-n-alpha-black2');
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var h3 = card.querySelector('h3');
      if (!h3) continue;
      var head = h3.parentElement;
      if (!head) continue;

      // one-time setup per card (the card stays the same element when the template changes —
      // Vue updates it in place, doesn't replace it)
      if (!card.__dripCard) {
        var langSpan = head.querySelector('span');
        if (!langSpan || langSpan.textContent.indexOf(':') === -1) continue;  // confirm this is a template card
        h3.style.display = 'none';        // hide Vue's elements (their text is still kept up to date — we read from them)
        langSpan.style.display = 'none';
        head.classList.add('drip-tpl-head');
        var myName = document.createElement('div');  // overlay not managed by Vue → survives re-render
        myName.className = 'drip-tpl-name';
        head.insertBefore(myName, h3);
        var badges = document.createElement('div');
        badges.className = 'drip-tpl-badges';
        head.appendChild(badges);
        var catRow = null;
        for (var k = card.children.length - 1; k >= 0; k--) {
          var row = card.children[k];
          if (row !== head && !row.children.length && row.textContent.indexOf(':') !== -1) {
            catRow = row; row.style.display = 'none'; break;
          }
        }
        card.__dripCard = { rawH3: h3, langSpan: langSpan, catRow: catRow, myName: myName, badges: badges };
      }

      // idempotent update on every run — reads from Vue's hidden elements (which Vue keeps
      // updating), syncs to our overlay
      var d = card.__dripCard;
      var rawName = d.rawH3.textContent.trim();
      var pretty = prettifyName(rawName);
      if (d.myName.textContent !== pretty) { d.myName.textContent = pretty; d.myName.title = rawName; }

      var lang = (d.langSpan.textContent.split(':')[1] || '').trim();
      var cat = d.catRow ? (d.catRow.textContent.split(':')[1] || '').trim() : '';
      var sig = lang + '|' + cat;
      if (d.badges.__sig !== sig) {
        d.badges.__sig = sig;
        var langKey = lang.toLowerCase();
        d.badges.innerHTML = '';
        var lb = document.createElement('span');
        lb.className = 'drip-badge';
        lb.textContent = (LANG_FLAGS[langKey] || '🌐') + ' ' + (LANG_NAMES[langKey] || lang);
        d.badges.appendChild(lb);
        if (cat) {
          var cb = document.createElement('span');
          cb.className = 'drip-badge';
          cb.textContent = '🏷️ ' + (CAT_NAMES[cat.toUpperCase()] || cat);
          d.badges.appendChild(cb);
        }
      }
    }
  }

  // ── media upload button: WhatsApp header media (IMAGE/VIDEO/DOCUMENT) already works
  // end-to-end in Chatwoot — it just wants a public media_url pasted into an <input
  // type="url"> that WhatsAppTemplateParser.vue renders once a media-header template is
  // picked. There's no "upload a file" button for it. We add one, reusing the exact same
  // /drip-api/media endpoint (+ validation) that sequences already use — no new backend.
  //
  // Finding the field: Chatwoot's own (untranslated) placeholder already embeds the header
  // format — "Enter Image URL" (en) / "הזן כתובת URL של Image" (he) — {type} is always the
  // English word even in the Hebrew string, so we read it back out instead of guessing it
  // from the preview card (which never shows the format as text anywhere). type="url" is
  // otherwise unique in this form (title/scheduled-at are text/datetime-local; inbox/
  // template/audience are comboboxes) — matching on type+placeholder-with-a-known-format-
  // word keeps this from ever touching an unrelated url field elsewhere in the dashboard.
  //
  // Chatwoot keeps the SAME <input> DOM node alive across a template switch (Vue just
  // updates its placeholder reactively) — so format is re-read fresh at click/upload time,
  // not captured once at injection time, or a template switch would silently upload against
  // a stale format. ──
  var MEDIA_ACCEPT = {
    IMAGE: 'image/jpeg,image/png',
    VIDEO: 'video/mp4,video/3gpp',
    DOCUMENT: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt',
  };
  function mediaFormatFromPlaceholder(inp) {
    var ph = (inp && inp.placeholder) || '';
    if (!/url/i.test(ph)) return '';   // require "URL" too (not just the format word) — e.g. a stray
                                        // "Profile Image" field elsewhere must never match
    var m = /\b(Image|Video|Document)\b/i.exec(ph);
    return m ? m[1].toUpperCase() : '';
  }
  function accountIdFromPath() {
    var m = location.pathname.match(/accounts\/(\d+)/);
    return m ? m[1] : '';
  }

  // ── template-media autofill: זכירת המדיה הקבועה לכל תבנית ──────────────────────
  // הבעיה: לכל תבנית עם media header, שדה ה-media_url נפתח ריק בכל שליחה (בצ'אט ובקמפיינים
  // כאחד — אותו WhatsAppTemplateParser.vue), אז צריך לבחור/להעלות מדיה מחדש כל פעם. הפתרון:
  // מאגר מרכזי בצד השרת (drip.template_media) שממנו ממלאים אוטומטית, ואליו שומרים אוטומטית
  // כל מדיה חדשה → מסונכרן בכל מקום, לכל agent, בלי localStorage. Meta מקבלת URL ציבורי
  // (ה-example.header_handle אינו שמיש לשליחה חוזרת — 403/131053, ראה migration 006).
  var TEMPLATE_MEDIA = {};              // { template_name: media_url } — נטען פעם אחת per account
  var templateMediaLoaded = false;

  // שם התבנית שנבחרה, יחסית לשדה ה-media: ה-parser מציג אותו ב-<h3> בתוך כרטיס התצוגה
  // המקדימה (.bg-n-alpha-black2), שהוא sibling של בלוק המדיה תחת אותו root. מטפסים מה-input
  // כלפי מעלה עד שמוצאים את הכרטיס. (enhancePreviewCard מסתיר את ה-h3 אך textContent נשאר גולמי.)
  function templateNameForInput(inp) {
    var node = inp;
    for (var i = 0; i < 10 && node; i++) {
      if (node.querySelector) {
        var h3 = node.querySelector('.bg-n-alpha-black2 h3');
        if (h3) return (h3.textContent || '').trim();
      }
      node = node.parentElement;
    }
    return '';
  }

  function loadTemplateMedia() {
    var base = window.__CW_ADDONS_BASE || '/chatwoot-addons';
    var acc = accountIdFromPath();
    if (!acc) return;
    fetch(base + '/drip-api?account_id=' + encodeURIComponent(acc), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'template_media', payload: {} }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && j.ok !== false && j.data) { TEMPLATE_MEDIA = j.data; templateMediaLoaded = true; autofillAllMedia(); }
      })
      .catch(function () {});
  }

  function saveTemplateMedia(name, url) {
    var base = window.__CW_ADDONS_BASE || '/chatwoot-addons';
    var acc = accountIdFromPath();
    if (!acc || !name || !/^https?:\/\//i.test(url)) return;
    fetch(base + '/drip-api?account_id=' + encodeURIComponent(acc), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save_template_media', payload: { template_name: name, media_url: url } }),
    }).catch(function () {});
  }

  // ממלא את שדה ה-URL מהמאגר — רק כשריק וטרם מולא לתבנית הנוכחית. data-drip-autofill זוכר
  // לאיזו תבנית מילאנו, כדי לא לדרוס מחיקה/עריכה ידנית של המשתמש בכל tick של ה-observer.
  function autofillMediaInput(inp) {
    var name = templateNameForInput(inp);
    if (!name) return;
    var url = TEMPLATE_MEDIA[name];
    if (!url) return;
    if ((inp.value || '').trim() === '' && inp.getAttribute('data-drip-autofill') !== name) {
      inp.setAttribute('data-drip-autofill', name);
      setNativeValue(inp, url);       // מפעיל @update:model-value של Vue → נכנס ל-processedParams.header
    }
  }

  function autofillAllMedia() {
    if (!templateMediaLoaded) return;
    var inputs = document.querySelectorAll('input[data-drip-media="1"]');
    for (var i = 0; i < inputs.length; i++) autofillMediaInput(inputs[i]);
  }

  function uploadCampaignMedia(file, format, urlInput, btn) {
    var base = window.__CW_ADDONS_BASE || '/chatwoot-addons';
    var acc = accountIdFromPath();
    btn.disabled = true;
    btn.textContent = t('uploading');
    fetch(base + '/drip-api/media?account_id=' + encodeURIComponent(acc) +
          '&format=' + encodeURIComponent(format) + '&locale=' + DRIP_LOCALE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-filename': encodeURIComponent(file.name || 'file') },
      body: file,
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j || res.j.ok === false) throw new Error((res.j && res.j.error) || 'upload failed');
        setNativeValue(urlInput, res.j.data.url); // Vue picks up the public URL through the normal v-model path
        btn.textContent = t('uploaded');
      })
      .catch(function (e) { btn.textContent = t('uploadFailed'); btn.title = e.message || ''; })
      .finally(function () { btn.disabled = false; setTimeout(function () { btn.textContent = t('uploadBtn'); }, 2500); });
  }

  function augmentMediaInput(urlInput) {
    // Chatwoot's <Input> SFC (components-next/input/Input.vue) always renders a single
    // wrapping <div> around the native <input> — one parentElement hop is stable across
    // Tailwind class changes. One more hop reaches the "flex items-center" row that lays
    // the field out, so the button lands next to it instead of inside its own flex-col
    // wrapper (which would stack it awkwardly). Falls back to the inner wrapper if
    // Chatwoot's markup ever nests differently — never throws either way.
    var inputWrap = urlInput.parentElement;
    if (!inputWrap) return;
    var row = inputWrap.parentElement || inputWrap;
    var mount = row.parentNode;
    if (!mount) return;

    var holder = document.createElement('div');
    holder.className = 'drip-media-upload';

    var file = document.createElement('input');
    file.type = 'file';
    file.style.display = 'none';
    file.accept = MEDIA_ACCEPT[urlInput.getAttribute('data-drip-media-format')] || '';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'drip-chip';
    btn.textContent = t('uploadBtn');
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var fmt = mediaFormatFromPlaceholder(urlInput) || urlInput.getAttribute('data-drip-media-format') || '';
      file.accept = MEDIA_ACCEPT[fmt] || '';
      file.click();
    });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = ''; // allow re-picking the same filename on a retry
      if (!f) return;
      var fmt = mediaFormatFromPlaceholder(urlInput) || urlInput.getAttribute('data-drip-media-format') || '';
      uploadCampaignMedia(f, fmt, urlInput, btn);
    });

    // שמירה אוטומטית למאגר: כל URL חדש בשדה (העלאה דרך הכפתור, הדבקה ידנית, או setNativeValue)
    // → נשמר. שומרים רק כשהערך שונה ממה שכבר במאגר, כך שה-autofill עצמו לא יוצר save מיותר —
    // רק שינוי אמיתי (upload/paste) נכתב, וה-cache המקומי מתעדכן מיד לזמינות בכל שדה אחר.
    urlInput.addEventListener('change', function () {
      var v = (urlInput.value || '').trim();
      if (!/^https?:\/\//i.test(v)) return;
      var name = templateNameForInput(urlInput);
      if (name && TEMPLATE_MEDIA[name] !== v) { TEMPLATE_MEDIA[name] = v; saveTemplateMedia(name, v); }
    });

    holder.appendChild(btn);
    holder.appendChild(file);
    mount.insertBefore(holder, row.nextSibling);
  }

  function enhanceCampaignMedia() {
    var inputs = document.querySelectorAll('input[type="url"]');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (inp.getAttribute('data-drip-media')) continue;
      var format = mediaFormatFromPlaceholder(inp);
      if (!format) continue; // not the WhatsApp media-header field (or Chatwoot reworded it) — leave any other url input untouched
      inp.setAttribute('data-drip-media', '1');
      inp.setAttribute('data-drip-media-format', format);
      augmentMediaInput(inp);
    }
  }

  // bootstrap: independent of sequences-nav.js's own bootstrap (each part module can be
  // installed on its own) — when both are installed together, the combined effect is
  // identical to the original single-IIFE version, just via two observers instead of one.
  loadCustomFields();
  loadTemplateMedia();
  var enhanceTimer;
  new MutationObserver(function () { clearTimeout(enhanceTimer); enhanceTimer = setTimeout(function () { enhanceCampaign(); enhancePreviewCard(); enhanceCampaignMedia(); autofillAllMedia(); }, 150); })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () { enhanceCampaign(); enhancePreviewCard(); enhanceCampaignMedia(); autofillAllMedia(); }, 500);
})();
