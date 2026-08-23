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

puts "ok — #{assert_pairs.size} name-precedence assertions passed"
