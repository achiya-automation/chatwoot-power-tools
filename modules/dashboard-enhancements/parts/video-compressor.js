// video-compressor — client-side video compression for the Chatwoot composer (WebCodecs, via
// <addons-base>/compressor.js). WhatsApp Cloud API rejects videos over 16MB; this
// compresses them in the browser before upload, so only a small file goes out — zero server
// load. Two mechanisms below:
//   1. Auto-intercept on file-select/drop in a conversation — currently DISABLED (see note).
//   2. A manual "Compress video" button next to the composer's attach (paperclip) button —
//      ACTIVE. Opens its own file picker (outside Chatwoot's own upload component),
//      compresses in the browser, and offers the compressed file for download; the agent
//      then attaches it normally through the paperclip (a real file — no 16MB block).
// Both are absolute fail-safes: any failure falls back to the original file so the composer
// never breaks (worst case — Chatwoot's normal behavior).

(function () {
  if (window.__dripVideoComposer) return;
  window.__dripVideoComposer = { changes: 0, intercepts: 0, errors: [], disabled: true };
  var ADDONS_BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';
  // ⚠️ DISABLED: Chatwoot's composer uses vue-upload-component, which ignores programmatic
  // file injection (synthetic change/drop events aren't isTrusted), so the compressed file
  // never becomes an attachment and the video disappears. Disabled until a working injection
  // path is found. The sequences panel (which we do control) is not affected.
  return;
  /* eslint-disable */
  if (typeof VideoEncoder === 'undefined' || typeof DataTransfer === 'undefined') return; // no WebCodecs → don't intervene

  var WA_VIDEO_MAX = 16 * 1024 * 1024; // WhatsApp Cloud API limit
  var OK_MIMES = /^video\/(mp4|3gpp)$/i;

  // a video that needs handling: bigger than 16MB, or a format other than mp4/3gp (e.g. .mov)
  function isBigVideo(f) {
    return f && /^video\//i.test(f.type || '') && (f.size > WA_VIDEO_MAX || !OK_MIMES.test(f.type || ''));
  }
  // conversation context only (don't interfere with other uploads — avatar/import; those are
  // never a large video anyway)
  function inConversation() {
    return /\/accounts\/\d+\/(conversations|inbox)/i.test(location.pathname) ||
           !!document.querySelector('.conversation-details-wrap, [class*="reply"], footer');
  }

  // ── progress toast (RTL, bottom corner) ──
  var toast;
  function setToast(msg) {
    if (!toast) {
      toast = document.createElement('div');
      toast.dir = 'rtl';
      toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;' +
        'background:#1f2937;color:#fff;padding:10px 16px;border-radius:10px;font:500 13px system-ui,sans-serif;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.3);display:flex;align-items:center;gap:8px;direction:rtl;';
      document.body.appendChild(toast);
    }
    toast.textContent = '🎬 ' + msg;
  }
  function clearToast() { if (toast) { toast.remove(); toast = null; } }

  var compPromise = null;
  var CB = '?v=' + Date.now(); // cache-bust: compressor.js has a stable name (no hash) → otherwise the browser serves a stale copy after deploy
  // imports the module for its side effect (exposes window.__dripCompressor) — resilient to the bundler renaming its exports
  function getCompressor() {
    if (!compPromise) compPromise = import(ADDONS_BASE + '/compressor.js' + CB).then(function () { return window.__dripCompressor; });
    return compPromise;
  }

  // re-feeds the input with files (compressed or original) and runs Chatwoot's own handler
  function feed(input, files) {
    var dt = new DataTransfer();
    files.forEach(function (f) { try { dt.items.add(f); } catch (e) {} });
    input.files = dt.files;
    input.setAttribute('data-drip-done', '1'); // avoid re-interception
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function handle(input, files) {
    try {
      var mod = await getCompressor();
      var out = files.slice();
      for (var i = 0; i < out.length; i++) {
        if (!isBigVideo(out[i])) continue;
        setToast('מכווץ סרטון בדפדפן…');
        var res = await mod.maybeCompressForWhatsApp(out[i], {
          onProgress: function (p) { setToast('מכווץ סרטון… ' + Math.round((p || 0) * 100) + '%'); },
          onStage: function (s) { if (s === 'probe') setToast('בודק את הסרטון…'); }
        });
        if (res && res.file) out[i] = res.file;
      }
      clearToast();
      feed(input, out); // the compressed files → Chatwoot uploads them
    } catch (err) {
      clearToast();
      try { window.__dripVideoComposer.errors.push(String((err && err.message) || err)); } catch (e) {}
      try { feed(input, files); } catch (e) {} // fail-safe: the original files, never blocks the agent
    }
  }

  // intercept file selection (paperclip button) — capture phase, before Chatwoot's own handler
  document.addEventListener('change', function (e) {
    var inp = e.target;
    if (!inp || inp.tagName !== 'INPUT' || inp.type !== 'file') return;
    window.__dripVideoComposer.changes++;
    if (inp.getAttribute('data-drip-done')) { inp.removeAttribute('data-drip-done'); return; } // re-feed → let it through
    if (!inConversation()) return;
    var files = inp.files ? Array.prototype.slice.call(inp.files) : [];
    if (!files.some(isBigVideo)) return; // no large video → normal behavior
    window.__dripVideoComposer.intercepts++;
    e.stopImmediatePropagation(); e.preventDefault(); // stop Chatwoot from ever seeing the large file
    handle(inp, files);
  }, true);

  // intercept drag-and-drop — redirect to the input path (only if we found an input to
  // populate; otherwise don't intervene)
  document.addEventListener('drop', function (e) {
    try {
      var df = e.dataTransfer && e.dataTransfer.files;
      if (!df || !df.length || !inConversation()) return;
      var files = Array.prototype.slice.call(df);
      if (!files.some(isBigVideo)) return;
      var scope = (e.target.closest && e.target.closest('.conversation-details-wrap, [class*="reply"], footer, main')) || document;
      var inp = scope.querySelector('input[type="file"]');
      if (!inp) return; // no input found → let Chatwoot handle it (no regression)
      e.stopImmediatePropagation(); e.preventDefault();
      handle(inp, files);
    } catch (err) { /* fail-safe: don't intervene */ }
  }, true);
})();

// "Compress video" button next to the composer's attach (paperclip) button. Automatic
// injection into Chatwoot's vue-upload-component is blocked (the library ignores synthetic
// change/drop events, and the instance is inaccessible in a Vue 3 production build). So the
// button opens its own file picker (outside Chatwoot's control), compresses in the browser
// (WebCodecs via <addons-base>/compressor.js), and offers the compressed file for
// download — the agent then attaches it normally through the paperclip (a real file = no
// 16MB block). Zero server load.
(function () {
  if (window.__dripCompressBtn) return;
  window.__dripCompressBtn = true;
  if (typeof VideoEncoder === 'undefined') return; // no WebCodecs → don't show the button
  var ADDONS_BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';

  // ── i18n: Hebrew for RTL (he) users, English for everyone else. Chatwoot doesn't put the
  // locale on the DOM, but it sets #app[dir]=rtl only for Hebrew — the same signal the import
  // wizard already relies on. he→Hebrew, ltr→English (also the sane fallback for fr/es/…). ──
  var DRIP_LOCALE = (function () {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl') ? 'he' : 'en';
  })();
  var I18N = {
    he: { videoCompressed: 'הסרטון כווץ', close: 'סגור',
          downloadCompressed: 'הורד את הסרטון המכווץ',
          afterDownloadAttach: 'לאחר ההורדה — צרף את הקובץ דרך הסיכה',
          notAVideo: 'זה לא קובץ וידאו', checkingVideo: 'בודק את הסרטון…',
          compressingVideo: 'מכווץ סרטון…', videoAlreadyOk: 'הסרטון כבר תקין',
          attachDirectly: 'צרף אותו ישירות דרך הסיכה',
          compressionFailed: 'הדחיסה נכשלה — נסה סרטון קצר יותר',
          compressBtnTitle: 'כווץ סרטון גדול (>16MB) לשליחה בווצאפ — נדחס בדפדפן ויורד, ואז צרף דרך הסיכה' },
    en: { videoCompressed: 'Video compressed', close: 'Close',
          downloadCompressed: 'Download compressed video',
          afterDownloadAttach: 'After downloading, attach the file via the paperclip',
          notAVideo: 'This is not a video file', checkingVideo: 'Checking the video…',
          compressingVideo: 'Compressing video…', videoAlreadyOk: 'The video is already fine',
          attachDirectly: 'attach it directly via the paperclip',
          compressionFailed: 'Compression failed — try a shorter video',
          compressBtnTitle: 'Compress a large video (>16MB) for WhatsApp — compressed in your browser and downloaded, then attach it via the paperclip' },
  };
  function t(k) { return (I18N[DRIP_LOCALE] || I18N.en)[k] || I18N.en[k] || k; }

  var CB = '?v=' + Date.now();
  var compPromise = null;
  function getCompressor() {
    if (!compPromise) compPromise = import(ADDONS_BASE + '/compressor.js' + CB).then(function () { return window.__dripCompressor; });
    return compPromise;
  }
  function mb(b) { return (b / 1048576).toFixed(1) + 'MB'; }

  // ── 100% native styling (Chatwoot's own tokens, theme-aware) ──
  // download button = exact same class as Chatwoot's "Send" button (bg-n-brand text-white …)
  var SEND_BTN = 'inline-flex items-center justify-center min-w-0 gap-2 transition-all duration-100 ease-out border-0 rounded-lg outline-1 outline disabled:opacity-50 bg-n-brand text-white hover:enabled:brightness-110 focus-visible:brightness-110 outline-transparent h-8 px-3 text-sm active:enabled:scale-[0.97] w-full';
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  var card, toastTimer;
  function ensureCard() {
    if (!card) {
      card = document.createElement('div');
      card.dir = DRIP_LOCALE === 'he' ? 'rtl' : 'ltr';
      card.className = 'bg-n-solid-1 border border-n-weak rounded-xl shadow-lg px-4 py-3'; // Chatwoot's card style (adapts to light/dark)
      card.style.cssText = 'position:fixed;bottom:88px;left:50%;transform:translateX(-50%);z-index:99999;min-width:250px;max-width:90vw;direction:' + (DRIP_LOCALE === 'he' ? 'rtl' : 'ltr') + ';';
      document.body.appendChild(card);
    }
    clearTimeout(toastTimer);
  }
  function clearToast() { clearTimeout(toastTimer); if (card) { card.remove(); card = null; } }

  // status message (compressing/error) — a row inside Chatwoot's card
  function setToast(msg, ms) {
    ensureCard();
    card.innerHTML = '';
    var row = el('div', 'flex items-center gap-2 text-sm text-n-slate-12');
    row.innerHTML = '<span class="i-ph-video-camera flex-shrink-0"></span>';
    var tx = el('span', 'min-w-0'); tx.textContent = msg; row.appendChild(tx);
    card.appendChild(row);
    if (ms) toastTimer = setTimeout(clearToast, ms);
  }

  // result card with a native download button (fresh click → the download isn't blocked by
  // Safari after compression)
  function showDownload(file, before, after) {
    ensureCard();
    card.innerHTML = '';
    var head = el('div', 'flex items-center justify-between gap-3 mb-2');
    var title = el('span', 'flex items-center gap-1.5 text-sm font-medium text-n-slate-12');
    title.innerHTML = '<span class="i-ph-video-camera flex-shrink-0"></span>' + t('videoCompressed');
    var close = el('button', 'inline-flex items-center justify-center h-6 w-6 rounded-lg text-n-slate-11 hover:bg-n-alpha-2');
    close.type = 'button'; close.title = t('close'); close.innerHTML = '<span class="i-ph-x flex-shrink-0"></span>';
    close.addEventListener('click', clearToast);
    head.appendChild(title); head.appendChild(close);
    var sizes = el('p', 'text-xs text-n-slate-11 mb-2.5'); sizes.textContent = mb(before) + ' ← ' + mb(after);
    var dl = el('button', SEND_BTN); dl.type = 'button'; dl.textContent = t('downloadCompressed');
    dl.addEventListener('click', function () {
      var u = URL.createObjectURL(file);
      var a = document.createElement('a'); a.href = u; a.download = file.name || 'video.mp4';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 25000);
      toastTimer = setTimeout(clearToast, 2500);
    });
    var hint = el('p', 'text-xs text-n-slate-11 mt-2'); hint.textContent = t('afterDownloadAttach') + ' 📎';
    card.appendChild(head); card.appendChild(sizes); card.appendChild(dl); card.appendChild(hint);
  }

  async function process(file) {
    if (!file) return;
    if (!/^video\//i.test(file.type || '')) { setToast(t('notAVideo'), 3500); return; }
    try {
      setToast('🎬 ' + t('checkingVideo'));
      var mod = await getCompressor();
      var res = await mod.maybeCompressForWhatsApp(file, {
        onProgress: function (p) { setToast('🎬 ' + t('compressingVideo') + ' ' + Math.round((p || 0) * 100) + '%'); },
        onStage: function (s) { if (s === 'probe') setToast('🎬 ' + t('checkingVideo')); }
      });
      if (res.error) { setToast('⚠️ ' + res.error, 6000); return; }
      if (!res.compressed) { setToast('✓ ' + t('videoAlreadyOk') + ' (' + mb(file.size) + ') — ' + t('attachDirectly') + ' 📎', 9000); return; }
      showDownload(res.file, res.before, res.after);
    } catch (e) {
      setToast('⚠️ ' + t('compressionFailed') + ' (' + ((e && e.message) || e) + ')', 7000);
    }
  }

  function pick() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'video/*'; inp.style.display = 'none';
    inp.onchange = function () { var f = inp.files && inp.files[0]; inp.remove(); process(f); };
    document.body.appendChild(inp);
    inp.click();
  }

  var ICON = '<span class="i-ph-video-camera flex-shrink-0"></span>'; // Chatwoot's native phosphor icon (same set as the paperclip)

  // inject the button next to the paperclip (resilient to Vue re-renders via MutationObserver)
  function inject() {
    if (document.getElementById('drip-compress-btn')) return;
    var fu = document.querySelector('.file-uploads');
    if (!fu || !fu.parentElement) return;
    var paperclip = fu.querySelector('button');
    var btn = document.createElement('button');
    btn.id = 'drip-compress-btn';
    btn.type = 'button';
    btn.title = t('compressBtnTitle');
    if (paperclip) btn.className = paperclip.className; // exact same style as the paperclip
    btn.style.cssText = 'margin-inline-start:2px;';
    btn.innerHTML = ICON;
    btn.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); pick(); });
    fu.parentElement.insertBefore(btn, fu.nextSibling);
  }

  var injectTimer;
  new MutationObserver(function () { clearTimeout(injectTimer); injectTimer = setTimeout(inject, 200); })
    .observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(inject, 600);
})();
