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
      "DATA": "נתונים"
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
    // Chatwoot 4.20's new WhatsApp inbox screens (manual Cloud API setup, the per-inbox app secret, the move off
    // embedded signup) and the widget security settings shipped with these keys missing from he (23.11.2026).
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
