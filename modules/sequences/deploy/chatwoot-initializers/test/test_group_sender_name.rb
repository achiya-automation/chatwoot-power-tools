#!/usr/bin/env ruby
# frozen_string_literal: true
# הבדיקה מריצה את ה-regex של ה-initializer בלי Rails
src = File.read(File.expand_path('../whatsapp_contact_naming.rb', __dir__), encoding: 'UTF-8')
re = eval(src[/WAHA_GROUP_SENDER_JID = (\/.*?\/)\.freeze/m, 1])
strip = ->(c) { c.to_s.start_with?('👥 *') ? c.sub(re, '\1*') : c }

cases = [
  ["👥 *REDACTED (REDACTED)*\n\nשלום", "👥 *REDACTED*\n\nשלום"],
  ["👥 *⚜️REDACTED⚜️ (REDACTED)*\n\nטקסט", "👥 *⚜️REDACTED⚜️*\n\nטקסט"],
  ["👥 *דרך REDACTED (REDACTED)*\n\nא", "👥 *דרך REDACTED*\n\nא"],
  ["👥 *Dana (972501234567@c.us)*\n\nב", "👥 *Dana*\n\nב"],
  # שם שמכיל כוכביות נשמר כמו שהוא
  ["👥 ** REDACTED ❤️* Or ❤️ (REDACTED)*\n\nג", "👥 ** REDACTED ❤️* Or ❤️*\n\nג"],
  # בלי שם — WAHA לא מוסיף סוגריים, ואסור לגעת
  ["👥 *REDACTED*\n\nד", "👥 *REDACTED*\n\nד"],
  # הודעה רגילה לא נגעת, וגם לא JID בגוף ההודעה
  ["הודעה רגילה (123@lid) בתוך טקסט", "הודעה רגילה (123@lid) בתוך טקסט"],
  ["👥 *REDACTED*\n\nכבר נקי", "👥 *REDACTED*\n\nכבר נקי"],
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
