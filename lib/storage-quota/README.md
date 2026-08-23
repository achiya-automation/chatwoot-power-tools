# מכסת אחסון מדיה + דדופ

כלים לניהול נפח האחסון של Chatwoot: מדידה לפי לקוח, התראה על חריגה, ואיחוד קבצים כפולים.

## למה זה קיים

עד 07/2026 האחסון של השרת הראשי גדל מ-~0.05GB לחודש ל-**16GB לחודש** — 7 לקוחות חדשים
הצטרפו ביוני-יולי. בבדיקה התברר ש-**44% מהנפח היוצא היה עותקים כפולים**: אותו קובץ
(וידאו של רצף דריפ, תשובה קבועה) נשלח לעשרות נמענים, ו-Chatwoot יצר blob וקובץ חדשים
בכל שליחה. וידאו אחד של 14.5MB היה שמור 48 פעמים.

## הקבצים

| קובץ | מה הוא עושה |
|---|---|
| `storage_quota_alert.rb` | מחשב שימוש לכל חשבון, מרכיב הודעות, ושולח מייל ללקוח כש-`SEND=1` |
| `storage-quota-alert.sh` | ה-wrapper שרץ ב-cron: מריץ את החישוב ושולח סיכום WhatsApp לאחיה |
| `storage-quota.env.example` | תבנית קונפיג — להעתיק ל-`storage-quota.env` בשרת ולמלא |
| `dedupe_blobs.rb` | איחוד חד-פעמי של blobs כפולים קיימים |

## תמחור

עד **10GB** אחסון מדיה כלול. מעבר לכך **30₪ לחודש לכל 10GB נוספים**, מעוגל כלפי מעלה
(10.1GB ו-20GB שניהם מדרגה אחת). מכסה מותאמת ללקוח ששדרג נשמרת ב-
`account.custom_attributes['storage_quota_gb']`.

## התקנה

```bash
scp storage-quota-alert.sh storage_quota_alert.rb <server>:/tmp/
ssh <server> "sudo mv /tmp/storage-quota-alert.sh /tmp/storage_quota_alert.rb /opt/chatwoot/scripts/ \
  && sudo chmod +x /opt/chatwoot/scripts/storage-quota-alert.sh"
# ואז להעתיק את storage-quota.env.example ל-/opt/chatwoot/scripts/storage-quota.env ולמלא
```

cron יומי: `0 9 * * * /opt/chatwoot/scripts/storage-quota-alert.sh >/dev/null 2>&1`

## בטיחות

- **`SEND=0` היא ברירת המחדל** — הרצה יבשה שמדפיסה בדיוק מה היה נשלח ולמי, בלי לשלוח דבר.
- `ALERT_COOLDOWN_DAYS` מונע הצפה: אותו לקוח לא מקבל את אותה התראה יותר מפעם בשבוע.
- הקונפיג משתמש ב-`: "${X:=y}"` כדי שערך מהסביבה יגבר, לבדיקה ידנית:
  `sudo QUOTA_WARN_PCT=70 /opt/chatwoot/scripts/storage-quota-alert.sh`

## הדדופ

`dedupe_blobs.rb` מאחד blobs עם checksum + byte_size זהים **בתוך אותו חשבון בלבד** —
קבצים לא עוברים בין לקוחות. בטוח כי ל-`active_storage_attachments.blob_id` יש FK,
ולכן `Blob#purge` עושה `rescue ActiveRecord::InvalidForeignKey` ומשאיר את הקובץ
כל עוד attachment אחר מצביע אליו.

```bash
rails runner dedupe_blobs.rb            # יבש
APPLY=1 rails runner dedupe_blobs.rb    # ביצוע
```

ריצה ראשונה (27.07.2026, שרת ראשי): **3.20GB ב-7,160 blobs**, 16.21GB → 13.02GB.

⚠️ המדידה למכסה סופרת blob משותף **פעם אחת לחשבון**. אחרת הדדופ היה "מוריד" ללקוח
אחסון שהוא באמת צורך, והחיוב היה קופץ ויורד בלי שהוא עשה דבר.

## מניעה קדימה

הדדופ החד-פעמי מטפל בעבר. מה שמונע חזרה הוא
`patches/03-attachment-dedupe.patch` ב-`~/chatwoot-unread-tab` — מאתר blob זהה
בזמן ההעלאה ומשתמש בו מחדש. דורש index על `active_storage_blobs (checksum, byte_size)`.
