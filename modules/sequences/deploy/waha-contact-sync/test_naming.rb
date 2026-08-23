#!/usr/bin/env ruby
# frozen_string_literal: true
# Self-check for name precedence. Run: ruby test_naming.rb
ENV['WAHA_CONTACT_SYNC_LIB_ONLY'] = '1'
require 'json'
require 'tmpdir'

cfg = File.join(Dir.mktmpdir, 'cfg.json')
File.write(cfg, JSON.generate('waha_base_url' => 'http://localhost',
                              'targets' => [{ 'session' => 's', 'account_id' => 1, 'inbox_id' => 23, 'key' => 'x' }]))
ENV['WAHA_CONTACT_SYNC_CONFIG'] = cfg
require_relative 'waha_contact_sync'

sync = WahaContactSync.new(mode: 'full', dry_run: true)
pick = ->(records) { sync.send(:preferred_profile_name, records) }

# השם השמור בפנקס גובר על שם הפרופיל הציבורי
assert_pairs = [
  [[{ 'name' => 'ד״ר תמיר בן יאיר', 'pushname' => '〽️' }], 'ד״ר תמיר בן יאיר'],
  [[{ 'name' => 'תמיר, לקוח לבוט ב 450 שח', 'pushname' => 'Tamir' }], 'תמיר, לקוח לבוט ב 450 שח'],
  # אין שם שמור -> נופלים לשם הפרופיל
  [[{ 'name' => '', 'pushname' => 'Tamir' }], 'Tamir'],
  [[{ 'name' => nil, 'pushName' => 'Yael' }], 'Yael'],
  # שם שמור אצל רשומה שנייה גובר על פרופיל של הראשונה
  [[{ 'name' => '', 'pushname' => 'S' }, { 'name' => 'לינוי לגאלי כהן' }], 'לינוי לגאלי כהן'],
  # מזהה טכני אינו שם
  [[{ 'name' => '972501234567@c.us', 'pushname' => 'Dana' }], 'Dana'],
  [[{ 'name' => '', 'pushname' => '' }], nil],
  [[], nil]
]

failures = assert_pairs.reject do |records, expected|
  actual = pick.call(records)
  ok = actual == expected
  warn "FAIL #{records.inspect} => #{actual.inspect}, expected #{expected.inspect}" unless ok
  ok
end

# סדר העדיפות חייב להישאר פנקס->פרופיל גם כשה-JSON משתמש ב-pushName וב-pushname
raise 'name precedence regressed' unless failures.empty?

# קיצור התיאור: השורה הראשונה המשמעותית, בלי קישורים, מקוצרת
topic = ->(v) { sync.send(:sanitize_topic, v) }
topic_cases = [
  [topic.call("ברוכים הבאים לקהילת n8n\nשורה שנייה"), 'ברוכים הבאים לקהילת n8n'],
  [topic.call("https://chat.whatsapp.com/abc\nקבוצת משלוחים"), 'קבוצת משלוחים'],
  [topic.call("*הקבוצה פעילה מ-2018*\nעוד טקסט"), 'הקבוצה פעילה מ-2018'],
  [topic.call("\n\n   \n"), nil],
  [topic.call(nil), nil],
  [topic.call('א' * 200), "#{'א' * 120}…"],
  [topic.call('אב'), nil]
]
topic_fails = topic_cases.reject do |actual, expected|
  ok = actual == expected
  warn "FAIL topic: #{actual.inspect}, expected #{expected.inspect}" unless ok
  ok
end
raise 'topic sanitising regressed' unless topic_fails.empty?

# שורת התיאור של קבוצה: מספר משתתפים + נושא
line = ->(f) { sync.send(:group_description_line, f) }
owns = ->(c) { sync.send(:owns_description?, c) }

group_cases = [
  [line.call({ participants: 1021, topic: 'משלוחים באזור המרכז' }), '1,021 משתתפים · משלוחים באזור המרכז'],
  [line.call({ participants: 12, topic: nil }), '12 משתתפים'],
  [line.call({ participants: nil, topic: 'רק נושא' }), 'רק נושא'],
  [line.call({ participants: nil, topic: nil }), nil],
  [line.call({ participants: 5_432, topic: nil }), '5,432 משתתפים'],
  # נוגעים בתיאור ריק ובתיאור שאנחנו כתבנו, לא בטקסט אנושי
  [owns.call(nil), true],
  [owns.call(''), true],
  [owns.call('1,021 משתתפים · משלוחים'), true],
  [owns.call('12 משתתפים'), true],
  [owns.call('לקוח חשוב — לחזור אליו'), false]
]

group_fails = group_cases.reject do |actual, expected|
  ok = actual == expected
  warn "FAIL group: #{actual.inspect}, expected #{expected.inspect}" unless ok
  ok
end
raise 'group description regressed' unless group_fails.empty?

puts "ok — #{assert_pairs.size} name-precedence + #{group_cases.size} group-description + #{topic_cases.size} topic assertions passed"
