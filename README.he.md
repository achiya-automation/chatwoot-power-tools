# chatwoot-power-tools

**פקודה אחת מוסיפה ל-Chatwoot העצמאי שלכם ייבוא אנשי-קשר חכם, רצפי WhatsApp אוטומטיים,
ושדרוגי דשבורד — בלי שרת נפרד, בלי סאב-דומיין, בלי הרשמה לשירות נוסף.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/achiya-automation/chatwoot-power-tools?style=social)](https://github.com/achiya-automation/chatwoot-power-tools/stargazers)
[![CI](https://github.com/achiya-automation/chatwoot-power-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/achiya-automation/chatwoot-power-tools/actions/workflows/ci.yml)

> תיעוד זה הוא תרגום מלא ומקביל ל-[README.md](README.md) האנגלי. קוד ותיעוד ציבורי אחר
> בפרויקט זה כתובים באנגלית.

chatwoot-power-tools מתקין container קטן (sidecar) בתוך ה-Docker Compose stack הקיים של
Chatwoot. כל מה שהוא מוסיף מוגש **מאותו origin**, תחת route יחיד `/chatwoot-addons/*` —
בלי דומיין נפרד, בלי CORS, בלי התחברות נוספת.

> **לא מיועד ל-Chatwoot Cloud.** ההתקנה מוסיפה container, role במסד הנתונים, ו-route
> ב-reverse proxy — ישירות על השרת שלכם. פעולות שאינן אפשריות בשירות המנוהל Chatwoot
> Cloud. מיועד ל-Chatwoot עצמאי (self-hosted) על Docker Compose בלבד. ראו
> [docs/hosting.md](docs/hosting.md) אם אתם שוקלים בין השניים.

## תכונות

### 📥 ייבוא אנשי-קשר חכם
אשף ייבוא CSV/Excel, בעיצוב זהה ל-Chatwoot עצמו. מזהה עמודות בשתי שפות (עברית ואנגלית),
מסמן כפילויות לפני הייבוא, ממפה עמודות למאפיינים מותאמים-אישית (custom attributes) של
Chatwoot, ומתייג — הכול מתוך הדשבורד.

<!-- TODO: add GIF — docs/screenshots/smart-import-wizard.gif -->

### 🔁 רצפי WhatsApp אוטומטיים
רצפי הודעות-תבנית אוטומטיים ב-WhatsApp Cloud API, מנוהלים במלואם מתוך Chatwoot. שיוך ליד
לרצף נעשה על-ידי הגדרת מאפיין על השיחה; ההודעות נשלחות במרווחים שהגדרתם לכל שלב, עם דילוג
אוטומטי על שעות-שקט, שבת, וחגים יהודיים.

<!-- TODO: add GIF — docs/screenshots/sequences-editor.gif -->

### ✨ שדרוגי דשבורד
מוסיף פריט "רצפים" לסיידבר הראשי, משדרג את מודאל קמפיין ה-WhatsApp המובנה של Chatwoot עם
צ'יפים למשתנים ותצוגה מקדימה חיה של ההודעה, ומוסיף כפתור דחיסת-וידאו בצד הלקוח (דרך
WebCodecs) כדי לצרף וידאו מעבר למגבלת 16MB של WhatsApp בלי שלב טרנסקודינג בצד השרת.

<!-- TODO: add GIF — docs/screenshots/dashboard-enhancements.gif -->

## התקנה מהירה

הריצו זאת **על שרת ה-Chatwoot העצמאי שלכם**, כ-root או עם sudo:

```bash
curl -fsSL https://github.com/achiya-automation/chatwoot-power-tools/archive/refs/heads/main.tar.gz | tar xz \
  && cd chatwoot-power-tools-main \
  && sudo bash install.sh
```

הפקודה מזהה את התקנת ה-Chatwoot שלכם, מבקשת אישור כן/לא, ומתקינה את כל שלושת המודולים
(הוסיפו `--modules=` כדי לבחור תת-קבוצה — ראו למטה). מעדיפים לבדוק את הקוד קודם (מומלץ),
או להשתמש ב-`git`?

```bash
git clone https://github.com/achiya-automation/chatwoot-power-tools.git
cd chatwoot-power-tools
sudo bash install.sh --dry-run   # הצגת התוכנית המלאה, ללא שינויים בפועל
sudo bash install.sh             # התקנה בפועל
```

## מודולים

| מודול | דגל `--modules=` | מה הוא מוסיף |
|---|---|---|
| ייבוא אנשי-קשר חכם | `import` | אשף ייבוא CSV/Excel בדשבורד |
| רצפי WhatsApp | `sequences` | מנוע הרצפים + ממשק ניהול + פריט בסיידבר |
| שדרוגי דשבורד | `dashboard` | שדרוג מודאל הקמפיין + דחיסת וידאו |

התקינו את כל השלושה (ברירת מחדל), או רק את מה שאתם צריכים:

```bash
sudo bash install.sh --modules=all
sudo bash install.sh --modules=import,sequences
sudo bash install.sh --modules=dashboard
```

## שימוש

```
Usage: install.sh [options]

  --dry-run          Show the installation plan; make no changes.
  --uninstall        Remove chatwoot-power-tools (route, engine container, dashboard
                      script). The provisioned database role/schema is left in place —
                      a manual DROP is printed, never run automatically.
  --modules=LIST      Comma-separated: all | import,sequences,dashboard (default: all).
  --yes               Do not prompt for confirmation.
  -h, --help          Show this help.
```

הסרה היא אותה פקודה עם דגל אחד:

```bash
sudo bash install.sh --uninstall
```

## דרישות

- התקנת Chatwoot **עצמאית** (self-hosted) על Docker Compose v2, על שרת Linux שיש לכם
  אליו גישת root/sudo.
- Chatwoot v4.x (נבדק אמפירית מול v4.15.1 — ההתקנה מזהה שמות containers ושירותים באופן
  דינמי במקום להניח מבנה קבוע, ולכן צפויה לעבוד באותה צורה על גרסאות v4.x אחרות).
- reverse proxy מול Chatwoot: Caddy או nginx מקבלים route אוטומטי; כל אחר (Traefik וכו')
  מקבל קטע קונפיגורציה מוכן-להעתקה במקום זאת.

## איך זה עובד

`install.sh` מזהה את הסביבה שלכם, מקצה role+schema במסד הנתונים עם הרשאות מינימליות,
מפעיל container קטן (`cwpt-engine`) לצד ה-containers הקיימים של Chatwoot, מוסיף route
אחד ב-reverse proxy, ומזריק סקריפט דשבורד. פרטים טכניים מלאים — ההרשאות המדויקות של role
מסד הנתונים, אסטרטגיית מיזוג סקריפט הדשבורד, המנוע שמבצע self-migration — נמצאים ב-
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (אנגלית).

## שאלות נפוצות

**האם זה עובד עם Chatwoot Cloud?**
לא. ראו את ההערה למעלה ואת [docs/hosting.md](docs/hosting.md).

**האם מידע שלי נשלח לצד שלישי?**
לא. המנוע מתקשר רק עם ה-API של התקנת ה-Chatwoot שלכם עצמה — Chatwoot עצמו מעביר משם את
שליחות ה-WhatsApp הלאה ל-Meta, בדיוק כפי שהוא כבר עושה עבור כל ערוץ WhatsApp Cloud API —
ועם ה-API הציבורי של Hebcal לתאריכי חגים יהודיים. אין אנליטיקה, אין טלמטריה.

**מה בדיוק ההתקנה נוגעת בו על השרת שלי?**
role+schema אחד במסד הנתונים (`drip_engine`/`drip`, הרשאות מינימליות — ראו
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)), container אחד (`cwpt-engine`), route אחד
ב-reverse proxy (`/chatwoot-addons/*`), ובלוק מסומן אחד בתוך ההגדרה `DASHBOARD_SCRIPTS`
של Chatwoot (כל תוכן קיים שם נשמר, לא נדרס).

**אפשר להסיר בצורה נקייה?**
כן — `sudo bash install.sh --uninstall` מבטל את כל מה שלמעלה. ה-role/schema במסד הנתונים
נשארים במכוון (פקודת `DROP` ידנית מודפסת למסך) — מחיקת נתונים אוטומטית היא לא החלטה
שההתקנה צריכה לקבל במקומכם.

**ה-reverse proxy שלי הוא לא Caddy או nginx. מה עכשיו?**
ההתקנה מדפיסה בלוק קונפיגורציה מוכן-להעתקה במקום להיכשל.

**זה חינם?**
התוכנה חינמית ומורשית ב-MIT. הפעלתה עדיין עולה כמה שהשרת שלכם כבר עולה. ראו
[docs/hosting.md](docs/hosting.md) למבט שקוף על אפשרויות אחסון, כולל שירות התקנה/תחזוקה
בתשלום אם אתם מעדיפים לא להריץ את ההתקנה בעצמכם.

## תרומה לפרויקט (Contributing)

Issues ו-Pull Requests מתקבלים בברכה — ראו את תבניות ה-issue לדיווח באגים ובקשות
פיצ'רים. CI (‏`.github/workflows/ci.yml`) מריץ את חבילת הטסטים המלאה (‏`node --test`
בשלושת המודולים, וחבילת `bats` ל-`install.sh`/`lib/`) על כל push ו-pull request.

## רישיון

[MIT](LICENSE)

---

נבנה על-ידי [Achiya Automation](https://achiya-automation.com). מודל ההכנסה של הפרויקט
שקוף לחלוטין — ראו [docs/hosting.md](docs/hosting.md) לקישורי ה-referral הגלויים ולשירות
ההתקנה/תחזוקה בתשלום.
