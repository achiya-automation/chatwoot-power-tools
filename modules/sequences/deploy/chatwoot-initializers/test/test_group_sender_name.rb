#!/usr/bin/env ruby
# frozen_string_literal: true
# הבדיקה מריצה את ה-regex של ה-initializer בלי Rails
src = File.read(File.expand_path('../whatsapp_contact_naming.rb', __dir__), encoding: 'UTF-8')
re = eval(src[/WAHA_GROUP_SENDER_JID = (\/.*?\/)\.freeze/m, 1])
strip = ->(c) { c.to_s.start_with?('👥 *') ? c.sub(re, '\1*') : c }

cases = [
  ["👥 *miki (2212210188291@lid)*\n\nשלום", "👥 *miki*\n\nשלום"],
  ["👥 *⚜️Shimon⚜️ (123424810745969@lid)*\n\nטקסט", "👥 *⚜️Shimon⚜️*\n\nטקסט"],
  ["👥 *דרך אמונה (255486649753712@lid)*\n\nא", "👥 *דרך אמונה*\n\nא"],
  ["👥 *Dana (972501234567@c.us)*\n\nב", "👥 *Dana*\n\nב"],
  # שם שמכיל כוכביות נשמר כמו שהוא
  ["👥 ** Ilay ❤️* Or ❤️ (220396364247130@lid)*\n\nג", "👥 ** Ilay ❤️* Or ❤️*\n\nג"],
  # בלי שם — WAHA לא מוסיף סוגריים, ואסור לגעת
  ["👥 *2212210188291@lid*\n\nד", "👥 *2212210188291@lid*\n\nד"],
  # הודעה רגילה לא נגעת, וגם לא JID בגוף ההודעה
  ["הודעה רגילה (123@lid) בתוך טקסט", "הודעה רגילה (123@lid) בתוך טקסט"],
  ["👥 *miki*\n\nכבר נקי", "👥 *miki*\n\nכבר נקי"],
  [nil, nil], ["", ""]
]

fails = cases.reject do |input, expected|
  actual = strip.call(input)
  ok = actual == expected
  warn "FAIL #{input.inspect} => #{actual.inspect}, expected #{expected.inspect}" unless ok
  ok
end
raise 'group sender stripping regressed' unless fails.empty?
puts "ok — #{cases.size} group-sender assertions passed"
