// video-compressor — compresses an oversized WhatsApp video in the agent's browser before
// Chatwoot's composer uploads it. WhatsApp rejects videos over 16MB; the encode runs on the
// agent's machine (WebCodecs via <addons-base>/compressor.js), so only a small file goes out
// and the server never transcodes.
//
// How it plugs in: the core build (chatwoot-core-patches, useFileUpload) calls
// window.__cwptTransformUpload(file) before it validates and attaches a picked/dropped/pasted
// file. This part registers that hook. Everything is fail-safe: any error hands the original
// file back, so the composer behaves exactly like stock Chatwoot in the worst case.
//
// Only real videos that are oversized (>15.3MB) or in a non-WhatsApp container (.mov/.webm)
// are touched; images, documents and small mp4s pass through untouched. A progress card
// (Chatwoot's own tokens, light+dark) shows while the encode runs.
(function () {
  if (window.__cwptVideoCompressor) return;
  window.__cwptVideoCompressor = { runs: 0, errors: [] };
  if (typeof VideoEncoder === 'undefined') return; // no WebCodecs → leave the composer alone
  var ADDONS_BASE = window.__CW_ADDONS_BASE || '/chatwoot-addons';

  // he ↔ en from the DOM direction — the same signal every other part relies on; read lazily
  // because #app[dir] only exists after Vue rendered the account.
  function isHe() {
    var a = document.querySelector('#app[dir]');
    return ((a || document.documentElement).getAttribute('dir') === 'rtl');
  }
  var I18N = {
    he: {
      checking: 'בודק את הסרטון…',
      compressing: 'מכווץ סרטון בדפדפן…',
      done: 'הסרטון כווץ',
      failed: 'הדחיסה נכשלה — הסרטון יצורף כמו שהוא',
    },
    en: {
      checking: 'Checking the video…',
      compressing: 'Compressing the video in your browser…',
      done: 'Video compressed',
      failed: 'Compression failed — attaching the original video',
    },
  };
  function t(k) { return (isHe() ? I18N.he : I18N.en)[k]; }
  function mb(b) { return (b / 1048576).toFixed(1) + 'MB'; }

  var compPromise = null;
  // stable name (no hash) → cache-bust per page load so a deploy never serves a stale copy
  var CB = '?v=' + Date.now();
  function getCompressor() {
    if (!compPromise) {
      compPromise = import(ADDONS_BASE + '/compressor.js' + CB).then(function () {
        return window.__dripCompressor;
      });
    }
    return compPromise;
  }

  // ── progress card: Chatwoot's card recipe, so it follows light/dark ──
  var card, hideTimer;
  function showCard(msg, ms) {
    if (!card) {
      card = document.createElement('div');
      card.className = 'bg-n-solid-2 outline-1 outline outline-n-container -outline-offset-1 rounded-xl shadow-lg px-4 py-3 text-sm text-n-slate-12 flex items-center gap-2';
      card.style.cssText = 'position:fixed;bottom:96px;left:50%;transform:translateX(-50%);z-index:99999;max-width:90vw;';
      document.body.appendChild(card);
    }
    card.dir = isHe() ? 'rtl' : 'ltr';
    card.innerHTML = '<span class="i-ph-video-camera flex-shrink-0"></span>';
    var tx = document.createElement('span');
    tx.textContent = msg;
    card.appendChild(tx);
    clearTimeout(hideTimer);
    if (ms) hideTimer = setTimeout(hideCard, ms);
  }
  function hideCard() { clearTimeout(hideTimer); if (card) { card.remove(); card = null; } }

  var WA_VIDEO_MAX = Math.floor(15.3 * 1048576);
  var OK_MIMES = /^video\/(mp4|3gpp)$/i;
  function needsWork(f) {
    return f && /^video\//i.test(f.type || '') && (f.size > WA_VIDEO_MAX || !OK_MIMES.test(f.type || ''));
  }

  // The hook. `upload` is what Chatwoot hands to onFileUpload: { file: File, name, size, type, … }
  // (a vue-upload-component record, or the plain object built for pastes/recordings).
  window.__cwptTransformUpload = async function (upload) {
    var raw = upload && upload.file instanceof Blob ? upload.file : null;
    if (!raw || !needsWork(raw)) return upload;
    window.__cwptVideoCompressor.runs++;
    try {
      showCard(t('checking'));
      var mod = await getCompressor();
      var res = await mod.maybeCompressForWhatsApp(raw, {
        onStage: function (s) { if (s === 'probe') showCard(t('checking')); },
        onProgress: function (p) { showCard(t('compressing') + ' ' + Math.round((p || 0) * 100) + '%'); },
      });
      if (res && res.error) throw new Error(res.error);
      if (!res || !res.compressed || !res.file) { hideCard(); return upload; }
      showCard(t('done') + ' — ' + mb(res.before) + ' ← ' + mb(res.after), 4000);
      var out = res.file;
      return Object.assign({}, upload, { file: out, name: out.name, size: out.size, type: out.type });
    } catch (e) {
      window.__cwptVideoCompressor.errors.push(String((e && e.message) || e));
      showCard(t('failed'), 5000);
      return upload; // fail-safe: the original file, never a blocked agent
    }
  };
})();
