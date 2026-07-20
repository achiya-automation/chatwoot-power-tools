// Minimal scoped styles — only what Chatwoot Tailwind cannot express inline.
// Design tokens (bg-n-brand, text-n-slate-12, etc.) are compiled globally in
// the Chatwoot page and auto-adapt to dark mode, so no body.dark overrides here.
export const STYLES = `
dialog.cwi-dlg{padding:0;border:0;background:transparent;width:100%;max-width:42rem;max-height:90vh;overflow:visible;color:inherit}
dialog.cwi-dlg::backdrop{background:rgba(0,0,0,.5);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
dialog.cwi-dlg::backdrop{animation:cwiBackdrop .2s ease-out}
@keyframes cwiBackdrop{from{opacity:0}to{opacity:1}}
/* Animate the inner card, NOT the <dialog>: a transform on the dialog would make it
   the containing block for the fixed dropdown panel (panel is a child of the dialog),
   breaking viewport-relative positioning. The modal is a sibling of the panel, so its
   transform can't affect the panel. */
.cwi-modal{max-height:90vh;overflow:auto;animation:cwiIn .2s ease-out}
@keyframes cwiIn{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
.cwi-prog-fill{height:100%;background:var(--color-n-brand, #6366f1);transition:width .2s}
.cwi-tbl-cell{border-bottom:1px solid}
.cwi-cs-panel{transition:opacity .2s ease-out}
/* Background-import pill — fixed to the bottom start corner (dir-aware via
   inset-inline-start; the pill carries its own dir attribute). Below the browser
   top layer, so any open Chatwoot <dialog> still covers it. */
.cwi-pill{position:fixed;bottom:16px;inset-inline-start:16px;z-index:2147483000;width:320px;max-width:calc(100vw - 32px);animation:cwiIn .2s ease-out}
`;
