// Minimal scoped styles — only what Chatwoot Tailwind cannot express inline.
// Design tokens (bg-n-brand, text-n-slate-12, etc.) are compiled globally in
// the Chatwoot page and auto-adapt to dark mode, so no body.dark overrides here.
export const STYLES = `
dialog.cwi-dlg{padding:0;border:0;background:transparent;width:100%;max-width:42rem;max-height:90vh;overflow:visible;color:inherit}
/* הרקע מאחורי החלון — זהה ל-Dialog.vue של Chatwoot (bg-n-alpha-black1 + blur 4px).
   ‎--black-alpha-1 הוא 12% במצב בהיר ו-30% בכהה; קודם היה כאן 50% קבוע, כלומר כהה
   פי ארבעה מהמקור וללא התאמה לערכת הנושא. */
dialog.cwi-dlg::backdrop{background:rgba(0,0,0,.12);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
/* wizard.js מוסיף את המחלקה dark על ה-dialog עצמו (ראה שם: הוא ב-top layer ולא
   יורש מהדף), ולכן הסלקטור חייב להיות על אותו אלמנט ולא על אב. */
dialog.cwi-dlg.dark::backdrop{background:rgba(0,0,0,.3)}
dialog.cwi-dlg::backdrop{animation:cwiBackdrop .2s ease-out}
@keyframes cwiBackdrop{from{opacity:0}to{opacity:1}}
/* Animate the inner card, NOT the <dialog>: a transform on the dialog would make it
   the containing block for the fixed dropdown panel (panel is a child of the dialog),
   breaking viewport-relative positioning. The modal is a sibling of the panel, so its
   transform can't affect the panel. */
.cwi-modal{max-height:90vh;overflow:auto;animation:cwiIn .2s ease-out}
@keyframes cwiIn{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
/* הרקע מגיע ממחלקת bg-n-brand של Chatwoot (הכחול הרשמי) — לא ממשתנה:
   --color-n-brand לא קיים ב-CSS המקומפל וה-fallback צבע את הפס באינדיגו זר. */
.cwi-prog-fill{height:100%;transition:width .2s}
/* ⚠️ border-bottom בלי צבע = currentColor לפי מפרט CSS, וכיוון שהגיליון הזה מוזרק
   ל-head בזמן ריצה הוא בא *אחרי* הגיליון של Chatwoot ומנצח את border-n-weak שעל התא.
   התוצאה הייתה קווי טבלה בצבע הטקסט — כהים בהרבה מכל טבלה אחרת בדשבורד. */
.cwi-tbl-cell{border-bottom:1px solid rgb(var(--border-weak))}
.cwi-cs-panel{transition:opacity .2s ease-out}
/* Background-import pill — fixed to the bottom start corner (dir-aware via
   inset-inline-start; the pill carries its own dir attribute). Below the browser
   top layer, so any open Chatwoot <dialog> still covers it. */
.cwi-pill{position:fixed;bottom:16px;inset-inline-start:16px;z-index:2147483000;width:320px;max-width:calc(100vw - 32px);animation:cwiIn .2s ease-out}
`;
