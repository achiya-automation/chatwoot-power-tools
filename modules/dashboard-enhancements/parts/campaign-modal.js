// campaign-modal — enhances Chatwoot's native campaign (broadcast) modal: for every WhatsApp
// template variable field ({{N}}), shows chips that fill in a Chatwoot Liquid value
// (contact.first_name etc.) and displays a friendly "token" pill instead of the raw {{...}}.
// The Liquid value is written into the Vue model (dispatched input event) behind the scenes;
// custom attributes are loaded from the API. Also prettifies the template preview card (name,
// language, category badges).
(function () {
  if (window.__dripCampaignEnhance) return;
  window.__dripCampaignEnhance = true;

  (function () {
    var st = document.createElement('style');
    st.id = 'drip-campaign-style';
    st.textContent = [
      '.drip-var-chips{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-bottom:7px}',
      '.drip-chip{font-size:12px;line-height:1.45;padding:2px 11px;border-radius:9999px;cursor:pointer;border:1px solid transparent;background:var(--n-alpha-2,rgba(0,0,0,.06));color:var(--n-slate-11,#64748b);transition:background .12s,color .12s,border-color .12s}',
      '.drip-chip:hover{background:var(--n-alpha-3,rgba(0,0,0,.1));color:var(--n-slate-12,#1e293b)}',
      '.drip-chip-custom{border-color:var(--n-blue-6,#bfdbfe);color:var(--n-blue-11,#1d4ed8)}',
      '.drip-chip-custom:hover{background:var(--n-blue-3,#dbeafe)}',
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
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  })();

  var BASE_FIELDS = [
    { label: 'שם פרטי', liquid: '{{contact.first_name}}' },
    { label: 'שם מלא',  liquid: '{{contact.name}}' },
    { label: 'טלפון',   liquid: '{{contact.phone_number}}' },
    { label: 'אימייל',  liquid: '{{contact.email}}' },
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
        pill.innerHTML = '<span class="drip-token-pill"><span class="lbl"></span><span class="x" title="הסר">✕</span></span>';
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
    lab.textContent = 'הוסף שדה:';
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
    var inputs = document.querySelectorAll('input[placeholder^="הזן ערך"]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].getAttribute('data-drip-var')) continue;
      inputs[i].setAttribute('data-drip-var', '1');
      augmentVarInput(inputs[i]);
    }
  }

  // ── prettify the template preview card ──
  var LANG_NAMES = { he: 'עברית', en: 'אנגלית', en_us: 'אנגלית', ar: 'ערבית' };
  var LANG_FLAGS = { he: '🇮🇱', en: '🇺🇸', en_us: '🇺🇸', ar: '🇸🇦' };
  var CAT_NAMES  = { MARKETING: 'שיווקי', UTILITY: 'שירותי', AUTHENTICATION: 'אימות' };
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

  // bootstrap: independent of sequences-nav.js's own bootstrap (each part module can be
  // installed on its own) — when both are installed together, the combined effect is
  // identical to the original single-IIFE version, just via two observers instead of one.
  loadCustomFields();
  var enhanceTimer;
  new MutationObserver(function () { clearTimeout(enhanceTimer); enhanceTimer = setTimeout(function () { enhanceCampaign(); enhancePreviewCard(); }, 150); })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () { enhanceCampaign(); enhancePreviewCard(); }, 500);
})();
