// native-i18n-he — Hebrew overlay for Chatwoot 4.17's two new native WhatsApp screens
// (settings/templates + campaigns/whatsapp analytics), which shipped without he translations.
//
// Why an overlay at all: on the MAIN server we build the frontend ourselves, so proper he
// locale files are baked in (patch 06-hebrew-i18n-native-screens) and every replacement below
// simply never matches — this file is a no-op there. The ADMON server runs the stock image
// (no custom build), so until our translations land upstream (submitted via Crowdin) this
// overlay is the only way its Hebrew users see the new screens in Hebrew.
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
