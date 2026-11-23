# frozen_string_literal: true

require 'minitest/autorun'

# The initializer's Rails half only runs inside Chatwoot; the rules live in plain module functions.
module Rails
  def self.application
    Struct.new(:config, :routes).new(Struct.new(:x) { def to_prepare; end }.new,
                                     Struct.new(:x) { def append; end }.new)
  end
end

require_relative '../smart_import_server'

class SmartImportServerTest < Minitest::Test
  SI = SmartImportServer

  def test_match_keys_are_the_ones_chatwoot_matches_on
    assert_equal ['identifier:ID-7', 'email:dana@example.com', 'phone_number:+972527654321'],
                 SI.match_keys('identifier' => ' ID-7 ', 'email' => 'Dana@Example.com', 'phone_number' => '+972527654321', 'name' => 'x')
    assert_empty SI.match_keys('name' => 'Dana', 'email' => '  ')
  end

  def test_preview_counts_existing_then_duplicates_in_the_file_then_new
    rows = [
      ['email:old@example.com'],                       # an existing contact
      ['phone_number:+972500000001'],                  # new
      ['phone_number:+972500000001', 'email:b@x.com'], # same phone as the row above
      ['email:b@x.com'],                               # shares the email the row above brought
      []                                               # a name only: Chatwoot creates it
    ]
    counts = SI.preview_counts(rows, { 'email:old@example.com' => true })
    assert_equal({ 'total' => 5, 'new' => 2, 'existing' => 1, 'dup_in_file' => 2 }, counts)
  end

  def test_arm_options_are_typed_and_capped
    assert_equal({ 'whatsapp' => true, 'email_summary' => false, 'label' => 'ייבוא-נובמבר', 'locale' => 'he' },
                 SI.arm_options('whatsapp' => true, 'email_summary' => 'no', 'label' => ' ייבוא-נובמבר ', 'locale' => 'fr', 'x' => 1))
    assert_equal 'en', SI.arm_options('locale' => 'en')['locale']
    assert_equal 255, SI.arm_options('label' => 'a' * 400)['label'].length
    assert_equal "cwpt:smart_import:arm:1:2:#{'a' * 64}", SI.arm_key(1, 2, 'a' * 64)
  end

  def test_reserved_columns_land_in_attributes_and_never_as_custom_attributes_named_cwpt
    fields = { 'name' => 'דנה', 'labels' => 'vip', 'notes' => 'stays custom', 'cwpt:company_name' => 'סטודיו דנה',
               'cwpt:city' => 'חיפה', 'cwpt:country' => ' ', 'cwpt:custom:policy' => 'P-1', 'cwpt:custom:' => 'x',
               'cwpt:row' => '2', 'cwpt:phone_raw' => '123', 'cwpt:unknown' => 'dropped' }
    rest, extra, custom = SI.split_fields(fields)
    assert_equal({ 'name' => 'דנה', 'labels' => 'vip', 'notes' => 'stays custom' }, rest)
    assert_equal({ 'company_name' => 'סטודיו דנה', 'city' => 'חיפה' }, extra)
    assert_equal({ 'policy' => 'P-1' }, custom)
  end

  def test_report_rows_carry_the_spreadsheet_row_and_why_whatsapp_will_not_reach_them
    created = SI.log_row('imported', 41, nil, { 'outcome' => 'created', 'row_number' => 1,
                                                'fields' => { 'name' => 'Dana', 'phone_number' => '', 'cwpt:row' => '2', 'cwpt:phone_raw' => '123' } }, 'en')
    assert_equal ['2', 'Dana', 'created', 41, 'Invalid phone (123) — will not receive WhatsApp'], created
    failed = SI.log_row('failed', nil, 'Unknown labels: x', { 'row_number' => 4, 'fields' => { 'name' => 'Yossi' } }, 'he')
    assert_equal [5, 'Yossi', 'failed', nil, 'Unknown labels: x'], failed
    phone = SI.log_row('imported', 7, nil, { 'outcome' => 'updated', 'fields' => { 'phone_number' => '+972500000001' } }, 'he')
    assert_equal '', phone.last
  end

  def test_report_csv_neutralizes_formulas_and_quotes
    csv = SI.log_csv([[2, '=HYPERLINK("x")', 'created', 1, 'a, b']])
    assert_equal "row,name,status,contact_id,reason\n2,\"'=HYPERLINK(\"\"x\"\")\",created,1,\"a, b\"\n", csv
  end

  def test_summary_in_both_languages
    subject, body = SI.summary(locale: 'he', status: 'completed_with_errors', account_name: 'חשבון',
                               stats: { 'total' => 5, 'created' => 3, 'updated' => 1, 'failed' => 1, 'skipped' => 0 },
                               label: 'ייבוא-נובמבר', no_phone: 2, top_error: ['Unknown labels: x', 1])
    assert_equal 'הייבוא הושלם — נוצרו 3, עודכנו 1 (חשבון)', subject
    assert_includes body, "נוצרו: 3\nעודכנו: 1\nדולגו: 0\nנכשלו: 1"
    assert_includes body, 'תווית שהוקצתה: ייבוא-נובמבר'
    assert_includes body, '⚠️ 2 אנשי קשר'
    assert_includes body, 'השגיאה הנפוצה: Unknown labels: x (×1)'
    refute_includes body, 'השורות הראשונות'

    subject, body = SI.summary(locale: 'en', status: 'completed', account_name: 'Acme', stats: { 'total' => 1, 'created' => 1 },
                               truncated: true)
    assert_equal 'Import complete — 1 created, 0 updated (Acme)', subject
    refute_includes body, 'Label applied'
    assert_includes body, "The report lists the first #{SI::LOG_MAX} rows."
  end

  def test_a_failed_import_says_where_to_resume
    subject, body = SI.summary(locale: 'he', status: 'failed', account_name: 'חשבון', error: 'CSV column names must be present and unique.')
    assert_equal 'הייבוא נעצר עקב שגיאה (חשבון)', subject
    assert_includes body, 'CSV column names must be present and unique.'
    assert_includes body, 'הגדרות › נתונים'
  end

  def test_every_string_exists_in_both_languages
    assert_equal SI::I18N['he'].keys, SI::I18N['en'].keys
  end

  def test_each_extension_names_a_chatwoot_class_once
    assert_equal %w[DataImports::CreationService DataImports::Csv::ContactWriter DataImports::Csv::Importer
                    DataImports::Csv::NotificationJob], SI::EXTENSIONS.keys
  end
end
