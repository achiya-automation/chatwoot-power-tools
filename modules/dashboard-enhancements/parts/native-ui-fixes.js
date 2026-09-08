// Small readability/reachability fixes for Chatwoot 4.17's original dashboard.
// Keep the native palette, typography, component layout and message content intact.
(function () {
  if (window.__cwptNativeUiFixes) return;
  window.__cwptNativeUiFixes = true;

  var CSS = [
    // Audio.vue renders current / total time without a direction. In an RTL page
    // the two values trade places. Isolate only the native audio chip's clock.
    '#app[dir=rtl] .message-bubble-container audio+.rounded-xl .tabular-nums{direction:ltr;unicode-bidi:isolate}',
    // File.vue's filename chip inherits RTL and scrambles mixed names/extensions
    // such as קבלה_718.pdf. Keep its native right alignment while isolating it.
    '#app[dir=rtl] .message-bubble-container .h-9>[class~="max-w-36"][title]{direction:ltr;unicode-bidi:isolate;text-align:right}',
    // ConversationList.vue scrolls to the viewport edge, while the native mobile
    // sidebar launcher floats over it. Allow the last row to clear that button.
    '@media (max-width:767px){',
    '  #app:has(#mobile-sidebar-launcher) .conversations-list{padding-bottom:88px}',
    '}',
  ].join('\n');

  function mount() {
    if (document.getElementById('cwpt-native-ui-fixes')) return;
    var style = document.createElement('style');
    style.id = 'cwpt-native-ui-fixes';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
