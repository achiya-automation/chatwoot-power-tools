// auto-direction — injected as part of DASHBOARD_SCRIPTS (Chatwoot's InstallationConfig hook,
// loaded last in <body> on every dashboard page except login). Makes each paragraph the agent
// types, and each paragraph of every message bubble, resolve its OWN writing direction from
// its OWN first strong character — instead of inheriting the single app-wide #app[dir].
//
// The problem it fixes: Chatwoot sets one direction for the whole dashboard (#app[dir]=rtl for
// Hebrew, ltr otherwise). In a Hebrew account an English sentence is laid out RTL, which moves
// its trailing punctuation to the left ("Hello world." → ".Hello world") and right-aligns it;
// in an English account the mirror image happens to every Hebrew message. Both are wrong on
// exactly the content agents read all day — and mixed-language threads are the normal case for
// Israeli accounts, so no single app-wide direction can be right.
//
// Why pure CSS and no JS: `unicode-bidi: plaintext` IS the Unicode bidi algorithm's P2/P3 rule
// ("take the paragraph direction from its first strong character"), applied per block by the
// browser — the same rule `dir="auto"` implements, but without needing an attribute on each
// element. That matters here: the alternative is a MutationObserver re-stamping dir="auto" on
// every keystroke in ProseMirror and on every message that streams in over the websocket, which
// is both a per-keystroke cost and a race against Vue re-rendering the node underneath it. CSS
// has neither: it applies to nodes that do not exist yet, survives every re-render, and cannot
// desynchronise. `text-align: start` then follows the resolved direction, so the paragraph is
// also aligned to the side it reads from.
//
// Native parity notes (verified against Chatwoot 4.16.2 sources):
// - components-next/message/bubbles/Text/FormattedContent.vue renders
//   `<span v-dompurify-html class="prose prose-bubble">`, and its HTML comes from
//   shared/helpers/MessageFormatter.js → MarkdownIt `.render()`, which wraps EVERY paragraph in
//   <p> (see MessageFormatter.spec.js). So `.prose-bubble > p` is always the paragraph box —
//   styling it is enough and we never touch the bubble's own layout (the span stays inline).
// - components/widgets/WootWriter/Editor.vue mounts ProseMirror; its doc children are the
//   block nodes the agent actually types into.
// - ConversationCard/MessagePreview.vue renders the preview as a truncated <span>; it holds raw
//   text with no <p>, so it is targeted directly.
// Every selector is additive and scoped to user-authored content. A selector that no longer
// matches after a Chatwoot upgrade simply stops applying — nothing throws, nothing breaks.
// Re-check with lib/native-parity-check.sh after each Chatwoot upgrade.
(function () {
  if (window.__cwptAutoDir) return;
  window.__cwptAutoDir = true;

  // `unicode-bidi: plaintext` needs a block box to resolve a direction for. The editor's and the
  // bubble's paragraph-level children are exactly those boxes; list items are included because a
  // bilingual list is the most common place the old behaviour was visible.
  var BLOCKS = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, dd, dt';

  function scope(sel) {
    return BLOCKS.split(', ').map(function (b) { return sel + ' ' + b; }).join(', ');
  }

  var rules = [
    // ── agent-authored text: the reply editor (ProseMirror) ──
    scope('.ProseMirror') + ' { unicode-bidi: plaintext; text-align: start; }',
    // An empty editor has no block child yet, so the caret and the placeholder still sit on the
    // app-wide side until the first character is typed. Giving the root itself plaintext makes
    // the very first keystroke land on the correct side.
    '.ProseMirror { unicode-bidi: plaintext; text-align: start; }',

    // ── received + sent message bubbles ──
    scope('.prose-bubble') + ' { unicode-bidi: plaintext; text-align: start; }',
    // Short messages with no block wrapper (activity lines, plain one-liners) resolve on the
    // span itself; it stays inline, so only the bidi resolution changes, never the layout.
    '.prose-bubble { unicode-bidi: plaintext; }',

    // ── conversation list preview ──
    // Raw text in a truncated span: plaintext alone fixes the punctuation, and because the span
    // is a grid/flex item here, text-align on it is honoured.
    '.prose-bubble, [class*="line-clamp"].text-body-main, .truncate.text-body-main { unicode-bidi: plaintext; }',
  ];

  var st = document.createElement('style');
  st.setAttribute('data-cwpt', 'auto-direction');
  st.textContent = rules.join('\n');
  (document.head || document.documentElement).appendChild(st);
})();
