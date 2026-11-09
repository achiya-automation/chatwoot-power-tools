# frozen_string_literal: true

require 'minitest/autorun'

# Load the initializer without Rails: only the plain ContactFields helpers are
# exercised here; the to_prepare block (model and import wiring) is skipped.
module Rails
  class Config
    def to_prepare = nil
  end

  class App
    def config = Config.new
  end

  def self.application = App.new
end

load File.expand_path('../whatsapp_contact_naming.rb', __dir__)

class ContactFieldsTest < Minitest::Test
  def test_every_israeli_spelling_becomes_one_international_number
    ['050-123-4567', '0501234567', ' 050 123 4567 ', '+0501234567', '972501234567', '972-50-1234567',
     '+972 50-123-4567', '+972501234567', '+9720501234567', '(050) 123-4567'].each do |raw|
      assert_equal '+972501234567', ContactFields.phone(raw), raw
    end
    assert_equal '+97231234567', ContactFields.phone('03-1234567')
  end

  def test_foreign_numbers_pass_and_non_numbers_are_not_guessed
    assert_equal '+14155550100', ContactFields.phone('+1 415 555 0100')
    assert_equal '+447700900123', ContactFields.phone('+447700900123')
    # a WhatsApp LID, an ID number, a short number, words: never a phone
    ['123456789012345', '5252446876', '050-123', '1800', 'דנה', '', nil, '038123456789'].each do |raw|
      assert_nil ContactFields.phone(raw), raw.inspect
    end
  end

  def test_placeholder_names
    ['', nil, '+972 50-123-4567', '050-1234567', 'muddy-pine-495', '972501234567@c.us', '123456789012345@lid'].each do |name|
      assert ContactFields.placeholder_name?(name), name.inspect
    end
    ['דנה כהן', 'Dana', 'מספרה 2000', 'S', '〽️', 'ד"ר לוי'].each do |name|
      refute ContactFields.placeholder_name?(name), name
    end
  end

  def test_hebrew_csv_headers_go_to_the_fields_the_import_reads
    row = { 'שם פרטי' => 'תמי', 'שם משפחה' => 'לוין', 'טלפון נייד' => '050-123-4567', 'אימייל' => 'Tami@Example.com',
            'חברה' => 'לוין בע"מ', 'עיר' => 'חיפה', 'מספר פוליסה' => '778', 'identifier' => 'x1' }
    params = ContactFields.import_params(row)
    assert_equal 'תמי לוין', params[:name]
    assert_equal '+972501234567', params[:phone_number]
    assert_equal 'tami@example.com', params[:email]
    assert_equal 'לוין בע"מ', params[:company_name]
    assert_equal 'חיפה', params[:city]
    # columns that are not contact fields stay custom attributes, recognised ones do not repeat
    assert_equal '778', params['מספר פוליסה']
    assert_equal 'x1', params['identifier']
    refute params.key?('טלפון נייד')
    refute params.key?('שם פרטי')
  end

  def test_customer_word_in_headers_and_name_columns
    assert_equal({ name: 'אורי חכם', phone_number: '+972521112233' },
                 ContactFields.import_params('שם פרטי לקוח' => 'אורי', 'שם משפחה לקוח' => 'חכם', 'סלולרי לקוח' => '0521112233'))
    # "שם" holding the full name already, next to its family name
    assert_equal 'אורי חכם', ContactFields.import_params('שם' => 'אורי חכם', 'שם משפחה' => 'חכם')[:name]
    # a standard English export is left as Chatwoot reads it, the number made valid
    assert_equal({ name: 'Dana', phone_number: '+972501234567', email: 'd@x.io' },
                 ContactFields.import_params('name' => 'Dana', 'phone_number' => '0501234567', 'email' => 'd@x.io'))
  end

  def test_an_unparseable_number_is_kept_for_the_import_to_report
    assert_equal '050-123', ContactFields.import_params('טלפון' => '050-123')[:phone_number]
    refute ContactFields.import_params('טלפון' => '  ').key?(:phone_number)
  end

  def test_empty_fields_are_filled_from_custom_attributes
    found = ContactFields.missing(name: 'muddy-pine-495', phone_number: nil, email: '',
                                  custom_attributes: { 'טלפון' => '0501234567', 'מייל' => 'A@B.co', 'שם' => 'דנה', 'עסק' => 'מספרה' },
                                  additional_attributes: { 'city' => 'חיפה' })
    assert_equal({ phone_number: '+972501234567', email: 'a@b.co', name: 'דנה', company_name: 'מספרה' }, found)
  end

  def test_nothing_is_overwritten
    found = ContactFields.missing(name: 'דנה כהן', phone_number: '+972521112233', email: 'dana@x.io',
                                  custom_attributes: { 'טלפון' => '0501234567', 'email' => 'other@x.io', 'שם' => 'מישהי',
                                                       'company_name' => 'X' },
                                  additional_attributes: { company_name: 'Y' })
    assert_empty found
  end

  def test_a_name_that_is_only_a_number_fills_the_phone
    assert_equal({ phone_number: '+972501234567' },
                 ContactFields.missing(name: '+972 50-123-4567', phone_number: '', email: nil,
                                       custom_attributes: {}, additional_attributes: nil))
    # an invalid email or a LID-looking name fills nothing
    assert_empty ContactFields.missing(name: '123456789012345', phone_number: nil, email: nil,
                                       custom_attributes: { 'email' => 'not-an-email' }, additional_attributes: {})
  end

  def test_waha_identity_attributes_are_not_contact_fields
    assert_empty ContactFields.missing(name: 'Dana', phone_number: '+972501234567', email: nil,
                                       custom_attributes: { 'waha_whatsapp_jid' => '972501234567@s.whatsapp.net',
                                                            'waha_whatsapp_lid' => '1@lid', 'lead_name' => 'x' },
                                       additional_attributes: {})
  end
end
