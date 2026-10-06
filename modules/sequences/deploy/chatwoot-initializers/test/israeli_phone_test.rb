# frozen_string_literal: true

require 'minitest/autorun'

# Load the initializer without Rails: only the plain IsraeliPhone helpers are
# exercised here; the to_prepare block (model and controller wiring) is skipped.
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

class IsraeliPhoneTest < Minitest::Test
  def test_drops_the_trunk_zero_typed_after_the_country_code
    assert_equal '+972501234567', IsraeliPhone.drop_trunk_zero('+9720501234567')
    assert_equal '+97231234567', IsraeliPhone.drop_trunk_zero('+972031234567')
  end

  def test_leaves_every_other_number_alone
    ['+972501234567', '+97231234567', '+14155550100', '+447700900123', '+97205012345678', '+9720', ''].each do |phone|
      assert_equal phone, IsraeliPhone.drop_trunk_zero(phone)
    end
    assert_nil IsraeliPhone.drop_trunk_zero(nil)
  end

  def test_a_local_number_search_matches_the_stored_international_number
    assert_equal '501234567', IsraeliPhone.search_term('0501234567')
    assert_equal '501234567', IsraeliPhone.search_term(' 050-123-4567 ')
    assert_equal '31234567', IsraeliPhone.search_term('03-1234567')
    assert_includes '+972501234567', IsraeliPhone.search_term('050 123 4567')
  end

  def test_other_searches_pass_through_unchanged
    ['dana', '501234567', '+972501234567', '0501', '1234', 'שירה 0501234567'].each do |query|
      assert_equal query, IsraeliPhone.search_term(query)
    end
    assert_nil IsraeliPhone.search_term(nil)
  end
end
