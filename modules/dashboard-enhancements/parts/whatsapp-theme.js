// whatsapp-theme — a WhatsApp-look skin for the Chatwoot agent dashboard, injected as part
// of DASHBOARD_SCRIPTS (see lib/assemble-dashboard-script.sh).
//
// What it changes (CSS only, no DOM rebuild): WhatsApp's palette and surfaces (light + dark),
// the chat wallpaper, bubble shapes with tails, time stamps inside bubbles, the chat list rows
// (round 49px avatars, name/time/preview/unread layout, pill filter chips), a compact single-row
// composer with a round green send button, and WhatsApp green in place of Chatwoot blue.
// One small piece of JS on top: per-day separators ("היום", "אתמול", weekday, date) between
// messages and time-only stamps (HH:mm) inside bubbles — the full date stays in the tooltip.
//
// Selectors are Chatwoot 4.17 class names (verified against the compiled dashboard bundle).
// A class that disappears in a later Chatwoot version simply stops matching — nothing breaks,
// the stock look returns for that element.
//
// Kill switch, per browser: localStorage.setItem('cwptWaTheme', 'off') and reload.
//
// ⛔ מחלקות Tailwind עם תו מיוחד (dark:, hover:, group/avatar, has-[:focus]) נכתבות כאן
// כ-[class~="..."] ולא כסלקטור-מחלקה עם escape. הסיבה אינה סגנון: DASHBOARD_SCRIPTS נכתב
// דרך מחרוזת Ruby שמקפלת backslash כפול לבודד, ולכן כל escape נשבר בכתיבה חוזרת
// והסלקטור מפסיק להתאים בשקט. הספציפיות זהה (0,1,0), אז אין שינוי בקסקייד. אותו פתרון
// כמו CARD_SEL ב-campaign-stats.js, ויש בדיקה שנופלת על כל escape כזה ב-artifact.
// ponytail: one style tag + one throttled observer; no settings UI, no per-user toggle.
(function () {
  if (window.__cwptWaTheme) return;
  window.__cwptWaTheme = true;
  try {
    if (localStorage.getItem('cwptWaTheme') === 'off') return;
  } catch (e) {
    /* storage blocked — theme stays on */
  }

  // Light doodle wallpaper tile (own drawing, not WhatsApp's asset), stroke colour injected per mode.
  function wallpaper(stroke, opacity) {
    return (
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140' viewBox='0 0 140 140' fill='none' stroke='" +
      stroke +
      "' stroke-opacity='" +
      opacity +
      "' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E" +
      "%3Ccircle cx='22' cy='22' r='7'/%3E%3Cpath d='M66 12l5 9-5 9-5-9z'/%3E%3Cpath d='M104 26h14M111 19v14'/%3E" +
      "%3Ccircle cx='118' cy='68' r='4'/%3E%3Cpath d='M28 74l9 9M37 74l-9 9'/%3E%3Cpath d='M70 62q8-10 16 0'/%3E" +
      "%3Ccircle cx='72' cy='104' r='9'/%3E%3Cpath d='M12 116h14'/%3E%3Cpath d='M112 108l6 10h-12z'/%3E%3Cpath d='M40 124q6 6 12 0'/%3E" +
      '%3C/svg%3E")'
    );
  }

  var CSS = [
    /* ---------- tokens ---------- */
    ':root{',
    '  --wa-app-bg:#f0f2f5;--wa-panel:#ffffff;--wa-chat-bg:#efeae2;--wa-incoming:#ffffff;--wa-outgoing:#d9fdd3;',
    '  --wa-note:#fff6c8;--wa-text:#111b21;--wa-text-2:#667781;--wa-icon:#54656f;--wa-primary:#00a884;',
    '  --wa-primary-strong:#008069;--wa-unread:#25d366;--wa-unread-text:#ffffff;--wa-tick-read:#53bdeb;',
    '  --wa-divider:#e9edef;--wa-hover:#f5f6f6;--wa-selected:#f0f2f5;--wa-system:#ffffff;--wa-input:#ffffff;',
    '  --wa-quote-bg:rgba(11,20,26,.05);--wa-quote-bar:#06cf9c;--wa-shadow:rgba(11,20,26,.13);--wa-link:#027eb5;',
    '  --wa-chip:#f0f2f5;--wa-chip-active:#e7fce3;--wa-meta-out:rgba(17,27,33,.6);',
    '  --wa-wallpaper:' + wallpaper('%23000', '.055') + ';',
    /* Chatwoot blue scale → WhatsApp green (every text-n-blue-N, bg-n-blue-N and solid-blue consumer follows) */
    '  --blue-1:251 254 253;--blue-2:243 252 249;--blue-3:229 250 241;--blue-4:213 246 232;--blue-5:190 240 219;',
    '  --blue-6:163 230 203;--blue-7:128 214 182;--blue-8:74 196 158;--blue-9:0 168 132;--blue-10:0 150 118;',
    '  --blue-11:0 128 105;--blue-12:8 66 55;--solid-blue:217 253 211;--solid-blue-2:243 252 249;',
    '  --border-blue:0,168,132,.5;--border-blue-strong:0 128 105;--text-blue:17 27 33;',
    '}',
    'body.dark{',
    '  --wa-app-bg:#202c33;--wa-panel:#111b21;--wa-chat-bg:#0b141a;--wa-incoming:#202c33;--wa-outgoing:#005c4b;',
    '  --wa-note:#3b3a24;--wa-text:#e9edef;--wa-text-2:#8696a0;--wa-icon:#aebac1;--wa-primary:#00a884;',
    '  --wa-primary-strong:#00a884;--wa-unread:#00a884;--wa-unread-text:#111b21;--wa-tick-read:#53bdeb;',
    '  --wa-divider:rgba(134,150,160,.15);--wa-hover:#202c33;--wa-selected:#2a3942;--wa-system:#182229;--wa-input:#2a3942;',
    '  --wa-quote-bg:rgba(0,0,0,.2);--wa-quote-bar:#06cf9c;--wa-shadow:rgba(0,0,0,.4);--wa-link:#53bdeb;',
    '  --wa-chip:#202c33;--wa-chip-active:#0a332c;--wa-meta-out:rgba(255,255,255,.6);',
    '  --wa-wallpaper:' + wallpaper('%23fff', '.04') + ';',
    '  --blue-1:10 24 21;--blue-2:13 31 27;--blue-3:12 43 37;--blue-4:8 56 48;--blue-5:5 69 58;',
    '  --blue-6:8 83 69;--blue-7:12 101 83;--blue-8:15 127 104;--blue-9:0 168 132;--blue-10:0 184 147;',
    '  --blue-11:6 207 156;--blue-12:173 240 221;--solid-blue:0 92 75;--solid-blue-2:13 31 27;',
    '  --border-blue:0,168,132,.5;--border-blue-strong:6 207 156;--text-blue:233 237 239;',
    '}',

    /* ---------- brand blue hardcodes (#2781f6) → WhatsApp green ---------- */
    'html body .bg-n-brand,html body [class~="checked:bg-n-brand"]:checked,html body [class~="after:bg-n-brand"]:after,html body [class~="before:bg-n-brand"]:before,html body .group:hover [class~="group-hover:bg-n-brand"],html body .bg-n-blue-9,html body [class~="indeterminate:bg-n-brand"]:indeterminate{background-color:var(--wa-primary)}',
    'html body [class~="bg-n-brand/10"],html body [class~="hover:bg-n-brand/10"]:hover,html body [class~="dark:bg-n-brand/10"]:is(.dark *){background-color:rgba(0,168,132,.1)}',
    'html body [class~="bg-n-brand/20"],html body [class~="hover:enabled:bg-n-brand/20"]:enabled:hover,html body [class~="focus-visible:bg-n-brand/20"]:focus-visible{background-color:rgba(0,168,132,.2)}',
    'html body [class~="bg-n-brand/5"]{background-color:rgba(0,168,132,.05)}',
    'html body [class~="hover:bg-n-brand/80"]:hover{background-color:rgba(0,168,132,.8)}',
    'html body .text-n-brand,html body [class~="hover:text-n-brand"]:hover,html body .text-n-blue-9,html body .group:focus-within [class~="group-focus-within:text-n-brand"],html body [class~="dark:hover:text-n-brand"]:hover:is(.dark *){color:var(--wa-primary-strong)}',
    'html body .border-n-brand,html body [class~="hover:border-n-brand"]:hover,html body [class~="focus:border-n-brand"]:focus,html body [class~="checked:border-n-brand"]:checked,html body [class~="dark:border-n-brand"]:is(.dark *),html body [class~="indeterminate:border-n-brand"]:indeterminate{border-color:var(--wa-primary)}',
    'html body .border-t-n-brand,html body [class~="before:!border-t-n-brand"]:before{border-top-color:var(--wa-primary)!important}',
    'html body .outline-n-brand,html body [class~="!outline-n-brand"],html body .outline-n-blue-9,html body [class~="focus:outline-n-brand"]:focus,html body [class~="focus:outline-n-blue-9"]:focus,html body [class~="focus-visible:outline-n-brand"]:focus-visible,html body [class~="focus-within:outline-n-brand"]:focus-within,html body [class~="has-[:focus]:outline-n-brand"]:has(:focus),html body [class~="dark:focus:outline-n-brand"]:focus:is(.dark *),html body [class~="dark:focus-within:outline-n-brand"]:focus-within:is(.dark *),html body [class~="dark:!outline-n-brand"]:is(.dark *),html body [class~="dark:has-[:focus]:outline-n-brand"]:has(:focus):is(.dark *),html body select:focus,html body textarea:focus{outline-color:var(--wa-primary)!important}',
    'html body .fill-n-blue-9{fill:var(--wa-primary)}',
    'html body p a,html body [class~="prose-a:text-n-brand"] :is(:where(a):not(:where([class~=not-prose],[class~=not-prose] *))){color:var(--wa-link)}',
    'html body .banner.primary{background-color:var(--wa-primary)}',
    'html body .ProseMirror-prompt .ProseMirror-prompt-buttons button[type=submit]{background-color:var(--wa-primary)}',
    'html body .search-input:focus{border-color:var(--wa-primary)}',

    /* ---------- type, selection, scrollbars ---------- */
    'html body,html body .text-body-main,html body .ProseMirror{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif!important}',
    '::selection{background:rgba(0,168,132,.28)}',
    '#app ::-webkit-scrollbar{width:6px;height:6px}',
    '#app ::-webkit-scrollbar-thumb{background:rgba(134,150,160,.35);border-radius:3px}',
    '#app ::-webkit-scrollbar-track{background:transparent}',

    /* ---------- app frame ---------- */
    '#app{background:var(--wa-panel)}',
    '#app aside{background:var(--wa-app-bg);border-color:var(--wa-divider)}',
    '#app aside .bg-n-alpha-2{background:var(--wa-selected)}',
    '#app aside [data-test-id="sidebar-unread-badge"]{background:var(--wa-unread);color:var(--wa-unread-text)}',
    '#app aside input{border-radius:8px;background:var(--wa-panel)}',

    /* ---------- chat list ---------- */
    '#app .conversations-list-wrap{background:var(--wa-panel);border-color:var(--wa-divider)}',
    '#app .conversations-list-wrap>div:first-child h1{font-size:20px;font-weight:700;color:var(--wa-text)}',
    /* assignee tabs → WhatsApp filter pills. ul.list-none matches the stock Tabs.vue list and the
       chip-enhanced list of the custom build alike (both keep list-none + a.text-button). */
    '#app .conversations-list-wrap ul.list-none{gap:6px;padding:6px 0 4px;align-items:center}',
    '#app .conversations-list-wrap ul.list-none>li{margin:0}',
    '#app .conversations-list-wrap ul.list-none>li>a.text-button{padding:3px 12px;border-radius:9999px;background:var(--wa-chip);color:var(--wa-text-2);font-size:13px;font-weight:500;line-height:20px}',
    '#app .conversations-list-wrap ul.list-none>li>a.text-button:after{display:none}',
    '#app .conversations-list-wrap ul.list-none>li>a.text-button[aria-pressed="true"],#app .conversations-list-wrap ul.list-none>li>a.text-button.text-n-blue-11{background:var(--wa-chip-active);color:var(--wa-primary-strong)}',
    '#app .conversations-list-wrap ul.list-none>li>a.text-button>div{background:transparent;color:inherit;padding:0;min-width:0;height:auto;margin-inline-start:4px;font-weight:500}',

    '#app .conversation{border-bottom:0;align-items:center;min-height:72px;background:var(--wa-panel)}',
    '#app .conversation:after{content:"";position:absolute;bottom:0;inset-inline-start:76px;inset-inline-end:0;height:1px;background:var(--wa-divider)}',
    '#app .conversation:before{display:none}',
    '#app .conversation:hover{background:var(--wa-hover)}',
    '#app .conversation.active,#app .conversation.selected{background:var(--wa-selected)}',
    '#app .conversation.active{animation:none}',
    '#app .conversation>.relative{margin-inline-end:4px}',
    '#app .conversation>.relative [class~="group/avatar"]{width:49px!important;height:49px!important;margin-top:0!important}',
    '#app .conversation>.relative [class~="group/avatar"] [role=img]{width:49px!important;height:49px!important;border-radius:50%!important}',
    '#app .conversation>.relative [class~="group/avatar"] [role=img]>span{font-size:18px!important}',
    '#app .conversation>.relative [class~="group/avatar"] label{border-radius:50%}',
    '#app .conversation>div.border-line{padding:10px 0;border:0}',
    '#app .conversation .text-label-small{font-size:11px;line-height:14px;color:var(--wa-text-2)}',
    '#app .conversation h4.conversation--user{font-size:16px;line-height:22px;color:var(--wa-text);text-transform:none;padding-top:0}',
    '#app .conversation h4.conversation--user.font-medium{font-weight:400}',
    '#app .conversation h4.conversation--user.font-semibold{font-weight:600}',
    '#app .conversation h4.conversation--user+div,#app .conversation h4.conversation--user+p{font-size:14px;color:var(--wa-text-2)}',
    '#app .conversation .text-xxs{font-size:12px;line-height:16px;color:var(--wa-text-2)}',
    '#app .conversation:has(h4.conversation--user.font-semibold) .text-xxs{color:var(--wa-primary-strong)}',
    '#app .conversation>div.border-line>div.absolute{top:14px;align-items:flex-end}',
    '#app .conversation .bg-n-teal-9.rounded-full{background:var(--wa-unread);color:var(--wa-unread-text);height:20px;min-width:20px;padding:0 6px;font-size:12px;font-weight:600;line-height:20px;margin-top:6px}',

    /* ---------- conversation header ---------- */
    '#app .conversation-details-wrap{background:var(--wa-chat-bg);border-color:var(--wa-divider)}',
    '#app .conversation-details-wrap>div:first-child{background:var(--wa-app-bg);border-color:var(--wa-divider)!important}',
    '#app .conversation-details-wrap>div:first-child [class~="group/avatar"]{width:40px!important;height:40px!important}',
    '#app .conversation-details-wrap>div:first-child [class~="group/avatar"] [role=img]{width:40px!important;height:40px!important;border-radius:50%!important}',
    '#app .conversation-details-wrap>div:first-child [class~="group/avatar"] [role=img]>span{font-size:15px!important}',
    '#app .conversation-details-wrap>div:first-child .text-sm.font-medium.truncate{font-size:16px;color:var(--wa-text)}',
    '#app .conversation-details-wrap>div:first-child .conversation--header--actions{color:var(--wa-text-2);font-size:13px}',
    '#app .conversation-details-wrap>div:first-child+.h-10{background:var(--wa-app-bg)}',
    '#app .conversation-details-wrap:not(:has(.conversation-panel)){background:var(--wa-app-bg);border-bottom:6px solid var(--wa-unread)}',
    '#app .conversation-details-wrap+div{background:var(--wa-panel);border-color:var(--wa-divider)}',

    /* ---------- messages ---------- */
    '#app .conversation-panel{background:var(--wa-chat-bg) var(--wa-wallpaper);padding-left:4%;padding-right:4%}',
    '#app .conversation-panel+div{background:var(--wa-app-bg)}',
    '#app .message-bubble-container{margin-bottom:12px}',
    '#app .message-bubble-container.group-with-next{margin-bottom:2px}',
    '#app .message-bubble-container .left-bubble,#app .message-bubble-container .right-bubble{max-width:min(65%,600px);border-radius:7.5px;box-shadow:0 1px .5px var(--wa-shadow);color:var(--wa-text);font-size:14.2px;line-height:19px}',
    '#app .message-bubble-container .left-bubble{background:var(--wa-incoming)}',
    '#app .message-bubble-container .right-bubble{background:var(--wa-outgoing)}',
    '#app .message-bubble-container .bg-n-solid-amber.left-bubble,#app .message-bubble-container .bg-n-solid-amber.right-bubble{background:var(--wa-note)}',
    '#app .message-bubble-container .bg-n-ruby-4.left-bubble,#app .message-bubble-container .bg-n-ruby-4.right-bubble{background:rgb(var(--ruby-4))}',
    '#app .message-bubble-container [data-bubble-name="text"]{padding:6px 9px 8px;position:relative;overflow:visible}',
    '#app .message-bubble-container [data-bubble-name="text"]>.gap-3{gap:6px}',
    '#app .message-bubble-container .prose-bubble{color:inherit}',
    '#app .message-bubble-container .prose-bubble a{color:var(--wa-link)}',
    '#app .message-bubble-container .prose-bubble p{margin:0}',
    '#app .message-bubble-container .left-bubble>.text-xs,#app .message-bubble-container .right-bubble>.text-xs{justify-content:flex-end;margin-top:2px;margin-bottom:-4px;font-size:11px;line-height:15px;color:var(--wa-text-2)}',
    '#app .message-bubble-container .right-bubble>.text-xs{color:var(--wa-meta-out)}',
    '#app .message-bubble-container .right-bubble [class~="text-[#7EB6FF]"]{color:var(--wa-tick-read)}',
    '#app .message-bubble-container .right-bubble .text-n-slate-10{color:var(--wa-meta-out)}',
    '#app .message-bubble-container [data-bubble-name="text"]:before{content:"";position:absolute;top:0;width:8px;height:13px}',
    '#app .message-bubble-container .left-bubble[data-bubble-name="text"]{border-start-start-radius:0}',
    '#app .message-bubble-container .left-bubble[data-bubble-name="text"]:before{inset-inline-start:-8px;background:var(--wa-incoming);clip-path:polygon(0 0,100% 0,100% 100%)}',
    '#app[dir=rtl] .message-bubble-container .left-bubble[data-bubble-name="text"]:before{clip-path:polygon(0 0,100% 0,0 100%)}',
    '#app .message-bubble-container .right-bubble[data-bubble-name="text"]{border-start-end-radius:0}',
    '#app .message-bubble-container .right-bubble[data-bubble-name="text"]:before{inset-inline-end:-8px;background:var(--wa-outgoing);clip-path:polygon(0 0,100% 0,0 100%)}',
    '#app[dir=rtl] .message-bubble-container .right-bubble[data-bubble-name="text"]:before{clip-path:polygon(0 0,100% 0,100% 100%)}',
    '#app .message-bubble-container .bg-n-solid-amber[data-bubble-name="text"]:before{background:var(--wa-note)}',
    '#app .group-with-next+.message-bubble-container [data-bubble-name="text"]{border-start-start-radius:7.5px;border-start-end-radius:7.5px}',
    '#app .group-with-next+.message-bubble-container [data-bubble-name="text"]:before{display:none}',
    '#app .message-bubble-container .left-bubble>.bg-n-alpha-black1,#app .message-bubble-container .right-bubble>.bg-n-alpha-black1{background:var(--wa-quote-bg);border-inline-start:4px solid var(--wa-quote-bar);border-radius:7.5px;padding:6px 10px;margin:0 0 6px}',
    '#app .message-bubble-container [data-bubble-name="image"],#app .message-bubble-container [data-bubble-name="video"]{padding:3px;border-radius:7.5px}',
    '#app .message-bubble-container [data-bubble-name="activity"]{background:var(--wa-system);color:var(--wa-text-2);font-size:12.5px;line-height:20px;padding:4px 12px;border-radius:7.5px!important;box-shadow:0 1px .5px var(--wa-shadow)}',
    '#app .message-bubble-container [role=img]{border-radius:50%!important}',
    '#app .conversation-panel>li>span.bg-n-brand.rounded-full{background:var(--wa-system);color:var(--wa-text-2);box-shadow:0 1px .5px var(--wa-shadow);border-radius:7.5px;padding:5px 16px;min-width:50%;text-align:center;font-weight:500}',
    '#app .cwpt-wa-day{display:flex;justify-content:center;margin:14px 0 10px;list-style:none}',
    '#app .cwpt-wa-day>span{background:var(--wa-system);color:var(--wa-text-2);font-size:12.5px;line-height:21px;padding:0 12px;border-radius:7.5px;box-shadow:0 1px .5px var(--wa-shadow)}',
    '#app .conversation-panel+div>.absolute>div{background:var(--wa-incoming);color:var(--wa-text-2);box-shadow:0 1px .5px var(--wa-shadow)}',

    /* ---------- composer: one WhatsApp-style row ---------- */
    '#app .reply-box{margin:0;border:0;border-radius:0;background:var(--wa-app-bg);display:flex;flex-wrap:wrap;align-items:flex-end;padding:6px 10px 8px}',
    '#app .reply-box.is-private{background:var(--wa-note)}',
    '#app .reply-box>div[class~="h-[3.25rem]"]{order:1;flex:0 0 100%;height:auto;min-height:36px;padding:0 0 4px}',
    '#app .reply-box>div[class~="h-[3.25rem]"]>button.rounded-full{background:var(--wa-chip);color:var(--wa-text-2);height:28px;font-size:13px}',
    '#app .reply-box>div[class~="h-[3.25rem]"]>button.rounded-full>div.bg-n-solid-1{background:var(--wa-input);height:22px}',
    '#app .reply-box>.reply-box__top{order:3;flex:1 1 0;min-width:0;background:var(--wa-input);border-radius:8px;padding:6px 12px;margin:0;box-shadow:0 1px .5px var(--wa-shadow)}',
    '#app .reply-box.is-private>.reply-box__top{background:rgba(255,255,255,.6)}',
    'body.dark #app .reply-box.is-private>.reply-box__top{background:rgba(0,0,0,.25)}',
    '#app .reply-box>div.p-3{display:contents}',
    '#app .reply-box .left-wrap{order:2;display:flex;align-items:center;gap:2px;margin-inline-end:6px;padding-bottom:2px}',
    '#app .reply-box .right-wrap{order:4;margin-inline-start:6px;padding-bottom:0}',
    '#app .reply-box .left-wrap>button,#app .reply-box .left-wrap>span>button{background:transparent!important;color:var(--wa-icon);width:32px;height:32px;font-size:1.25rem;outline:0}',
    '#app .reply-box .left-wrap>button:hover,#app .reply-box .left-wrap>span>button:hover{background:rgba(134,150,160,.15)!important}',
    '#app .reply-box .right-wrap>button{width:40px;height:40px;padding:0;border-radius:50%;font-size:0;color:transparent;background:var(--wa-primary);justify-content:center;box-shadow:0 1px 2px rgba(11,20,26,.2)}',
    '#app .reply-box .right-wrap>button:hover:enabled{filter:brightness(1.08)}',
    '#app .reply-box .right-wrap>button:disabled{background:#8696a0;opacity:.6}',
    '#app .reply-box .right-wrap>button:before{content:"";display:block;width:22px;height:22px;background:#fff;-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M1.1 21.8 23.5 12 1.1 2.2 1 9.8l16 2.2-16 2.2z\'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M1.1 21.8 23.5 12 1.1 2.2 1 9.8l16 2.2-16 2.2z\'/%3E%3C/svg%3E") center/contain no-repeat}',
    '#app[dir=rtl] .reply-box .right-wrap>button:before{transform:scaleX(-1)}',
    '#app .reply-box .ProseMirror{font-size:15px;line-height:20px;color:var(--wa-text)}',
    '#app .reply-box .ProseMirror.resizable-editor-body{height:auto!important;min-height:20px;max-height:35vh;overflow-y:auto;transition:none}',
    '#app .reply-box .ProseMirror-menubar-wrapper{position:static}',
    '#app .reply-box .ProseMirror-menubar{display:none;position:absolute;bottom:calc(100% + 6px);inset-inline-start:0;z-index:5;background:var(--wa-input);border-radius:8px;box-shadow:0 2px 8px rgba(11,20,26,.18);padding:2px 6px;margin:0}',
    '#app .reply-box .reply-box__top:focus-within .ProseMirror-menubar{display:flex}',
    '#app .reply-box .ProseMirror-menubar:not(:has(*)){display:none!important}',
  ].join('\n');

  function mount() {
    var st = document.getElementById('cwpt-wa-theme');
    if (!st) {
      st = document.createElement('style');
      st.id = 'cwpt-wa-theme';
      st.textContent = CSS;
    }
    // appended last so it wins the cascade against Chatwoot's compiled stylesheet
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- day separators + HH:mm stamps (Chatwoot renders "LLL d, h:mm a" in English) ---------- */
  var MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  var STAMP = /^([A-Z][a-z]{2}) (\d{1,2})(?: (\d{4}))?, (\d{1,2}):(\d{2}) (AM|PM)$/;
  var HE_DAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת'];
  var EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function parseStamp(text) {
    var m = STAMP.exec((text || '').trim());
    if (!m || !(m[1] in MONTHS)) return null;
    var now = new Date();
    var year = m[3] ? +m[3] : now.getFullYear();
    var hour = (+m[4] % 12) + (m[6] === 'PM' ? 12 : 0);
    var d = new Date(year, MONTHS[m[1]], +m[2], hour, +m[5]);
    // no year printed = current year; a stamp "in the future" right after New Year is last year's
    if (!m[3] && d.getTime() > now.getTime() + 864e5) d.setFullYear(year - 1);
    return d;
  }
  function dayKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function isHe() {
    return !!document.querySelector('#app[dir="rtl"]');
  }
  function dayLabel(key) {
    var p = key.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((today - d) / 864e5);
    var he = isHe();
    if (diff === 0) return he ? 'היום' : 'Today';
    if (diff === 1) return he ? 'אתמול' : 'Yesterday';
    if (diff > 1 && diff < 7) return (he ? HE_DAYS : EN_DAYS)[d.getDay()];
    return he
      ? d.getDate() + '.' + (d.getMonth() + 1) + '.' + d.getFullYear()
      : d.getMonth() + 1 + '/' + d.getDate() + '/' + d.getFullYear();
  }

  function stampTimes(panel) {
    var times = panel.querySelectorAll('.message-bubble-container time');
    for (var i = 0; i < times.length; i++) {
      var t = times[i];
      var raw = t.textContent;
      if (t.getAttribute('data-wa-out') === raw) continue; // already ours
      var d = parseStamp(raw);
      if (!d) continue;
      var out = pad(d.getHours()) + ':' + pad(d.getMinutes());
      t.setAttribute('title', raw.trim());
      t.setAttribute('datetime', d.toISOString());
      t.setAttribute('data-wa-out', out);
      t.textContent = out;
      var box = t.closest('.message-bubble-container');
      if (box) box.setAttribute('data-wa-day', dayKey(d));
    }
  }

  function separatorFor(el) {
    var sep = document.createElement('div');
    sep.className = 'cwpt-wa-day';
    sep.setAttribute('data-for', el.getAttribute('data-message-id') || '');
    var span = document.createElement('span');
    span.textContent = dayLabel(el.getAttribute('data-wa-day'));
    sep.appendChild(span);
    return sep;
  }

  function placeSeparators(panel) {
    var prevDay = null;
    var kids = Array.prototype.slice.call(panel.children);
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.classList.contains('cwpt-wa-day')) {
        var next = el.nextElementSibling;
        var owner = next && next.classList.contains('message-bubble-container') ? next : null;
        var ownerDay = owner && owner.getAttribute('data-wa-day');
        // orphaned (its message moved/unmounted) or no longer a day boundary → drop, re-created below if needed
        if (!owner || owner.getAttribute('data-message-id') !== el.getAttribute('data-for') || !ownerDay || ownerDay === prevDay) {
          el.parentNode.removeChild(el);
        }
        continue;
      }
      if (!el.classList.contains('message-bubble-container')) continue;
      var day = el.getAttribute('data-wa-day');
      if (!day) continue; // activity rows carry no stamp — they don't break a day run
      if (day !== prevDay) {
        var before = el.previousElementSibling;
        var ok = before && before.classList.contains('cwpt-wa-day') && before.getAttribute('data-for') === el.getAttribute('data-message-id');
        if (!ok) panel.insertBefore(separatorFor(el), el);
      }
      prevDay = day;
    }
  }

  var pending = false;
  var last = 0;
  function pass() {
    var panel = document.querySelector('.conversation-panel');
    if (!panel) return;
    stampTimes(panel);
    placeSeparators(panel);
  }
  function schedule() {
    if (pending) return;
    pending = true;
    var wait = Math.max(0, 150 - (Date.now() - last));
    setTimeout(function () {
      pending = false;
      last = Date.now();
      try {
        pass();
      } catch (e) {
        /* never break the dashboard over a cosmetic pass */
      }
    }, wait);
  }
  function watch() {
    var root = document.getElementById('app') || document.body;
    if (!root) return;
    new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
    schedule();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mount();
      watch();
    });
  } else {
    mount();
    watch();
  }
})();
