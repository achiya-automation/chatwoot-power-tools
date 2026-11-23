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
    return /\/accounts\/\d+\/(settings\/templates|settings\/data|campaigns\/whatsapp)/.test(location.pathname);
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
      "DATA": "נתונים",
      "CALLS": "שיחות קוליות"
    },
    "DATA_IMPORTS": {
      "HEADER": "נתונים",
      "DESCRIPTION": "ייבוא נתוני לקוחות וניהול ייצוא של אנשי קשר.",
      "LOADING": "טוענים ייבואים וייצואים",
      "DEFAULT_IMPORT_NAME": "ייבוא מ-Intercom",
      "DEFAULT_IMPORT_NAMES": {
        "CSV": "ייבוא אנשי קשר - {date}",
        "INTERCOM": "ייבוא מ-Intercom - {date}",
        "FRESHDESK": "ייבוא מ-Freshdesk - {date}"
      },
      "DRAWER": {
        "TITLE": "ייבוא חדש",
        "ACTIVE_IMPORT": "כבר יש ייבוא פעיל בחשבון הזה. חכו שיסתיים לפני שמתחילים ייבוא נוסף.",
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
        "EMPTY_DESCRIPTION": "ייבאו אנשי קשר מקובץ CSV, או העבירו היסטוריית לקוחות מכלי תמיכה אחר.",
        "COUNT": "{count} ייבואים",
        "UNNAMED": "ייבוא בלי שם",
        "IMPORTED_COUNT": "{count} יובאו",
        "VIEW": "צפייה בייבוא",
        "IMPORTED": "יובאו",
        "ABANDON": "ביטול",
        "RESUME": "המשך"
      },
      "DETAIL": {
        "BACK": "חזרה לייבואים ולייצואים",
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
    },
    // Chatwoot 4.20's inbox screens shipped with these keys missing from he or left in English (23.11.2026): the new
    // WhatsApp screens (manual Cloud API setup, the per-inbox app secret, the move off embedded signup), widget
    // security, and the older ones (call settings, account and Twilio health, assignment, CSAT, channel setup).
    // CALLS_PAGE and SIDEBAR.CALLS are the calls page and its menu entry.
    "INBOX_MGMT": {
      "VIEW_CONVERSATIONS": "צפייה בשיחות",
      "CHANNEL_PREFERENCES": "העדפות הערוץ",
      "EDIT": {
        "LOCK_TO_SINGLE_CONVERSATION": {
          "ENABLED": "פתיחה מחדש של אותה שיחה",
          "DISABLED": "פתיחת שיחה חדשה",
          "ENABLED_DESCRIPTION": "כשאיש הקשר כותב שוב, השיחה הקודמת נפתחת מחדש.",
          "DISABLED_DESCRIPTION": "אחרי שהשיחה הקודמת נפתרה, כל פנייה חדשה פותחת שיחה חדשה."
        }
      },
      "ADD": {
        "WHATSAPP": {
          "PROVIDERS": {
            "WHATSAPP_CLOUD_MANUAL_SETUP_DESC": "חיבור ידני עם הפרטים של ה-Cloud API"
          },
          "APP_SECRET": {
            "LABEL": "סוד האפליקציה (App secret)",
            "PLACEHOLDER": "סוד האפליקציה שלכם במטא",
            "ERROR": "נא להזין ערך תקין."
          },
          "MANUAL_SETUP": {
            "HEADER": {
              "TITLE": "חיבור ידני של וואטסאפ",
              "DESCRIPTION": "בצעו את השלבים האלה כדי להכין את החשבון שלכם במטא ולחבר את המספר ל-Chatwoot."
            },
            "APP": {
              "TITLE": "יצירה או בחירה של אפליקציה במטא",
              "DESCRIPTION": "מספר הוואטסאפ צריך להיות שייך לאפליקציה במטא שהופעל בה WhatsApp.",
              "ITEM_1": "פתחו את {metaDevelopers} והתחברו עם חשבון של מנהל.",
              "ITEM_2": "צרו אפליקציה חדשה, או בחרו את האפליקציה שכבר משמשת את מספר הוואטסאפ הזה.",
              "ITEM_3": "בחרו באפשרות להתחבר ללקוחות דרך WhatsApp.",
              "ITEM_4": "בחרו את תיק העסק (Business portfolio) שמספר הוואטסאפ שייך לו, או יהיה שייך לו.",
              "VIDEO_TITLE": "סרטון: יצירת אפליקציה במטא",
              "VIDEO_DESCRIPTION": "הסרטון הקצר מראה איפה מתחילים אפליקציה חדשה ב-Meta Developers."
            },
            "NUMBER": {
              "TITLE": "הוספת מספר הטלפון וקבלת המזהים שלו",
              "DESCRIPTION": "הוסיפו ואמתו את המספר העסקי באפליקציה שלכם במטא, ואז העתיקו את שני המזהים שמופיעים ב-API Setup.",
              "ITEM_1": "פתחו את WhatsApp באפליקציה שלכם במטא ובחרו API Setup.",
              "ITEM_2": "באזור Send and receive messages, פתחו את הבחירה From.",
              "ITEM_3": "בחרו מספר עסקי קיים, או בחרו Add phone number.",
              "ITEM_4": "השלימו את הפרופיל העסקי בוואטסאפ שמטא מבקשת.",
              "ITEM_5": "אמתו את מספר הטלפון עם הקוד שנשלח ב-SMS או בשיחה קולית.",
              "ITEM_6": "העתיקו את Phone Number ID ואת WhatsApp Business Account ID שמופיעים ב-API Setup.",
              "VIDEO_TITLE": "סרטון: הוספת מספר טלפון ומציאת המזהים שלו",
              "VIDEO_DESCRIPTION": "הסרטון מראה איך מוסיפים או בוחרים מספר עסקי ומעתיקים את המזהים ממטא."
            },
            "TOKEN": {
              "TITLE": "יצירת טוקן גישה קבוע",
              "DESCRIPTION": "צרו במטא משתמש מערכת (System user) עם גישה לאפליקציה ולחשבון WhatsApp Business.",
              "ITEM_1": "פתחו את Meta Business Settings ועברו אל Users → System users.",
              "ITEM_2": "צרו משתמש מערכת עם הרשאת מנהל, או בחרו משתמש קיים.",
              "ITEM_3": "שייכו למשתמש המערכת את האפליקציה שלכם במטא ואת חשבון WhatsApp Business.",
              "ITEM_4": "תנו שליטה מלאה בנכסי הוואטסאפ ששויכו.",
              "ITEM_5": "צרו טוקן לאפליקציה שלכם במטא, וקבעו לו תוקף Never.",
              "ITEM_6": "בחרו whatsapp_business_management ו-whatsapp_business_messaging, ואז העתיקו את הטוקן.",
              "VIDEO_TITLE": "סרטון: יצירת טוקן גישה קבוע",
              "VIDEO_DESCRIPTION": "הסרטון מראה איך בוחרים את האפליקציה שלכם במטא, טוקן בלי תאריך תפוגה ואת הרשאות הוואטסאפ הנדרשות.",
              "WARNING": "מטא מציגה את הטוקן רק פעם אחת. העתיקו אותו לפני שסוגרים את החלון."
            },
            "DETAILS": {
              "WABA_LABEL": "מזהה חשבון WhatsApp Business (WABA ID)",
              "WABA_PLACEHOLDER": "הזינו את ה-WABA ID",
              "PHONE_ID_LABEL": "מזהה מספר הטלפון (Phone Number ID)",
              "PHONE_ID_PLACEHOLDER": "הזינו את ה-Phone Number ID",
              "TOKEN_LABEL": "טוקן גישה קבוע",
              "TOKEN_PLACEHOLDER": "הדביקו את טוקן הגישה",
              "APP_SECRET_LABEL": "סוד האפליקציה (App secret)",
              "APP_SECRET_PLACEHOLDER": "הדביקו את סוד האפליקציה",
              "APP_SECRET_HELP": "נמצא באפליקציה שלכם במטא, תחת App settings > Basic. בעזרתו בודקים שההודעות הנכנסות באמת מגיעות ממטא."
            },
            "REVIEW": {
              "TITLE": "יצירת תיבת הוואטסאפ",
              "DESCRIPTION": "בדקו את פרטי המספר ובחרו שם לתיבה.",
              "VERIFIED": "המספר במטא וטוקן הגישה תקינים.",
              "PHONE_ID": "מזהה מספר הטלפון (Phone Number ID)",
              "WABA_ID": "מזהה חשבון WhatsApp Business (WABA ID)",
              "INBOX_NAME_HELP": "יצרנו את השם הזה מהשם העסקי המאומת שלכם במטא. אפשר לשנות אותו."
            },
            "VERIFY": {
              "TITLE": "בדיקת החיבור",
              "DESCRIPTION": "Chatwoot בודק את הגישה למספר ומגדיר את ה-webhook שלכם במטא.",
              "NUMBER_ACCESS": "גישה למספר",
              "TEMPLATE_ACCESS": "גישה לתבניות",
              "CALLBACK": "כתובת ה-webhook",
              "SUBSCRIPTION": "הרשמה ל-webhook",
              "COPY_SUCCESS": "כתובת ה-webhook הועתקה",
              "SUCCESS": "מספר הוואטסאפ שלכם מחובר ומוכן לשיוך נציגים.",
              "RETRY_SUCCESS": "הגדרת ה-webhook נוסתה שוב בהצלחה.",
              "RETRY_ERROR": "לא הצלחנו לנסות שוב את הגדרת ה-webhook. נסו שוב."
            },
            "ACTIONS": {
              "OPEN_META_APPS": "פתיחת האפליקציות במטא",
              "APP_READY": "האפליקציה שלי במטא מוכנה",
              "NEXT": "הבא",
              "OPEN_BUSINESS_SETTINGS": "פתיחת Meta Business Settings",
              "SHOW_TOKEN": "הצגת הטוקן",
              "HIDE_TOKEN": "הסתרת הטוקן",
              "VERIFY_DETAILS": "בדיקת הפרטים",
              "RETRY_WEBHOOK": "ניסיון חוזר להגדרת ה-webhook",
              "CONTINUE": "המשך להוספת נציגים"
            },
            "ERRORS": {
              "IDS_REQUIRED": "הזינו את Phone Number ID ואת WhatsApp Business Account ID.",
              "INVALID_TOKEN": "טוקן הגישה לא תקין או שפג תוקפו. צרו טוקן קבוע חדש ונסו שוב.",
              "GENERIC": "לא הצלחנו להשלים את חיבור הוואטסאפ. בדקו את הפרטים ונסו שוב."
            }
          },
          "SELECT_PROVIDER": {
            "RESTRICTION_DESCRIPTION": "בחרו את ספק הוואטסאפ שלכם. אפשר לחבר את WhatsApp Cloud ידנית עם פרטי ה-Cloud API שלכם, או להתחבר דרך Twilio עם פרטי החשבון שלכם שם."
          },
          "EMBEDDED_SIGNUP": {
            "DESC": "השתמשו בחיבור המהיר עם מטא כדי לחבר מספר חדש, או מספר קיים מאפליקציית WhatsApp Business. תועברו למטא כדי להתחבר לחשבון ה-WhatsApp Business שלכם. גישת מנהל תעזור שההגדרה תעבור בקלות.",
            "LEARN_MORE": {
              "TEXT": "למידע נוסף על החיבור המהיר, על התמחור ועל המגבלות, היכנסו ל-{link}."
            },
            "ENABLING_CALLING": "מפעילים שיחות קוליות בוואטסאפ במספר שלכם…",
            "UNSUPPORTED_COMPLETION": "ההגדרה במטא הסתיימה בלי מספר וואטסאפ שאפשר לחבר. הריצו את ההגדרה שוב והוסיפו מספר טלפון.",
            "MANUAL_FALLBACK": "אם המספר שלכם כבר מחובר ל-WhatsApp Business Platform ‏(API), או שאתם ספק טכנולוגי שמחבר את המספר של עצמו, השתמשו בתהליך {link}",
            "ACCESS_REQUEST": {
              "DESCRIPTION": "חברו מספר חדש, או מספר קיים מאפליקציית WhatsApp Business, בלי הגדרה ידנית. כדי להפעיל את האפשרות הזו, ספרו לנו מה העסק שלכם עושה ואיך תשתמשו בוואטסאפ.",
              "BUTTON": "בקשת גישה",
              "FORM_DESCRIPTION": "ספרו לנו על העסק שלכם ואיך אתם מתכננים להשתמש בוואטסאפ. שלחו את תיאור השימוש כדי להפעיל את החיבור המהיר בחשבון שלכם.",
              "USE_CASE_LABEL": "איך העסק משתמש בוואטסאפ",
              "USE_CASE_PLACEHOLDER": "לדוגמה: אנחנו מוכרים ריהוט לבית, ומשתמשים בוואטסאפ כדי לענות על שאלות על המוצרים ולעזור ללקוחות בהזמנות שלהם.",
              "ERROR": "לא הצלחנו להפעיל את הגישה. נסו שוב."
            },
            "RESTRICTED_WARNING": "ההרשמה המוטמעת של וואטסאפ לא זמינה כרגע, בגלל תקלה ב-API בצד של מטא ולא בעיה ב-Chatwoot. אפשר להשתמש בחיבור ידני למספרים מתאימים ב-Cloud API. אנחנו עובדים עם מטא כדי לפתור אותה כמה שיותר מהר.",
            "STATUS_LINK": "לעדכוני הסטטוס",
            "CALLING_ENABLE_FAILED": "תיבת הוואטסאפ שלכם מוכנה, אבל לא הצלחנו להפעיל שיחות קוליות: המספר הזה עוד לא רשום ל-WhatsApp Business Calling API. פנו למטא או לספק הפתרונות העסקיים של וואטסאפ כדי לרשום אותו, ואז הפעילו שיחות בהגדרות השיחות הקוליות של התיבה."
          },
          "API": {
            "MANUAL_RESTRICTION_WARNING": "ההרשמה המוטמעת של וואטסאפ לא זמינה כרגע, בגלל תקלה ב-API בצד של מטא ולא בעיה ב-Chatwoot. החיבור הידני עובד רק עם מספרים שכבר מחוברים ל-WhatsApp Cloud API. מספרים שעובדים במקביל גם באפליקציית WhatsApp Business עוד לא נתמכים בתהליך הזה. אנחנו עובדים עם מטא כדי לפתור את התקלה כמה שיותר מהר. תודה על הסבלנות.",
            "STATUS_LINK": "לעדכוני הסטטוס"
          }
        },
        "FB": {
          "RESTRICTED_WARNING": "אי אפשר ליצור כרגע תיבת פייסבוק, בגלל תקלה ב-API בצד של מטא ולא בעיה ב-Chatwoot. אנחנו עובדים עם מטא כדי לפתור אותה כמה שיותר מהר.",
          "STATUS_LINK": "לעדכוני הסטטוס"
        },
        "INSTAGRAM": {
          "SELECT_ACCOUNT": "בחירת חשבון אינסטגרם",
          "CONNECT_ACCOUNT": "חיבור החשבון",
          "START_AGAIN": "להתחיל מחדש",
          "DUPLICATE_INBOX_BANNER": "חשבון האינסטגרם הזה הועבר לתיבה של ערוץ האינסטגרם החדש. מהתיבה הזו כבר אי אפשר לשלוח ולקבל הודעות אינסטגרם.",
          "RESTRICTED_WARNING": "אי אפשר ליצור כרגע תיבת אינסטגרם, בגלל תקלה ב-API בצד של מטא ולא בעיה ב-Chatwoot. אנחנו עובדים עם מטא כדי לפתור אותה כמה שיותר מהר.",
          "SETTINGS_RESTRICTED_WARNING": "ההודעות באינסטגרם מושפעות כרגע מתקלה ב-API בצד של מטא, ולא מבעיה ב-Chatwoot. חלק מההודעות או מהפעולות עלולות להתעכב או לא לעבוד. אנחנו עובדים עם מטא כדי לפתור אותה כמה שיותר מהר.",
          "STATUS_LINK": "לעדכוני הסטטוס"
        },
        "TIKTOK": {
          "CONTINUE_WITH_TIKTOK": "המשך עם TikTok",
          "CONNECT_YOUR_TIKTOK_PROFILE": "חיבור פרופיל ה-TikTok שלכם",
          "HELP": "כדי להוסיף את פרופיל ה-TikTok שלכם כערוץ, צריך לאמת אותו בלחיצה על 'המשך עם TikTok'",
          "ERROR_MESSAGE": "אירעה שגיאה בחיבור ל-TikTok. נסו שוב.",
          "ERROR_AUTH": "אירעה שגיאה בחיבור ל-TikTok. נסו שוב.",
          "NORTH_AMERICA_WARNING": "אי אפשר לחבר כרגע חשבונות TikTok מצפון אמריקה, עד שיגיע עדכון מצוות TikTok."
        },
        "WEBSITE_CHANNEL": {
          "CHANNEL_WEBHOOK_SECRET": {
            "LABEL": "סוד ה-webhook",
            "COPY": "העתקת הסוד",
            "COPY_SUCCESS": "הסוד הועתק",
            "TOGGLE": "הצגה או הסתרה של הסוד",
            "RESET_SUCCESS": "נוצר סוד webhook חדש",
            "RESET_ERROR": "לא הצלחנו ליצור סוד webhook חדש. נסו שוב"
          }
        },
        "SMS": {
          "BANDWIDTH": {
            "CALLBACK_AUTH": {
              "TITLE": "פרטי הגישה ל-callback",
              "DESCRIPTION": "הוסיפו אותם כפרטי הגישה ל-callback הנכנס והיוצא באפליקציית Bandwidth שלכם. אם כמה תיבות משתמשות באותה אפליקציית Bandwidth, השתמשו בכתובת ה-callback ובפרטי הגישה של אחת מהן.",
              "RESET_SUCCESS": "הסיסמה ל-callback אופסה. עדכנו אותה באפליקציית Bandwidth שלכם.",
              "RESET_ERROR": "לא הצלחנו לאפס את הסיסמה ל-callback. נסו שוב.",
              "USERNAME": "שם משתמש",
              "PASSWORD": "סיסמה",
              "ENFORCE": "לדרוש פרטי גישה ל-callback",
              "ENFORCE_DESCRIPTION": "קריאות callback שלא משתמשות בפרטי הגישה האלה יידחו. הפעילו את זה אחרי שהוספתם את פרטי הגישה לאפליקציית Bandwidth שלכם."
            },
            "CLIENT_ID": {
              "LABEL": "מזהה לקוח (Client ID)",
              "PLACEHOLDER": "הזינו את ה-Client ID של Bandwidth",
              "ERROR": "זהו שדה חובה"
            },
            "CLIENT_SECRET": {
              "LABEL": "סוד לקוח (Client Secret)",
              "PLACEHOLDER": "הזינו את ה-Client Secret של Bandwidth",
              "ERROR": "זהו שדה חובה"
            },
            "OAUTH": {
              "TITLE": "פרטי הגישה ל-API",
              "MIGRATE": "עדכון פרטי הגישה",
              "READ_ONLY": "לקריאה בלבד",
              "SHOW_SECRET": "הצגת סוד הלקוח",
              "HIDE_SECRET": "הסתרת סוד הלקוח",
              "LEGACY_DESCRIPTION": "עדכנו את פרטי הגישה של Bandwidth לפני 2 בדצמבר 2026, כדי שהתיבה הזו תישאר מחוברת.",
              "DESCRIPTION": "התיבה הזו משתמשת ב-OAuth. הזינו Client ID ו-Client Secret חדשים כדי להחליף את פרטי הגישה שלה.",
              "SAVE": "אימות ושמירה של פרטי הגישה",
              "SUCCESS": "פרטי הגישה ל-OAuth של Bandwidth נשמרו.",
              "LOAD_ERROR": "לא הצלחנו לטעון את פרטי הגישה של Bandwidth. טענו את העמוד מחדש כדי לנסות שוב.",
              "ERROR": "לא הצלחנו לשמור את פרטי הגישה של Bandwidth. נסו שוב.",
              "CALLBACK_DESCRIPTION": "באפליקציית Bandwidth שלכם, השתמשו בכתובת הזו ב-callback של הודעות נכנסות ושל עדכוני סטטוס המסירה."
            }
          }
        },
        "VOICE": {
          "CONFIGURATION": {
            "TWILIO_VOICE_URL_TITLE": "כתובת השיחות ב-Twilio ‏(Voice URL)",
            "TWILIO_STATUS_URL_TITLE": "כתובת עדכוני הסטטוס ב-Twilio ‏(Status Callback URL)"
          }
        },
        "EMAIL_CHANNEL": {
          "FINISH_MESSAGE_NO_FORWARDING": "תיבת האימייל נוצרה! כדי לשלוח ולקבל מיילים צריך להגדיר את פרטי הגישה ל-SMTP ול-IMAP. בלי ההגדרות האלה אף מייל לא יעובד.",
          "FORWARDING_ADDRESS_LABEL": "העבירו מיילים לכתובת הזו:",
          "CONFIGURE_SMTP_IMAP_TEXT": " כדי להגדיר את IMAP ו-SMTP"
        },
        "AUTH": {
          "TITLE_FINISH": "מוכן!",
          "CHANNEL": {
            "WEBSITE": {
              "DESCRIPTION": "יצירת וידג׳ט צ׳אט לאתר"
            },
            "WHATSAPP": {
              "TITLE": "וואטסאפ"
            },
            "WHATSAPP_CALL": {
              "TITLE": "שיחות וואטסאפ",
              "DESCRIPTION": "קבלת שיחות קוליות במספר הוואטסאפ שלכם"
            },
            "TIKTOK": {
              "DESCRIPTION": "חיבור חשבון ה-TikTok שלכם",
              "ACCESS_REQUEST_DESCRIPTION": "כדי לבקש גישה ל-TikTok, פנו לצוות התמיכה שלנו"
            }
          }
        }
      },
      "SETTINGS_POPUP": {
        "ALLOWED_DOMAINS": {
          "DESCRIPTION": "הגבילו את האתרים שיכולים להטמיע את חלון הצ'אט שלכם. כדי לשמור על אבטחה, הוסיפו רק דומיינים שבבעלותכם ושאתם סומכים עליהם. אפשר להוסיף כמה דומיינים, מופרדים בפסיקים. שדה ריק מתיר כל דומיין (לא מומלץ באתר חי)."
        },
        "ALLOW_MOBILE_WEBVIEW": {
          "LABEL": "הפעלת חלון הצ'אט באפליקציות לנייד",
          "SUBTITLE": "סמנו את זה אם חלון הצ'אט מוטמע באפליקציות iOS או Android. אפליקציות לנייד לא שולחות את הדומיין, ולכן הגבלת הדומיינים תחסום אותן כשהאפשרות הזו כבויה."
        },
        "IDENTITY_VALIDATION": {
          "TITLE": "אימות זהות",
          "DESCRIPTION": "בודקים בעזרת טוקנים מאובטחים שהמשתמש הוא באמת מי שהוא אומר. כך אף אחד לא יכול להתחזות למישהו אחר בצ'אט.",
          "VIEW_DOCS": "לתיעוד",
          "REQUIRE_LABEL": "חובת אימות זהות בכל השיחות",
          "REQUIRE_DESCRIPTION": "כשזה מופעל, משתמשים צריכים טוקן זהות תקין כדי לפתוח שיחה. בקשות בלי טוקן תקין נדחות.",
          "ROTATE": {
            "BUTTON": "החלפת מפתח",
            "TITLE": "להחליף את המפתח הסודי?",
            "WARNING": "המפתח הנוכחי מבוטל ברגע שמחליפים אותו.",
            "WARNING_DETAIL": "אין תקופת מעבר, ואי אפשר להחזיר אותו.",
            "IMPACT": "השרתים שלכם צריכים לחתום על המשתמשים במפתח החדש. מי שעדיין חתום במפתח הישן נכשל באימות, ואם אימות הזהות הוא חובה, הוא לא יוכל לפתוח שיחה.",
            "CONFIRM": "החלפת מפתח",
            "SUCCESS": "המפתח הסודי הוחלף",
            "ERROR": "לא הצלחנו להחליף את המפתח הסודי. נסו שוב"
          }
        },
        "SENDER_NAME_SECTION_TEXT": "הצגה או הסתרה של שם הנציג במייל. כשזה כבוי, מוצג שם העסק",
        "ENABLE_CONTINUITY_VIA_EMAIL_DISABLED_TEXT": "האפשרות הזו זמינה במסלול בתשלום. שדרגו כדי להמשיך שיחות גם במייל.",
        "LOCK_TO_SINGLE_CONVERSATION": "ניתוב שיחות",
        "LOCK_TO_SINGLE_CONVERSATION_SUB_TEXT": "איך נפתחות שיחות לאנשי קשר קיימים",
        "FORWARD_EMAIL_NOT_CONFIGURED": "העברת מיילים לתיבה כבויה כרגע בהתקנה הזו. כדי להשתמש באפשרות, מנהל המערכת צריך להפעיל אותה. פנו אליו כדי להמשיך.",
        "WHATSAPP_APP_SECRET_TITLE": "סוד האפליקציה (App Secret)",
        "WHATSAPP_APP_SECRET_SUBHEADER": "הזינו את סוד האפליקציה שלכם במטא (App settings > Basic). בעזרתו בודקים שההודעות הנכנסות באמת מגיעות ממטא.",
        "WHATSAPP_APP_SECRET_MISSING": "ההודעות הנכנסות לתיבה הזו עוד לא מאומתות. הוסיפו את סוד האפליקציה ממטא כדי להשלים את ההגדרה.",
        "WHATSAPP_APP_SECRET_PLACEHOLDER": "הזינו כאן את סוד האפליקציה",
        "WHATSAPP_BUSINESS_MANAGEMENT_TOKEN_ADD_TITLE": "הוספת טוקן לניהול העסק (Business Management)",
        "WHATSAPP_BUSINESS_MANAGEMENT_TOKEN_REPLACE_TITLE": "החלפת הטוקן לניהול העסק (Business Management)",
        "WHATSAPP_BUSINESS_MANAGEMENT_TOKEN_CONFIGURED": "הטוקן לניהול העסק מוגדר",
        "WHATSAPP_BUSINESS_MANAGEMENT_TOKEN_UPDATE_SUBHEADER": "כש-Chatwoot לא מצליח למשוך את תבניות ההודעות של חשבון WhatsApp Business הזה, תנו לו טוקן עם גישה לחשבון. Chatwoot משתמש בטוקן הזה רק לסנכרון התבניות.",
        "WHATSAPP_BUSINESS_MANAGEMENT_TOKEN_UPDATE_PLACEHOLDER": "הזינו את הטוקן לניהול העסק",
        "WHATSAPP_BUSINESS_MANAGEMENT_TOKEN_REPLACE_BUTTON": "החלפה",
        "WHATSAPP_BUSINESS_MANAGEMENT_TOKEN_UPDATE_SUCCESS": "הטוקן לניהול העסק בוואטסאפ עודכן.",
        "WHATSAPP_BUSINESS_MANAGEMENT_TOKEN_UPDATE_ERROR": "לא הצלחנו לעדכן את הטוקן לניהול העסק. בדקו שיש לו הרשאת WhatsApp Business Management וגישה לחשבון, ונסו שוב.",
        "WHATSAPP_BUSINESS_MANAGEMENT_TOKEN_GUIDE_LINK": "איך יוצרים טוקן WhatsApp Business Management",
        "WHATSAPP_MANUAL_TRANSFER_TITLE": "מעבר לחיבור ידני",
        "WHATSAPP_MANUAL_TRANSFER_SUBHEADER": "התיבה הזו חוברה דרך ההרשמה המוטמעת של וואטסאפ (embedded signup), שכבר לא נתמכת. הזינו את הפרטים של WhatsApp Cloud API מהאפליקציה שלכם במטא כדי להעביר את התיבה לחיבור ידני. לפני המעבר, הגדירו את ה-webhook באפליקציה שלכם במטא עם טוקן האימות שלמעלה.",
        "WHATSAPP_MANUAL_TRANSFER_PHONE_NUMBER_ID_LABEL": "מזהה מספר הטלפון (Phone Number ID)",
        "WHATSAPP_MANUAL_TRANSFER_API_KEY_PLACEHOLDER": "הזינו טוקן גישה קבוע מהאפליקציה שלכם במטא",
        "WHATSAPP_MANUAL_TRANSFER_BUTTON": "מעבר לחיבור ידני",
        "WHATSAPP_MANUAL_TRANSFER_SUCCESS": "התיבה עברה לחיבור ידני.",
        "WHATSAPP_MANUAL_TRANSFER_ERROR": "לא הצלחנו לעבור לחיבור ידני. בדקו את הפרטים ונסו שוב.",
        "WHATSAPP_MANUAL_MIGRATION": {
          "BANNER": {
            "TITLE": "מומלץ לעבור לחיבור ידני",
            "DESCRIPTION": "התיבה הזו מחוברת דרך האפליקציה המשותפת של מטא להרשמה המוטמעת, ומגבלות שמטא הטילה לאחרונה פגעו בה. כדי להימנע מתקלות כאלה בעתיד, מומלץ לחבר אותה מחדש עם אפליקציה משלכם במטא.",
            "START": "התחלת המעבר לחיבור ידני",
            "GUIDE": "למדריך"
          },
          "DIALOG": {
            "EYEBROW": "מעבר לחיבור ידני של וואטסאפ",
            "TITLE": "חיבור מחדש של תיבת הוואטסאפ",
            "ACTION_REQUIRED_TITLE": "חיבור מחדש עם אפליקציה משלכם במטא",
            "ACTION_REQUIRED_DESCRIPTION": "מגבלות על האפליקציה המשותפת של ההרשמה המוטמעת לא חלות על תיבות שמחוברות דרך אפליקציה משלכם במטא. התהליך המודרך הזה מעדכן את חיבור ה-WhatsApp API בלי ליצור תיבה חדשה.",
            "GUIDE_LINK": "פתיחת המדריך לחיבור ידני",
            "PRESERVED_TITLE": "נשמר",
            "PRESERVED_DESCRIPTION": "שיחות, אנשי קשר, משתתפים, ניתוב, שעות פעילות והגדרות התיבה.",
            "UPDATED_TITLE": "מתעדכן",
            "UPDATED_DESCRIPTION": "מזהה ה-WABA, מזהה מספר הטלפון, טוקן הגישה והגדרות ה-webhook.",
            "WABA_ID": "מזהה WABA",
            "WABA_PLACEHOLDER": "הזינו את ה-WABA ID",
            "WABA_HELP": "חשבון WhatsApp Business שמספר הטלפון הזה שייך לו.",
            "PHONE_NUMBER_ID": "מזהה מספר הטלפון (Phone Number ID)",
            "PHONE_NUMBER_PLACEHOLDER": "הזינו את ה-Phone Number ID",
            "PHONE_NUMBER_HELP": "המזהה הייחודי שמטא נותנת למספר הוואטסאפ שמחובר לתיבה הזו.",
            "DISPLAY_PHONE_NUMBER_PLACEHOLDER": "הזינו את המספר שמוצג ללקוחות",
            "DISPLAY_PHONE_NUMBER_HELP": "מספר הוואטסאפ שהלקוחות רואים. אי אפשר לשנות אותו במעבר.",
            "ACCESS_TOKEN": "טוקן גישה קבוע או טוקן של משתמש מערכת",
            "ACCESS_TOKEN_PLACEHOLDER": "הדביקו את טוקן הגישה",
            "APP_SECRET": "סוד האפליקציה (App secret)",
            "APP_SECRET_PLACEHOLDER": "סוד האפליקציה מ-App settings > Basic באפליקציה שלכם במטא",
            "TOKEN_HELP_PREFIX": "הטוקן חייב לכלול את",
            "TOKEN_HELP_SUFFIX": "לסנכרון התבניות ולניהול שלהן.",
            "REVIEW_TITLE": "בדיקה לפני החיבור מחדש",
            "NOT_ENTERED": "לא הוזן",
            "VERIFY_NOTICE": "Chatwoot יבדוק את הפרטים האלה מול מטא לפני שהוא משנה משהו. אם הבדיקה נכשלת, ההגדרות הנוכחיות נשארות כמו שהן.",
            "REVIEW_MIGRATION": "בדיקת המעבר",
            "RECONNECT": "חיבור מחדש של תיבת הוואטסאפ"
          },
          "STEPS": {
            "BEFORE_YOU_START": {
              "TITLE": "לפני שמתחילים",
              "DESCRIPTION": "התהליך מחבר מחדש את הפרטים של WhatsApp API בתיבה הזו. השיחות, המשתתפים, הניתוב, שעות הפעילות, סקר שביעות הרצון (CSAT) והגדרות הבוט נשמרים."
            },
            "BUSINESS_DETAILS": {
              "TITLE": "פרטי העסק",
              "DESCRIPTION": "הזינו את נכסי הוואטסאפ מחשבון Meta Business של הלקוח."
            },
            "ACCESS_TOKEN": {
              "TITLE": "טוקן גישה"
            },
            "REVIEW_MIGRATION": {
              "TITLE": "בדיקת המעבר",
              "DESCRIPTION": "אשרו את פרטי החיבור לפני שמחברים מחדש את התיבה. Chatwoot יבדוק מול מטא את הטוקן, ה-WABA ומספר הטלפון לפני שהוא משנה משהו."
            }
          }
        },
        "WHATSAPP_CALLING_ENABLED": {
          "LABEL": "הפעלת שיחות קוליות",
          "DESCRIPTION": "נציגים יוכלו להתחיל ולקבל שיחות קוליות בוואטסאפ בתיבה הזו. זמין רק בערוצי WhatsApp Cloud שחוברו בהרשמה המוטמעת, עם הרשאת שיחות ממטא."
        }
      },
      "COUNT": "תיבה אחת | {n} תיבות",
      "SEARCH_PLACEHOLDER": "חיפוש לפי שם התיבה, הערוץ או המזהה...",
      "NO_RESULTS": "לא נמצאו תיבות שמתאימות לחיפוש",
      "WHATSAPP_REGISTRATION_INCOMPLETE": "ההרשמה ל-WhatsApp Business עדיין לא הושלמה. לפני החיבור מחדש, בדקו את מצב שם התצוגה ב-Meta Business Manager.",
      "CREATE_FLOW": {
        "FINISH": {
          "TITLE": "מוכן!"
        }
      },
      "DETAILS": {
        "ERROR_FB_LOADING": "שגיאה בטעינת ה-SDK של פייסבוק. כבו חוסמי פרסומות ונסו שוב מדפדפן אחר.",
        "ERROR_FB_UNAUTHORIZED_HELP": "ודאו שיש לכם גישה מלאה לעמוד הפייסבוק. אפשר לקרוא עוד על התפקידים בפייסבוק <a href=\" https://www.facebook.com/help/187316341316631\">כאן</a>.",
        "ERROR_CHANNEL_CREATION": "לא הצלחנו ליצור את התיבה. נסו שוב."
      },
      "FINISH": {
        "SMS_QR_INSTRUCTION": "סרקו את קוד ה-QR שלמעלה כדי לבדוק מהר את תיבת ה-SMS",
        "SMS_QR_ALT": "קוד QR לבדיקת תיבת ה-SMS",
        "TWILIO_CALLBACK_FALLBACK": "ה-webhooks מוגדרים אוטומטית. אם הודעות נכנסות לא מגיעות, הגדירו ב-Twilio את כתובת ה-callback הזו."
      },
      "TABS": {
        "CALLS": "שיחות קוליות"
      },
      "CALL_SETTINGS": {
        "SAVE": "שמירת השינויים",
        "OPTIONAL": "(לא חובה)",
        "OFF": "כבוי",
        "SECONDS": "{seconds} שניות",
        "MINUTES": "דקה אחת | {n} דקות",
        "CALLING": {
          "TITLE": "שיחות קוליות",
          "DESCRIPTION": "האם שיחות קוליות פעילות בתיבה הזו",
          "TAKE_INCOMING": "קבלת שיחות נכנסות",
          "TAKE_INCOMING_HELP": "כבו כדי להפסיק את הצלצולים בלי לנתק את המספר. שיחות יוצאות ימשיכו לעבוד.",
          "CREDENTIALS_HELP": "שיחות קוליות צריכות מפתח API מחשבון ה-Twilio שלכם, ואת טוקן האימות של החשבון (Auth Token) כדי לבדוק את הבקשות של Twilio.",
          "REPLACE_HELP": "הזינו מפתח API חדש כדי להחליף את המפתח שהתיבה משתמשת בו.",
          "CONNECT": "הפעלת שיחות קוליות",
          "CONNECTED": "מחובר",
          "TWILIO_ACCOUNT": "חשבון Twilio ‏{sid}",
          "MANAGE_CONNECTION": "ניהול החיבור",
          "HIDE_CONNECTION": "הסתרת החיבור",
          "UPDATE_CONNECTION": "עדכון החיבור",
          "WHATSAPP_ENABLE": "הפעלת שיחות בוואטסאפ",
          "WHATSAPP_ENABLE_HELP": "לקוחות יוכלו להתקשר למספר הזה מוואטסאפ. הנציגים עונים בדפדפן, ולכן צריך לאשר לו גישה למיקרופון.",
          "META_ON": "שיחות פעילות במטא",
          "META_HELP": "שיחות מצלצלות במספר הוואטסאפ הזה",
          "TURN_OFF": "כיבוי שיחות קוליות"
        },
        "INCOMING": {
          "TITLE": "כשנכנסת שיחה",
          "DESCRIPTION": "מה המתקשר שומע, ולמי מצלצל.",
          "GREETING": "ברכת פתיחה",
          "GREETING_PLACEHOLDER": "תודה שהתקשרתם. אנחנו מעבירים אתכם לצוות.",
          "GREETING_HELP": "מושמעת פעם אחת למתקשר בזמן שמצלצל לנציגים, ואחריה מוזיקת המתנה. השאירו ריק אם לא צריך ברכה.",
          "SIMULTANEOUS": "צלצול לכולם בבת אחת",
          "SIMULTANEOUS_HELP": "מצלצל לכל הנציגים הזמינים יחד. מי שעונה ראשון מקבל את השיחה.",
          "SEQUENTIAL": "צלצול לנציג אחד בכל פעם",
          "SEQUENTIAL_HELP": "מתחיל בנציג שפנוי הכי הרבה זמן, ומוסיף את הבא אם אף אחד לא עונה.",
          "STEP": "הוספת נציג נוסף אחרי",
          "ASSIGNEE_FIRST": "למתקשרים חוזרים, לצלצל קודם לנציג שמשויך לשיחה",
          "ASSIGNEE_FIRST_HELP": "כבו את זה בצוותים שמאיישים את הקו בתורנות.",
          "ALWAYS": "תמיד:",
          "ALWAYS_NOTE": "לנציגים שנמצאים בשיחה, בזמן סיכום אחרי שיחה, או שלא מקבלים שיחות, לא מצלצל. המתקשר ממתין, ומצלצל לנציג הראשון שמתפנה.",
          "ROUTING": "איך השיחות מנותבות",
          "WHATSAPP_DESCRIPTION": "למי מצלצל, ובאיזה סדר."
        },
        "UNANSWERED": {
          "TITLE": "אם אף אחד לא עונה",
          "DESCRIPTION": "חל גם מיד, כשאין אף נציג זמין.",
          "WAIT": "להמתין",
          "THEN": "ואז להשמיע את ההודעה ולנתק",
          "MESSAGE": "הודעה על שיחה שלא נענתה",
          "MESSAGE_HELP": "מוקראת למתקשר."
        },
        "OUT_OF_HOURS": {
          "TITLE": "מחוץ לשעות הפעילות",
          "DESCRIPTION": "לפי שעות הפעילות של התיבה, מהלשונית «שעות פעילות».",
          "APPLY": "החלת שעות הפעילות על שיחות",
          "APPLY_HELP": "כשזה פעיל, שיחות מחוץ לשעות הפעילות מתנהלות לפי הכלל שלמטה.",
          "HOURS_OFF": "שעות הפעילות כבויות בתיבה הזו. הפעילו אותן קודם בתיבה, ואז השיחות יוכלו לפעול לפיהן.",
          "HOURS_OFF_APPLIED": "שעות הפעילות כבויות בתיבה הזו, ולכן שיחות ימשיכו לצלצל כרגיל בכל שעה. כדי שזה יחול, הפעילו את שעות הפעילות בתיבה.",
          "GO_TO_HOURS": "לשעות הפעילות",
          "INBOX_HOURS": "שעות התיבה:",
          "ALL_DAY": "כל היום",
          "ALWAYS_CLOSED": "סגור בכל יום",
          "EDIT_HOURS": "עריכת השעות",
          "MESSAGE": "הודעה מחוץ לשעות הפעילות",
          "SAME": "כמו ההודעה על שיחה שלא נענתה",
          "MESSAGE_HELP": "מה המתקשרים שומעים מחוץ לשעות הפעילות, ואחרי זה השיחה מסתיימת.",
          "WHATSAPP_APPLY_HELP": "וואטסאפ לא יעביר שיחות מחוץ לשעות האלה. המתקשרים יראו מתי אפשר להתקשר שוב, ויוכלו לשלוח לכם הודעה במקום.",
          "WHATSAPP_HOURS_CHECKING": "בודקים בוואטסאפ…",
          "WHATSAPP_HOURS_APPLYING": "מחילים בוואטסאפ…",
          "WHATSAPP_HOURS_APPLIED": "הוחל בוואטסאפ",
          "WHATSAPP_HOURS_DIFFER": "בוואטסאפ מוגדרות שעות שיחה שונות מאלה של התיבה. השיחות יפעלו לפי השעות של וואטסאפ עד שתחילו את שעות התיבה.",
          "WHATSAPP_APPLY_INBOX_HOURS": "החלת שעות התיבה",
          "WHATSAPP_HOURS_STILL_ON": "וואטסאפ עדיין מחיל שעות שיחה, אבל התיבה הזו לא. שיחות מחוץ לשעות האלה לא יעברו עד שתכבו אותן.",
          "WHATSAPP_TURN_OFF_HOURS": "כיבוי בוואטסאפ"
        },
        "AFTER_CALL": {
          "TITLE": "אחרי שיחה",
          "DESCRIPTION": "סיכום ותיעוד.",
          "WRAP_UP": "זמן סיכום",
          "WRAP_UP_HELP": "לנציגים בזמן סיכום לא מצלצל. סימון השיחה כפתורה מסיים גם את זמן הסיכום.",
          "RECORD": "הקלטת שיחות",
          "TRANSCRIBE": "תמלול ההקלטות",
          "TRANSCRIBE_HELP": "Captain הופך את ההקלטה לטקסט, והוא מוצג ליד השיחה. צריך שהקלטה תהיה פעילה.",
          "RECORD_HELP": "ההקלטה מצורפת לשיחה."
        },
        "PLAY": "השמעה",
        "PLAY_AFTER_SAVE": "שמרו את השינויים כדי להקליט ולהשמיע את ההודעה החדשה",
        "STOP": "עצירה",
        "CALLING_CUSTOMERS": {
          "TITLE": "התקשרות ללקוחות",
          "DESCRIPTION": "וואטסאפ דורש אישור מהלקוח לפני שמתקשרים אליו.",
          "PERMISSION_MESSAGE": "הודעת בקשת האישור",
          "PERMISSION_PLACEHOLDER": "אפשר להתקשר אליכם בוואטסאפ בקשר לפנייה שלכם?",
          "PERMISSION_HELP": "נשלחת כשנציג מתקשר ללקוח שעוד לא אישר שיחות. השאירו ריק כדי להשתמש בנוסח ברירת המחדל."
        }
      },
      "WHATSAPP_CALLING": {
        "ENABLE_FAILED": "לא הצלחנו להפעיל שיחות קוליות במספר הזה: הוא עוד לא רשום ל-WhatsApp Business Calling API. פנו למטא או לספק הפתרונות העסקיים של וואטסאפ כדי לרשום אותו, ואז נסו שוב."
      },
      "WIDGET_FEATURES": "יכולות הווידג׳ט",
      "TWILIO_HEALTH": {
        "TITLE": "ניהול מספר ה-Twilio שלכם",
        "DESCRIPTION": "בדקו את חשבון ה-Twilio, את השולח ואת ה-webhooks שהתיבה הזו נשענת עליהם. כל מה ש-Chatwoot לא יכול לקבל מסומן כאן",
        "GO_TO_SETTINGS": "ל-Twilio Console",
        "LOADING": "מביאים נתוני תקינות מ-Twilio…",
        "ERROR_TITLE": "לא הצלחנו להתחבר ל-Twilio",
        "STATUS": {
          "HEALTHY": "כל הבדיקות עברו",
          "MISCONFIGURED": "צריך לטפל"
        },
        "FIELDS": {
          "ACCOUNT_NAME": {
            "LABEL": "חשבון Twilio",
            "TOOLTIP": "חשבון ה-Twilio שפרטי הגישה האלה שייכים לו"
          },
          "ACCOUNT_STATUS": {
            "LABEL": "מצב החשבון",
            "TOOLTIP": "חשבון Twilio מושעה או סגור לא יכול לשלוח או לקבל כלום"
          },
          "ACCOUNT_TYPE": {
            "LABEL": "סוג החשבון",
            "TOOLTIP": "חשבון ניסיון יכול לשלוח הודעות או להתקשר רק למספרים שאימתתם ב-Twilio"
          },
          "SENDER": {
            "TOOLTIP": "מספר הטלפון או שירות ההודעות שמפעילים את התיבה הזו"
          },
          "CAPABILITIES": {
            "LABEL": "יכולות המספר",
            "TOOLTIP": "היכולות ש-Twilio הפעיל במספר הזה. יכולת שהתיבה צריכה ואין במספר לא תעבוד אף פעם"
          },
          "VOICE_CALLING": {
            "LABEL": "שיחות קוליות",
            "TOOLTIP": "האם שיחות קוליות פעילות בתיבה הזו"
          },
          "SENDER_STATUS": {
            "LABEL": "מצב השולח בוואטסאפ",
            "TOOLTIP": "השולח צריך להיות מחובר כדי לשלוח ולקבל הודעות וואטסאפ"
          },
          "DISPLAY_NAME": {
            "LABEL": "שם התצוגה בוואטסאפ",
            "TOOLTIP": "שם העסק שהלקוחות רואים בוואטסאפ"
          },
          "QUALITY_RATING": {
            "LABEL": "דירוג איכות",
            "TOOLTIP": "דירוג האיכות של השולח בוואטסאפ, כפי ש-Twilio מדווח"
          },
          "MESSAGING_LIMIT": {
            "LABEL": "מגבלת הודעות",
            "TOOLTIP": "מגבלת ההודעות בוואטסאפ, כפי ש-Twilio מדווח"
          }
        },
        "VALUES": {
          "ACCOUNT_STATUSES": {
            "SUSPENDED": "מושעה",
            "CLOSED": "סגור"
          },
          "ACCOUNT_TYPES": {
            "TRIAL": "ניסיון",
            "FULL": "מלא"
          },
          "SENDER_TYPES": {
            "MESSAGING_SERVICE": "שירות הודעות",
            "WHATSAPP_SENDER": "שולח וואטסאפ"
          },
          "SENDER_STATUSES": {
            "ONLINE": "מחובר",
            "OFFLINE": "מנותק",
            "CREATING": "בהקמה",
            "VERIFYING": "באימות",
            "UPDATING": "בעדכון",
            "DELETING": "במחיקה",
            "UNKNOWN": "לא ידוע"
          },
          "QUALITY_RATINGS": {
            "HIGH": "גבוה",
            "MEDIUM": "בינוני",
            "LOW": "נמוך"
          }
        },
        "WEBHOOKS": {
          "TITLE": "כתובות webhook",
          "DESCRIPTION": "Twilio פונה לכתובות האלה כשמגיעה הודעה או שיחה. אחרי שינוי כתובת ההתקנה, רשמו אותן מחדש",
          "REGISTER_ALL": "רישום ה-webhooks",
          "MESSAGING": "webhook להודעות",
          "VOICE": "webhook לשיחות קוליות",
          "VOICE_STATUS": "callback לסטטוס של שיחות קוליות",
          "VOICE_APP": "שיחות יוצאות (אפליקציית TwiML)"
        },
        "WEBHOOK": {
          "CONFIGURED_SUCCESS": "ה-webhook הוגדר",
          "NOT_SET": "לא הוגדר",
          "EXPECTED": "הכתובת הצפויה",
          "CURRENT": "מוגדר כרגע לכתובת",
          "REASONS": {
            "NOT_SET": "ה-webhook לא הוגדר",
            "URL_MISMATCH": "כתובת ה-webhook לא תואמת",
            "WRONG_HTTP_METHOD": "ה-webhook משתמש בשיטת HTTP שגויה",
            "OVERRIDDEN_BY_NUMBER": "שירות ההודעות מפנה להגדרה של המספר",
            "OVERRIDDEN_BY_APPLICATION": "נדרס על ידי אפליקציית TwiML",
            "OVERRIDDEN_BY_TRUNK": "נדרס על ידי SIP trunk",
            "MISSING_TWIML_APP": "לא נוצרה אפליקציית TwiML"
          },
          "HINTS": {
            "NOT_SET": "ל-Twilio אין webhook בשולח הזה, ולכן שום דבר לא מגיע ל-Chatwoot.",
            "URL_MISMATCH": "Twilio פונה לכתובת אחרת, ולכן התעבורה הולכת למקום אחר.",
            "WRONG_HTTP_METHOD": "הכתובת נכונה, אבל Twilio פונה אליה ב-{method} במקום ב-POST, ו-Chatwoot עונה רק ל-POST.",
            "OVERRIDDEN_BY_NUMBER": "בשירות ההודעות הזה מופעלת האפשרות \"Use webhook on number\", ולכן Twilio מתעלם מה-webhook של השירות.",
            "OVERRIDDEN_BY_APPLICATION": "למספר הזה מחוברת אפליקציית TwiML, ו-Twilio משתמש בכתובות של האפליקציה במקום בכתובות של המספר. נתקו אותה ב-Twilio Console.",
            "OVERRIDDEN_BY_TRUNK": "המספר הזה מחובר ל-SIP trunk, ולכן Twilio מנתב את השיחות ל-trunk ומתעלם לגמרי מה-webhooks של השיחות הקוליות. נתקו את ה-trunk ב-Twilio Console.",
            "MISSING_TWIML_APP": "ל-Chatwoot אין אפליקציית TwiML למספר הזה, ולכן אי אפשר להוציא שיחות."
          }
        }
      },
      "ACCOUNT_HEALTH": {
        "DESCRIPTION": "בדקו את תקינות מספר הוואטסאפ, את קיבולת ההודעות ואת פרטי העסק המקושרים במטא.",
        "ERRORS": {
          "AUTHORIZATION": {
            "EMBEDDED_TITLE": "צריך לרענן את החיבור לוואטסאפ",
            "EMBEDDED_DESCRIPTION": "מטא לא הצליחה לאמת את החיבור של התיבה הזו. עברו ל«תצורה» כדי להגדיר אותה מחדש בהרשמה המוטמעת.",
            "MANUAL_TITLE": "צריך לטפל בטוקן הגישה של וואטסאפ",
            "MANUAL_DESCRIPTION": "מטא לא הצליחה לאמת את טוקן הגישה של התיבה הזו. עברו ל«תצורה» כדי לבדוק או להחליף אותו."
          },
          "GENERIC_TITLE": "נתוני התקינות של וואטסאפ לא זמינים",
          "GENERIC_DESCRIPTION": "מטא לא החזירה את פרטי התקינות הנוכחיים. בדקו את השגיאה שלמטה ונסו שוב מאוחר יותר.",
          "GO_TO_CONFIGURATION": "לתצורה"
        },
        "SECTIONS": {
          "BUSINESS_PROFILE": "פרופיל העסק",
          "HEALTH_AND_CAPACITY": "תקינות וקיבולת",
          "BUSINESS_ACCOUNT": "החשבון העסקי"
        },
        "FIELDS": {
          "PROFILE_DESCRIPTION": {
            "TOOLTIP": "התיאור שהלקוחות רואים בפרופיל העסקי בוואטסאפ"
          },
          "PROFILE_ADDRESS": {
            "TOOLTIP": "כתובת העסק שמוצגת בפרופיל העסקי בוואטסאפ"
          },
          "PROFILE_EMAIL": {
            "TOOLTIP": "המייל ליצירת קשר שמוצג בפרופיל העסקי בוואטסאפ"
          },
          "PROFILE_WEBSITES": {
            "LABEL": "אתרים",
            "TOOLTIP": "הקישורים לאתרים שמוצגים בפרופיל העסקי בוואטסאפ"
          },
          "VERIFIED_NAME": {
            "LABEL": "שם התצוגה בוואטסאפ",
            "TOOLTIP": "שם התצוגה שמקושר למספר הטלפון הזה בוואטסאפ"
          },
          "PHONE_NUMBER_ID": {
            "TOOLTIP": "המזהה שמטא נותנת למספר הוואטסאפ הזה"
          },
          "COEXISTENCE": {
            "LABEL": "שימוש משולב",
            "TOOLTIP": "המספר הזה מחובר גם לאפליקציית WhatsApp Business וגם ל-Cloud API"
          },
          "DISPLAY_NAME_STATUS": {
            "TOOLTIP": "האם מטא בדקה ואישרה את שם התצוגה בוואטסאפ",
            "DESCRIPTIONS": {
              "APPROVED": "שם התצוגה אושר, והוא יכול להופיע בראש הצ׳אטים בוואטסאפ. שם שהנמען שמר אצלו יכול להופיע במקומו.",
              "AVAILABLE_WITHOUT_REVIEW": "שם התצוגה נשמר בפרופיל הוואטסאפ שלכם, אבל עד שמטא תבדוק ותאשר אותו, הנמענים עשויים לראות את מספר הטלפון. מטא מתחילה את הבדיקה אחרי שהעסק מגיע למגבלת הודעות גבוהה יותר.",
              "PENDING_REVIEW": "מטא בודקת את שם התצוגה. לא צריך לעשות כלום, אלא אם מטא תבקש מידע נוסף.",
              "REJECTED": "מטא לא אישרה את שם התצוגה. עברו על ההנחיות לשמות תצוגה, ואז עדכנו את השם או הגישו ערעור במטא.",
              "DECLINED": "מטא לא אישרה את שם התצוגה. עברו על ההנחיות לשמות תצוגה, ואז עדכנו את השם או הגישו ערעור במטא.",
              "EXPIRED": "תוקף האישור של מספר הטלפון פג, ולכן אי אפשר לרשום את המספר לשימוש ב-API.",
              "UNKNOWN": "מטא לא החזירה את מצב הבדיקה של שם התצוגה."
            }
          },
          "LAST_ONBOARDED_TIME": {
            "LABEL": "חובר לאחרונה",
            "TOOLTIP": "הפעם האחרונה שמטא חיברה את מספר הטלפון הזה"
          },
          "PHONE_NUMBER_STATUS": {
            "LABEL": "מצב מספר הטלפון",
            "TOOLTIP": "מצב החיבור הנוכחי של מספר הטלפון הזה בוואטסאפ"
          },
          "QUALITY_RATING": {
            "TOOLTIP": "דירוג האיכות שמטא נותנת למספר הטלפון הזה, לפי הסימנים מההודעות האחרונות"
          },
          "MESSAGING_LIMIT_TIER": {
            "LABEL": "מגבלת ההודעות של העסק",
            "TOOLTIP": "לכמה לקוחות שונים העסק יכול לשלוח הודעה מחוץ לחלון שירות הלקוחות, בכל 24 שעות רצופות",
            "DESCRIPTION": "המגבלה הזו משותפת לכל מספרי הוואטסאפ בתיק העסקי."
          },
          "ACCOUNT_MODE": {
            "TOOLTIP": "מצב הפעולה הנוכחי של מספר הוואטסאפ הזה"
          },
          "CODE_VERIFICATION_STATUS": {
            "LABEL": "אימות בקוד",
            "TOOLTIP": "מצב האימות בקוד שמטא מדווחת על מספר הטלפון הזה"
          },
          "THROUGHPUT_LEVEL": {
            "LABEL": "קצב שליחה",
            "TOOLTIP": "רמת קצב שליחת ההודעות שנקבעה למספר הטלפון הזה"
          },
          "BUSINESS_ACCOUNT_NAME": {
            "LABEL": "שם חשבון ה-WhatsApp Business",
            "TOOLTIP": "שם חשבון ה-WhatsApp Business שמקושר למספר הטלפון הזה"
          },
          "BUSINESS_ACCOUNT_ID": {
            "LABEL": "מזהה חשבון ה-WhatsApp Business",
            "TOOLTIP": "המזהה שמטא נותנת לחשבון ה-WhatsApp Business המקושר"
          },
          "BUSINESS_PORTFOLIO_NAME": {
            "LABEL": "שם התיק העסקי",
            "TOOLTIP": "שם התיק העסקי במטא שחשבון ה-WhatsApp Business שייך לו"
          },
          "BUSINESS_PORTFOLIO_ID": {
            "LABEL": "מזהה התיק העסקי",
            "TOOLTIP": "המזהה שמטא נותנת לתיק העסקי שחשבון ה-WhatsApp Business שייך לו"
          }
        },
        "VALUES": {
          "TIERS": {
            "TIER_2K": "2,000 לקוחות ב-24 שעות"
          },
          "MODES": {
            "LIVE": "פעיל"
          },
          "STATUSES": {
            // the business category pill goes through the same lookup (formatStatusDisplay(vertical));
            // without these keys Meta's enum shows title-cased English ("Undefined", "Prof Services")
            "UNDEFINED": "לא נבחרה קטגוריה",
            "AUTO": "רכב",
            "BEAUTY": "יופי, ספא וטיפוח",
            "APPAREL": "ביגוד ואופנה",
            "EDU": "חינוך",
            "ENTERTAIN": "בידור",
            "EVENT_PLAN": "הפקת אירועים",
            "FINANCE": "פיננסים",
            "GROCERY": "מזון ומכולת",
            "GOVT": "ממשל ושירות ציבורי",
            "HOTEL": "מלונאות ולינה",
            "HEALTH": "רפואה ובריאות",
            "NONPROFIT": "עמותה",
            "PROF_SERVICES": "שירותים מקצועיים",
            "RETAIL": "קמעונאות",
            "TRAVEL": "תיירות ונסיעות",
            "RESTAURANT": "מסעדות",
            "NOT_A_BIZ": "לא עסק",
            "CONNECTED": "מחובר",
            "EXPIRED": "פג תוקף",
            "FLAGGED": "מסומן",
            "RESTRICTED": "מוגבל",
            "BANNED": "חסום",
            "DISCONNECTED": "מנותק",
            "PENDING_REVIEW": "בבדיקה",
            "AVAILABLE_WITHOUT_REVIEW": "עוד לא נבדק",
            "REJECTED": "לא אושר",
            "DECLINED": "לא אושר"
          },
          "QUALITY": {
            "GREEN": "גבוה",
            "YELLOW": "בינוני",
            "RED": "נמוך",
            "UNKNOWN": "עדיין אין דירוג"
          },
          "TIER_NAMES": {
            "TIER_250": "רמה 250",
            "TIER_1000": "רמה 1,000",
            "TIER_1K": "רמה 1,000",
            "TIER_2K": "רמה 2,000",
            "TIER_10K": "רמה 10,000",
            "TIER_100K": "רמה 100,000",
            "TIER_UNLIMITED": "ללא הגבלה"
          }
        },
        "BUSINESS_PROFILE": {
          "PREVIEW_LABEL": "הפרופיל העסקי בוואטסאפ"
        },
        "WEBHOOK": {
          "TITLE": "הגדרת webhook",
          "DESCRIPTION": "חשבון ה-WhatsApp Business צריך כתובת webhook כדי לקבל הודעות מלקוחות",
          "ACTION_REQUIRED": "ה-webhook לא הוגדר",
          "REGISTER_BUTTON": "רישום ה-webhook",
          "REGISTER_SUCCESS": "ה-webhook נרשם",
          "REGISTER_ERROR": "לא הצלחנו לרשום את ה-webhook. נסו שוב.",
          "CONFIGURED_SUCCESS": "ה-webhook הוגדר",
          "URL_MISMATCH": "כתובת ה-webhook לא תואמת",
          "CONFIGURED_URL": "הכתובת שמוגדרת",
          "EXPECTED_URL": "הכתובת הצפויה",
          "COPY_URL": "העתקת כתובת ה-webhook",
          "COPY_SUCCESS": "כתובת ה-webhook הועתקה"
        }
      },
      "ASSIGNMENT": {
        "DESCRIPTION": "שיוך אוטומטי של שיחות נכנסות לנציגים זמינים, לפי מדיניות השיוך",
        "ENABLE_AUTO_ASSIGNMENT": "הפעלת שיוך שיחות אוטומטי",
        "DEFAULT_RULES_TITLE": "כללי השיוך שבברירת המחדל",
        "DEFAULT_RULES_DESCRIPTION": "כל השיחות משויכות לפי ברירת המחדל",
        "DEFAULT_RULE_1": "השיחות הוותיקות ביותר קודם",
        "DEFAULT_RULE_2": "חלוקה בתורות",
        "CUSTOMIZE_WITH_POLICY": "התאמה עם מדיניות שיוך",
        "USING_POLICY": "התיבה הזו משתמשת במדיניות שיוך מותאמת",
        "CUSTOMIZE_POLICY": "התאמה עם מדיניות שיוך",
        "ASSIGNMENT_ORDER_LABEL": "סדר השיוך",
        "ASSIGNMENT_METHOD_LABEL": "שיטת השיוך",
        "METHOD": {
          "BALANCED": "שיוך מאוזן"
        },
        "UPGRADE_PROMPT": "מדיניות שיוך מותאמת זמינה במסלול Business",
        "SELF_HOSTED_PROMPT": "מדיניות שיוך מותאמת זמינה במסלול Premium",
        "FEATURE_DISABLED_PROMPT": "מדיניות שיוך מותאמת לא מופעלת בחשבון הזה.",
        "UPGRADE_TO_BUSINESS": "שדרוג ל-Business",
        "UPGRADE_TO_PREMIUM": "שדרוג ל-Premium",
        "DEFAULT_POLICY_LINKED": "מקושרת מדיניות ברירת המחדל",
        "DEFAULT_POLICY_DESCRIPTION": "קשרו מדיניות שיוך מותאמת כדי לקבוע איך השיחות בתיבה הזו משויכות לנציגים.",
        "LINK_EXISTING_POLICY": "קישור מדיניות קיימת",
        "CREATE_NEW_POLICY": "יצירת מדיניות חדשה",
        "VIEW_ALL_POLICIES": "לכל מדיניות השיוך",
        "CURRENT_BEHAVIOR": "כרגע השיוך פועל לפי ברירת המחדל:",
        "LINK_SUCCESS": "מדיניות השיוך קושרה",
        "LINK_ERROR": "לא הצלחנו לקשר את מדיניות השיוך"
      },
      "ASSIGNMENT_POLICY": {
        "DELETE_CONFIRM_TITLE": "להסיר את מדיניות השיוך?",
        "DELETE_CONFIRM_MESSAGE": "להסיר את מדיניות השיוך הזו מהתיבה? התיבה תחזור לכללי השיוך שבברירת המחדל.",
        "DELETE_SUCCESS": "מדיניות השיוך הוסרה",
        "DELETE_ERROR": "לא הצלחנו להסיר את מדיניות השיוך"
      },
      "CSAT": {
        "BUTTON_TEXT": {
          "LABEL": "טקסט הכפתור",
          "PLACEHOLDER": "דרגו אותנו"
        },
        "LANGUAGE": {
          "PLACEHOLDER": "בחירת שפת התבנית"
        },
        "MESSAGE_PREVIEW": {
          "LABEL": "תצוגה מקדימה של ההודעה",
          "TOOLTIP": "בוואטסאפ זה עשוי להיראות קצת אחרת."
        },
        "TEMPLATE_STATUS": {
          "APPROVED": "אושרה בוואטסאפ",
          "PENDING": "ממתינה לאישור של וואטסאפ",
          "REJECTED": "מטא דחתה את התבנית",
          "DEFAULT": "צריכה אישור של וואטסאפ",
          "NOT_FOUND": "התבנית לא קיימת במטא."
        },
        "TEMPLATE_CREATION": {
          "SUCCESS_MESSAGE": "תבנית הוואטסאפ נוצרה ונשלחה לאישור",
          "ERROR_MESSAGE": "לא הצלחנו ליצור את תבנית הוואטסאפ"
        },
        "TEMPLATE_UPDATE_DIALOG": {
          "TITLE": "עריכת פרטי הסקר",
          "DESCRIPTION": "נמחק את התבנית הקודמת וניצור חדשה, שתישלח שוב לאישור של וואטסאפ",
          "CONFIRM": "יצירת תבנית חדשה"
        },
        "UTILITY_ANALYZER": {
          "ACTION": "בדיקת התאמה לקטגוריית השירות",
          "HELPER_NOTE": "בדקו את ההודעה לפני ההגשה, כדי לשפר את ההתאמה לקטגוריית השירות (Utility). המערכת יוצרת תבנית CSAT ייעודית עם כפתורים לדוחות ומגישה אותה כ-Utility. מטא עדיין יכולה לסווג אותה מחדש כשיווק (Marketing), לפי התוכן.",
          "RESULT_LABEL": "הסיווג הצפוי במטא",
          "GUIDANCE_NOTE": "זו בדיקה מנחה, ולא התחייבות שמטא תאשר.",
          "SUGGESTION_LABEL": "ניסוח מוצע שמתאים לקטגוריית השירות",
          "APPLY": "שימוש בניסוח הזה",
          "ERROR_MESSAGE": "לא הצלחנו לבדוק את ההודעה. נסו שוב.",
          "CLASSIFICATION": {
            "LIKELY_UTILITY": "כנראה שירות",
            "LIKELY_MARKETING": "כנראה שיווק",
            "UNCLEAR": "צריך הבהרה"
          }
        },
        "WHATSAPP_NOTE": "לתשומת לבכם: בשמירה, המערכת יוצרת בוואטסאפ תבנית CSAT ייעודית (לאיסוף הדירוג והמשוב בדוחות) ומגישה אותה לאישור כ-Utility. מטא עדיין יכולה לסווג אותה כשיווק, לפי התוכן. אחרי האישור, הסקר נשלח רק פעם אחת בכל שיחה, לפי כלל הסקר."
      },
      "BUSINESS_HOURS": {
        "TOGGLE_HELP": "הפעלת הזמינות העסקית תציג את שעות הזמינות בווידג׳ט הצ׳אט באתר, גם כשאף נציג לא מחובר. מחוץ לשעות הזמינות אפשר להציג למבקרים הודעה וטופס לפני הצ׳אט."
      },
      "IMAP": {
        "NOTE_TEXT": "הגדירו IMAP כדי לקבל מיילים ישירות מתיבת הדואר שלכם. אם אתם משתמשים בהעברת מיילים, השאירו את זה כבוי."
      },
      "WIDGET_BUILDER": {
        "WIDGET_OPTIONS": {
          "WIDGET_BUBBLE": "בועה",
          "WIDGET_BUBBLE_POSITION_LABEL": "מיקום:",
          "WIDGET_BUBBLE_LAUNCHER_TITLE": {
            "LABEL": "כותרת כפתור הפתיחה"
          }
        },
        "WIDGET_SCREEN": {
          "CHAT": "מצב צ׳אט"
        }
      },
      "CHANNELS": {
        "MESSENGER": "מסנג׳ר",
        "WHATSAPP": "וואטסאפ"
      }
    },
    "CALLS_PAGE": {
      "HEADER": "שיחות קוליות"
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
    // settings/data: an import with no known provider shows this label, hardcoded in importSources.js (4.20)
    [/^File import( · .+)?$/, 'ייבוא מקובץ$1'],
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

  // settings/inboxes/:id, account health (AccountHealth.vue, 4.20):
  // - the quality pill prints Meta's raw rating (GREEN, UNKNOWN…) straight from the data and never
  //   looks up the QUALITY keys it ships. Only the text node changes; the colour class keys off the raw value.
  // - Meta's display number ("+972 3-376-0069") sits in RTL with no isolation and reads "3-376-0069 972+".
  //   dir=ltr isolates it; a block keeps its start (right) edge.
  var QUALITY_HE = HE_MESSAGES.INBOX_MGMT.ACCOUNT_HEALTH.VALUES.QUALITY;
  var PHONE = /^\+\d[\d\s()-]{6,}$/;
  function inboxHealth() {
    if (!/\/settings\/inboxes\/\d+/.test(location.pathname) || !isHe()) return;
    var els = document.querySelectorAll('main p, main span');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var n = el.firstChild;
      if (!n || n.nodeType !== 3 || el.childNodes.length !== 1) continue;
      var k = n.nodeValue.trim();
      if (el.classList.contains('bg-n-alpha-2') && Object.prototype.hasOwnProperty.call(QUALITY_HE, k)) {
        n.nodeValue = QUALITY_HE[k];
      } else if (PHONE.test(k) && !el.hasAttribute('dir')) {
        el.setAttribute('dir', 'ltr');
        if (getComputedStyle(el).display === 'block') el.style.textAlign = 'right';
      }
    }
  }

  function tick() {
    inboxHealth();
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
