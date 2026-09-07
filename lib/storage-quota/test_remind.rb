#!/usr/bin/env ruby
# בדיקה לבדה ללוגיקת התזכורת. מחלצת את remind? מהסקריפט עצמו כדי שלא
# ייווצר עותק שני שיסטה ממנו.  הרצה:  ruby test_remind.rb
require 'date'

src = File.read(File.join(__dir__, 'storage_quota_alert.rb'), encoding: 'UTF-8')
body = src[/^def remind\?.*?^end$/m] or abort 'remind? לא נמצאה בסקריפט'
WARN_EVERY  = 21
OVER_EVERY  = 14
WARN_GROWTH = 5.0
eval(body) # rubocop:disable Security/Eval

TODAY = Date.new(2026, 9, 7)
def state(days_ago, level, used, steps = 0)
  { 'last_sent' => (TODAY - days_ago).to_s, 'level' => level,
    'used_gb' => used, 'extra_steps' => steps }
end

# מייל ראשון תמיד יוצא
raise 'מייל ראשון' unless remind?(nil,  level: 'warn', today: TODAY, used: 8.1, quota: 10, steps: 0)
raise 'state ריק'   unless remind?({},   level: 'warn', today: TODAY, used: 8.1, quota: 10, steps: 0)

# אזהרה: לקוח שלא זז לא מקבל תזכורת, גם אחרי חודשיים
raise 'לקוח סטטי קיבל חפירה' if remind?(state(60, 'warn', 8.1), level: 'warn', today: TODAY, used: 8.13, quota: 10, steps: 0)
# ...וגם לא כשהוא טיפס אבל רק לפני יומיים
raise 'תזכורת מוקדמת מדי'    if remind?(state(2, 'warn', 8.1), level: 'warn', today: TODAY, used: 9.0, quota: 10, steps: 0)
# טיפס 5% מהמכסה ועברו 21 יום → כן
raise 'טיפוס אמיתי לא דווח'  unless remind?(state(25, 'warn', 8.1), level: 'warn', today: TODAY, used: 8.7, quota: 10, steps: 0)
# עברו 21 יום אבל הטיפוס זניח → לא
raise 'טיפוס זניח דווח'      if remind?(state(25, 'warn', 8.1), level: 'warn', today: TODAY, used: 8.3, quota: 10, steps: 0)

# חריגה: מדרגת חיוב חדשה יוצאת מיד, גם יום אחרי המייל הקודם
raise 'מדרגת חיוב לא דווחה'  unless remind?(state(1, 'over', 21.0, 1), level: 'over', today: TODAY, used: 31.0, quota: 20, steps: 2)
# אותה מדרגה, יומיים אחרי → שקט
raise 'חפירה על אותה מדרגה'  if remind?(state(2, 'over', 21.0, 1), level: 'over', today: TODAY, used: 22.0, quota: 20, steps: 1)
# אותה מדרגה, אבל עברו 14 יום והחריגה גדלה → תזכורת
raise 'חריגה מתמשכת לא דווחה' unless remind?(state(15, 'over', 21.0, 1), level: 'over', today: TODAY, used: 23.0, quota: 20, steps: 1)
# עברו 14 יום והחריגה לא גדלה → שקט
raise 'חריגה קפואה דווחה'    if remind?(state(15, 'over', 21.0, 1), level: 'over', today: TODAY, used: 21.0, quota: 20, steps: 1)

# ירידה מחריגה לאזהרה לא מייצרת מייל (אחרת תנודה סביב הגבול = הצפה)
raise 'ירידה מ-over דווחה'   if remind?(state(30, 'over', 21.0, 1), level: 'warn', today: TODAY, used: 18.0, quota: 20, steps: 0)

# state פגום → שולחים, עדיף מייל מיותר מלקוח שלא יודע
raise 'state פגום השתיק'     unless remind?({ 'last_sent' => 'לא-תאריך' }, level: 'warn', today: TODAY, used: 9.0, quota: 10, steps: 0)

puts 'כל הבדיקות עברו ✅'
