#!/usr/bin/env ruby
# frozen_string_literal: true
# הבדיקה מריצה את ה-regex של ה-initializer בלי Rails
src = File.read(File.expand_path('../whatsapp_contact_naming.rb', __dir__), encoding: 'UTF-8')
re = eval(src[/WAHA_GROUP_SENDER_JID = (\/.*?\/)\.freeze/m, 1])
strip = ->(c) { c.to_s.start_with?('👥 *') ? c.sub(re, '\1*') : c }

cases = [
  ["👥 *dana (1000000000001@lid)*\n\nשלום", "👥 *dana*\n\nשלום"],
  ["👥 *⚜️Avi⚜️ (100000000000002@lid)*\n\nטקסט", "👥 *⚜️Avi⚜️*\n\nטקסט"],
  ["👥 *שירה כהן (100000000000003@lid)*\n\nא", "👥 *שירה כהן*\n\nא"],
  ["👥 *Dana (972501234567@c.us)*\n\nב", "👥 *Dana*\n\nב"],
  # שם שמכיל כוכביות נשמר כמו שהוא
  ["👥 ** Tal ❤️* Gal ❤️ (100000000000004@lid)*\n\nג", "👥 ** Tal ❤️* Gal ❤️*\n\nג"],
  # בלי שם — WAHA לא מוסיף סוגריים, ואסור לגעת
  ["👥 *1000000000001@lid*\n\nד", "👥 *1000000000001@lid*\n\nד"],
  # הודעה רגילה לא נגעת, וגם לא JID בגוף ההודעה
  ["הודעה רגילה (123@lid) בתוך טקסט", "הודעה רגילה (123@lid) בתוך טקסט"],
  ["👥 *dana*\n\nכבר נקי", "👥 *dana*\n\nכבר נקי"],
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
