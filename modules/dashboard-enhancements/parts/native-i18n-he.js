// native-i18n-he — Hebrew overlay for Chatwoot 4.17's two new native WhatsApp screens
// (settings/templates + campaigns/whatsapp analytics), which shipped without he translations.
//
// Why an overlay at all: on the MAIN server we build the frontend ourselves, so proper he
// locale files are baked in (patch 06-hebrew-i18n-native-screens) and every replacement below
// simply never matches — this file is a no-op there. A server on the stock image (no custom
// build) has no such locale files, so until our translations land upstream (submitted via
// Crowdin) this overlay is the only way its Hebrew users see the new screens in Hebrew.
// ponytail: exact-string dictionary + 3 regexes, he-locale only, self-disabling when the
// baked/upstream translation exists. Delete this file once Chatwoot ships he for these screens.
(function () {
  if (window.__cwptNativeI18nHe) return;
  window.__cwptNativeI18nHe = true;

  function isHe() {
    return !!document.querySelector('#app[dir="rtl"], [dir="rtl"]');
  }
  function onTargetPage() {
    return /\/accounts\/\d+\/(settings\/templates|campaigns\/whatsapp)/.test(location.pathname);
  }

  // Chat-area keys the stock he locale of Chatwoot 4.17 still ships in English (composer
  // "24-hour window" placeholder, contact/voice-call cards, attachments panel, message report…).
  // Merged straight into vue-i18n once the app is up, so both servers read Hebrew without a
  // rebuild; a key that upstream translates later simply gets overwritten by the same Hebrew.
  var HE_MESSAGES = {
    "CONVERSATION": {
      "BOT_HANDOFF_MESSAGE": "השיחה הזו מטופלת כרגע על ידי {assigneeName}.",
      "BOT_HANDOFF_FALLBACK_ASSIGNEE": "בוט",
      "BOT_HANDOFF_ACTION": "לקחת שליטה",
      "UNSUPPORTED_MESSAGE_TIKTOK": "ההודעה הזו אינה נתמכת. אפשר לצפות בה באפליקציית TikTok.",
      "UNSUPPORTED_MESSAGE_WHATSAPP": "ההודעה הזו אינה נתמכת. אפשר לצפות בה באפליקציית וואטסאפ.",
      "WHATSAPP_FLOW_RESPONSE": "נשלחה תגובה לטופס",
      "NATIVE_APP": "אפליקציה",
      "NATIVE_APP_ADVISORY": "ההודעה הזו נשלחה מהאפליקציה. השיבו מכאן כדי לשמור על חלון ההודעות.",
      "FILE_TYPE_NOT_SUPPORTED": "סוג הקובץ {fileName} אינו נתמך בשיחה זו",
      "CAPTAIN_GENERATION": {
        "TITLE": "איך נוצרה התשובה הזו?",
        "GENERATED_BY": "נוצר על ידי קפטן",
        "LOADING": "טוען פרטים…",
        "EMPTY": "אין פרטי יצירה להודעה זו.",
        "TIMELINE": "שלבי היצירה",
        "STEP_TOOL": "הופעל {name}",
        "STEP_HANDOFF": "הועבר אל {name}",
        "REASONING": "נימוק",
        "SOURCES": "מאגר הידע",
        "SOURCES_SUMMARY": "תוצאה אחת | {count} תוצאות",
        "MODEL": "נוצר עם {model}",
        "CREDITS": "קרדיטים: {credits}"
      },
      "CARD": {
        "LABELS_COUNT": "{count} תוויות"
      },
      "VOICE_CALL": {
        "NO_ANSWER_OUTBOUND_SUBTEXT": "איש הקשר לא ענה",
        "MISSED_CALL_INBOUND_SUBTEXT": "אף נציג לא ענה",
        "MISSED_CALL_DECLINED_BY": "נדחתה על ידי {agentName}",
        "HANDLED_BY": "טופלה על ידי {agentName}",
        "CALLING": "מחייג…",
        "AGENT_ANSWERED": "{agentName} ענה/תה",
        "JOIN_CALL": "הצטרפות לשיחה",
        "CALL_BACK": "חיוג חוזר",
        "TRANSCRIPT_SHOW_MORE": "הצג עוד",
        "TRANSCRIPT_SHOW_LESS": "הצג פחות"
      },
      "HEADER": {
        "COPY_ID_SUCCESS": "מזהה השיחה הועתק",
        "WHATSAPP_CALL": "התחלת שיחת וואטסאפ",
        "WHATSAPP_CALL_FAILED": "לא ניתן להתחיל את שיחת הוואטסאפ.",
        "VOICE_CALL": "התחלת שיחה",
        "VOICE_CALL_FAILED": "לא ניתן להתחיל את השיחה.",
        "WHATSAPP_CALL_PERMISSION_REQUESTED": "נשלחה לאיש הקשר בקשת הרשאה לשיחה. נסו שוב אחרי שיאשר.",
        "WHATSAPP_CALL_PERMISSION_PENDING": "בקשת הרשאה לשיחה כבר נשלחה לאחרונה. נסו שוב אחרי שאיש הקשר יאשר."
      },
      "CARD_CONTEXT_MENU": {
        "API": {
          "LABEL_REMOVAL": {
            "SUCCESFUL": "התווית #{labelName} הוסרה משיחה {conversationId}",
            "FAILED": "לא ניתן להסיר את התווית. נסו שוב."
          }
        }
      },
      "FOOTER": {
        "MESSAGING_RESTRICTED": "אי אפשר להשיב לשיחה זו",
        "MESSAGING_RESTRICTED_WHATSAPP": "אפשר להשיב רק בהודעת תבנית בגלל הגבלת חלון 24 השעות",
        "MESSAGING_RESTRICTED_API": "אפשר להשיב רק בהודעת תבנית בגלל הגבלת חלון ההודעות"
      },
      "REPLYBOX": {
        "AUDIO_CONVERSION_FAILED": "המרת ההקלטה נכשלה. נסו שוב."
      },
      "CONTEXT_MENU": {
        "REPORT_MESSAGE": {
          "LABEL": "דיווח על הודעה",
          "TITLE": "דיווח על הודעת קפטן",
          "DESCRIPTION": "נתקלתם בבעיה בתשובת ה-AI? ספרו לנו מה השתבש והצוות שלנו יבדוק.",
          "PROBLEM_TYPE": "סוג הבעיה",
          "PROBLEM_TYPE_PLACEHOLDER": "בחרו סוג בעיה",
          "DESCRIPTION_PLACEHOLDER": "תארו את הבעיה בפירוט",
          "SUBMIT": "דיווח",
          "SUCCESS": "תודה על הדיווח. הצוות שלנו יבדוק.",
          "ERROR": "לא ניתן לדווח על ההודעה. נסו שוב.",
          "REASONS": {
            "incorrect_information": "מידע שגוי",
            "inappropriate_response": "תשובה לא הולמת",
            "incomplete_response": "תשובה חלקית",
            "outdated_information": "מידע לא מעודכן",
            "other": "אחר"
          }
        }
      },
      "VOICE_WIDGET": {
        "HANDLED_IN_ANOTHER_TAB": "מטופלת בלשונית אחרת",
        "REJECT_CALL": "דחייה",
        "JOIN_CALL": "הצטרפות לשיחה",
        "END_CALL": "סיום השיחה",
        "MUTE": "השתקת המיקרופון",
        "UNMUTE": "ביטול ההשתקה",
        "VIEW_CHAT_HISTORY": "היסטוריית הצ'אט",
        "GO_TO_CONVERSATION": "מעבר לשיחה"
      }
    },
    "ONBOARDING": {
      "GREETING_MORNING": "👋 בוקר טוב, {name}. ברוכים הבאים ל-{installationName}.",
      "GREETING_AFTERNOON": "👋 צהריים טובים, {name}. ברוכים הבאים ל-{installationName}.",
      "GREETING_EVENING": "👋 ערב טוב, {name}. ברוכים הבאים ל-{installationName}."
    },
    "CONVERSATION_SIDEBAR": {
      "ACCORDION": {
        "SHARED_FILES": "קבצים מצורפים"
      },
      "SHARED_FILES": {
        "EMPTY": "אין קבצים מצורפים עדיין",
        "DOWNLOAD": "הורדת הקובץ",
        "DOWNLOAD_ERROR": "לא ניתן להוריד את הקובץ. נסו שוב.",
        "FILES_HEADING": "קבצים",
        "SHOW_LESS": "הצג פחות",
        "UNTITLED_FILE": "קובץ ללא שם",
        "JUMP_TO_MESSAGE": "מעבר להודעה"
      }
    },
    // Chatwoot 4.20's Data screen (Settings → Data: imports from CSV/Intercom/Freshdesk, contact exports) shipped with
    // these keys missing from he or left in English (23.11.2026).
    "SIDEBAR": {
      "DATA": "נתונים"
    },
    "DATA_IMPORTS": {
      "HEADER": "נתונים",
      "DEFAULT_IMPORT_NAME": "ייבוא מ-Intercom",
      "DEFAULT_IMPORT_NAMES": {
        "CSV": "ייבוא אנשי קשר - {date}"
      },
      "DRAWER": {
        "TITLE": "ייבוא חדש",
        "SOURCE": "מקור",
        "NAME": "שם הייבוא",
        "NAME_PLACEHOLDER": "העברת התמיכה של יולי",
        "ACCESS_KEY": "מפתח גישה של Intercom",
        "ACCESS_KEY_PLACEHOLDER": "הדביקו את מפתח הגישה של Intercom",
        "INTERCOM_ACCESS_KEY": "מפתח גישה של Intercom",
        "INTERCOM_ACCESS_KEY_PLACEHOLDER": "הדביקו את מפתח הגישה של Intercom",
        "FRESHDESK_API_KEY": "מפתח API של Freshdesk",
        "FRESHDESK_API_KEY_PLACEHOLDER": "הדביקו את מפתח ה-API של Freshdesk",
        "FRESHDESK_DOMAIN": "הדומיין של Freshdesk",
        "DATA_TYPES": "מה לייבא",
        "VALIDATING": "בודקים את מפתח הגישה...",
        "VALID_KEY": "מפתח הגישה אומת.",
        "INVALID_KEY": "לא הצלחנו לאמת את מפתח הגישה."
      },
      "TABLE": {
        "TITLE": "ייבואים אחרונים",
        "EMPTY": "עדיין אין ייבואים",
        "COUNT": "{count} ייבואים",
        "UNNAMED": "ייבוא בלי שם",
        "IMPORTED_COUNT": "{count} יובאו",
        "VIEW": "צפייה בייבוא",
        "IMPORTED": "יובאו",
        "ABANDON": "ביטול",
        "RESUME": "המשך"
      },
      "DETAIL": {
        "ERRORS": "שגיאות",
        "SKIP_LOGS": "רשומות שדולגו",
        "SOURCE": "מקור",
        "IMPORT_TYPES": "סוגי ייבוא",
        "INITIATED_BY": "הופעל על ידי",
        "PROGRESS": "התקדמות הייבוא",
        "PROGRESS_WITH_TOTAL": "{imported} מתוך {total} יובאו",
        "PROGRESS_WITHOUT_TOTAL": "{imported} יובאו",
        "PROGRESS_OF_TOTAL": "מתוך {total} יובאו",
        "PROGRESS_IMPORTED": "יובאו",
        "LAST_UPDATED_TOOLTIP": "עודכן לאחרונה {time}",
        "NO_SKIP_LOGS": "לא נרשמו רשומות שדולגו או נכשלו.",
        "DOWNLOAD_SKIP_LOGS": "הורדת CSV",
        "DOWNLOAD_ERROR_LOGS": "הורדת CSV",
        "KIND": "סוג",
        "NO_ERRORS": "לא נרשמו שגיאות.",
        "ERROR_CODE": "קוד",
        "SOURCE_OBJECT": "הרשומה במקור"
      },
      "MONITOR": {
        "LIVE": "מתעדכן כל {seconds} שניות",
        "LAST_UPDATED": "עודכן לאחרונה {time}",
        "REFRESHING": "מרענן",
        "STAGES": {
          "unknown": "ממתין לעדכון",
          "queued": "בתור",
          "preparing": "בודקים ומכינים את קובץ ה-CSV",
          "contacts": "מייבאים אנשי קשר",
          "conversations": "מייבאים שיחות",
          "finalizing": "מסיימים את הייבוא",
          "completed_with_errors": "הושלם עם שגיאות",
          "abandoned": "בוטל"
        }
      },
      "ALERTS": {
        "IMPORT_STARTED": "הייבוא התחיל.",
        "IMPORT_RETRIED": "הייבוא נכנס לתור וימשיך.",
        "IMPORT_RETRY_FAILED": "לא הצלחנו לנסות שוב את הייבוא.",
        "IMPORT_ABANDONED": "הייבוא בוטל.",
        "IMPORT_FAILED": "לא הצלחנו להתחיל את הייבוא.",
        "LOAD_FAILED": "לא הצלחנו לרענן את הייבואים והייצואים. נסו שוב."
      },
      "STATUS": {
        "PENDING": "בתור",
        "PROCESSING": "בתהליך",
        "COMPLETED": "הושלם",
        "COMPLETED_WITH_ERRORS": "הושלם עם שגיאות",
        "FAILED": "נכשל",
        "ABANDONED": "בוטל"
      },
      "CSV": {
        "ROW_ERRORS": "שגיאות בשורות",
        "SOURCE": "קובץ CSV",
        "FILE": "קובץ CSV של אנשי קשר",
        "HELP": "השתמשו בשמות העמודות שבקובץ הדוגמה ובתוויות שכבר קיימות. עד 250,000 שורות ועד 1 MiB לשדה.",
        "SILENT_UPDATES": "אנשי קשר שכבר קיימים מתעדכנים. ייבוא לא מפעיל אוטומציות או webhooks של אנשי קשר.",
        "INVALID_FILE": "בחרו קובץ CSV שאינו ריק, עד 50 MiB.",
        "SAMPLE": "הורדת קובץ CSV לדוגמה",
        "UPLOADING": "מעלים {percent}%. העיבוד מתחיל כשההעלאה מסתיימת.",
        "OUTCOMES": "{created} נוצרו · {updated} עודכנו · {failed} נכשלו",
        "PROCESSED": "מתוך {total} עובדו",
        "REJECTED_HELP": "הורידו את השורות שנדחו, תקנו אותן והעלו אותן כייבוא חדש. הקבצים זמינים 30 יום.",
        "DOWNLOAD_REJECTED": "הורדת השורות שנדחו",
        "EXPIRED": "הקובץ המקורי וקובץ השורות שנדחו כבר לא זמינים. כדי לייבא שוב את אנשי הקשר האלה, העלו קובץ חדש.",
        "FILE_REMOVED": "הקובץ הוסר אחרי 30 יום.",
        "CHOOSE_FILE": "לחצו כדי להעלות, או גררו לכאן קובץ",
        "FILE_LIMIT": "רק CSV · עד 50 MiB",
        "REMOVE_FILE": "הסרת הקובץ",
        "PREVIEW_TITLE": "תצוגה מקדימה של הקובץ",
        "PREVIEW_DESCRIPTION": "מוצגות עד {count} שורות. הקובץ יועלה כשתתחילו את הייבוא.",
        "PREVIEW_LOADING": "קוראים את הקובץ...",
        "PREVIEW_ERROR": "לא הצלחנו להציג את הקובץ. אפשר בכל זאת להתחיל את הייבוא כדי לבדוק אותו.",
        "PREVIEW_EMPTY": "לא נמצאו שורות נתונים בקובץ.",
        "REJECTED_TITLE": "יש שורות שצריך לתקן",
        "CREATED": "נוצרו",
        "UPDATED": "עודכנו",
        "FAILED": "נכשלו"
      }
    },
    "DATA_EXPORTS": {
      "INITIATOR": "הופעל על ידי {name} ב-{date}",
      "TITLE": "ייצוא אנשי קשר",
      "NEW": "ייצוא אנשי קשר",
      "START": "התחלת הייצוא",
      "EMPTY": "עדיין אין ייצואים",
      "ALL_CONTACTS": "כל אנשי הקשר",
      "FILTERED_CONTACTS": "אנשי הקשר שמתאימים לסינון הנוכחי",
      "SCOPE": "אנשי קשר לייצוא: {scope}",
      "DESCRIPTION": "ייצוא אנשי הקשר שנבחרו לקובץ CSV. הנתונים נלקחים ברגע שהייצוא רץ.",
      "PROCESSED": "{count} אנשי קשר יוצאו",
      "ESTIMATE": "סך הכל משוער: {count}. המספר יכול להשתנות כשאנשי קשר מתעדכנים.",
      "DOWNLOAD": "הורדת CSV",
      "RERUN": "הרצה מחדש",
      "STALLED": "הייצוא הזה הפסיק לדווח על התקדמות. הריצו אותו שוב כדי ליצור ייצוא חדש.",
      "EXPIRED": "תוקף ההורדה פג. הריצו את הייצוא שוב כדי ליצור קובץ חדש.",
      "RETENTION": "קובצי הייצוא זמינים 30 יום אחרי שהם מוכנים.",
      "ERROR": "לא הצלחנו לטעון או להתחיל את הייצוא. נסו שוב.",
      "LOAD_ERROR": "לא הצלחנו לטעון את הייצוא. נסו שוב.",
      "RETRY": "ניסיון חוזר",
      "LOAD_OLDER": "טעינת ייצואים ישנים יותר",
      "LOAD_OLDER_ERROR": "לא הצלחנו לטעון ייצואים ישנים יותר. נסו שוב.",
      "DOWNLOAD_ERROR": "הקובץ כבר לא זמין. רעננו את הדף כדי לראות את המצב שלו עכשיו.",
      "DRAFT_UNAVAILABLE": "הבחירה לייצוא לא זמינה או שפג תוקפה. חזרו לאנשי הקשר ובחרו שוב ייצוא. שום ייצוא לא התחיל.",
      "EMPTY_DESCRIPTION": "ייצוא אנשי הקשר לקובץ CSV. היסטוריית הייצואים וההורדות תופיע כאן.",
      "NOTIFICATION": "נשלח לכם מייל כשקובץ ה-CSV יהיה מוכן. אפשר גם לעקוב כאן אחרי ההתקדמות ולהוריד אותו.",
      "FILE_FORMAT": "קובץ CSV",
      "SELECTION": "אנשי קשר",
      "PROGRESS": "התקדמות הייצוא",
      "FILE_READY": "הייצוא מוכן",
      "IN_PROGRESS": "מכינים את קובץ ה-CSV. אפשר לצאת מהדף בזמן שהייצוא רץ.",
      "TABLE": {
        "EXPORTED": "יוצאו",
        "COUNT": "מוצג ייצוא אחד | מוצגים {count} ייצואים"
      }
    }
  };
  function findI18n() {
    var apps = document.querySelectorAll('#app');
    for (var i = 0; i < apps.length; i++) {
      var app = apps[i].__vue_app__;
      var sym = app && app.__VUE_I18N_SYMBOL__;
      var inst = sym && app._context && app._context.provides && app._context.provides[sym];
      if (inst && inst.global && typeof inst.global.mergeLocaleMessage === 'function') return inst.global;
    }
    return null;
  }
  var mergeTries = 0;
  function mergeHe() {
    var g = findI18n();
    if (!g) {
      if (++mergeTries < 150) setTimeout(mergeHe, 200); // the app mounts a few seconds after our script
      return;
    }
    try {
      g.mergeLocaleMessage('he', HE_MESSAGES);
    } catch (e) {
      /* stock strings stay — never break the dashboard over a translation */
    }
  }
  mergeHe();

  // exact text-node replacements (trimmed match) — EN strings of the two screens only
  var DICT = {
    // settings/templates
    'Templates': 'תבניות',
    'View the message templates synced from your WhatsApp inboxes. To create or edit a template, manage it with your provider.':
      'צפייה בתבניות ההודעה שסונכרנו מתיבות הוואטסאפ שלכם. ליצירה או עריכה של תבנית — נהלו אותה אצל הספק.',
    'Know more': 'מידע נוסף',
    'Sync templates': 'סנכרון תבניות',
    'Search by content or name...': 'חיפוש לפי תוכן או שם...',
    'Manage in Meta': 'ניהול במטא',
    'Manage in Twilio': 'ניהול ב-Twilio',
    'Loading WhatsApp templates...': 'טוען תבניות וואטסאפ...',
    'No WhatsApp templates found.': 'לא נמצאו תבניות וואטסאפ.',
    'No templates match your filters.': 'אין תבניות שתואמות את הסינון.',
    'All inboxes': 'כל התיבות',
    'All languages': 'כל השפות',
    'All types': 'כל הסוגים',
    'Template preview': 'תצוגה מקדימה של התבנית',
    'Preview how this template appears in WhatsApp.': 'כך התבנית תיראה בוואטסאפ.',
    'Template details': 'פרטי התבנית',
    'Content type': 'סוג תוכן',
    'Category': 'קטגוריה',
    'Language': 'שפה',
    'Inboxes': 'תיבות דואר נכנס',
    'Status': 'מצב',
    'Text': 'טקסט', 'Image': 'תמונה', 'Video': 'וידאו', 'Document': 'מסמך', 'Media': 'מדיה',
    'Quick reply': 'תשובה מהירה', 'Call to action': 'הנעה לפעולה', 'Catalog': 'קטלוג', 'Copy code': 'העתקת קוד',
    'Not submitted for WhatsApp approval': 'טרם הוגשה לאישור וואטסאפ',
    // campaigns/whatsapp analytics
    'Campaigns': 'קמפיינים',
    'Loading analytics...': 'טוען נתוני ניתוח...',
    'Audience': 'נמענים',
    'Submitted to WhatsApp': 'נמסרו לוואטסאפ',
    'Delivered': 'נמסרו', 'Read': 'נקראו', 'Failed': 'נכשלו', 'Skipped': 'דולגו',
    'Delivery breakdown': 'פילוח מסירה',
    'Queued or awaiting update': 'בתור או ממתינות לעדכון',
    'Awaiting delivery update': 'ממתין לעדכון מסירה',
    'Queued': 'בתור',
    'Deliveries': 'מסירות',
    'Contact': 'איש קשר', 'Message': 'הודעה', 'Reason': 'סיבה',
    'Not generated': 'לא נוצרה',
    'All': 'הכל',
    'No delivery records found.': 'לא נמצאו רשומות מסירה.',
    'This campaign is still processing. Analytics will update automatically.': 'הקמפיין עדיין בעיבוד. הניתוח יתעדכן אוטומטית.',
    'This campaign is completing. Analytics will update automatically.': 'הקמפיין בשלבי סיום. הניתוח יתעדכן אוטומטית.',
  };
  var RES = [
    [/^(\d+(?:\.\d+)?)% of audience$/, '$1% מהנמענים'],
    [/^(\d+(?:\.\d+)?)% delivered$/, '$1% נמסרו'],
    [/^Sent on (.+)$/, 'נשלח ב-$1'],
    [/^Code (\S+)$/, 'קוד $1'],
    [/^Last sync attempt on (.+)$/, 'ניסיון סנכרון אחרון: $1'],
  ];

  function translate(txt) {
    var k = txt.trim();
    if (!k) return null;
    if (Object.prototype.hasOwnProperty.call(DICT, k)) return DICT[k];
    for (var i = 0; i < RES.length; i++) {
      if (RES[i][0].test(k)) return k.replace(RES[i][0], RES[i][1]);
    }
    return null;
  }

  function walk(root) {
    var it = document.createNodeIterator(root, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = it.nextNode())) {
      var t = translate(n.nodeValue);
      if (t !== null && t !== n.nodeValue.trim()) n.nodeValue = t;
    }
    // placeholder attribute (the search box)
    var inputs = root.querySelectorAll ? root.querySelectorAll('input[placeholder]') : [];
    for (var i = 0; i < inputs.length; i++) {
      var p = translate(inputs[i].getAttribute('placeholder'));
      if (p) inputs[i].setAttribute('placeholder', p);
    }
  }

  function tick() {
    if (!onTargetPage() || !isHe()) return;
    // body, not <main>: the settings sidebar carries the "Templates" menu label too.
    // Safe because the dictionary only runs on the two target routes.
    walk(document.body);
  }

  var timer = null;
  new MutationObserver(function () {
    if (timer) return;
    timer = setTimeout(function () { timer = null; tick(); }, 150);
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setTimeout(tick, 600);
})();
