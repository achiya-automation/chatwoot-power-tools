# frozen_string_literal: true

require 'minitest/autorun'

class Hash
  def deep_dup
    each_with_object({}) { |(key, value), copy| copy[key] = value.is_a?(Hash) ? value.deep_dup : value }
  end
end

module Rails
  class Logger
    attr_reader :infos, :errors

    def initialize
      @infos = []
      @errors = []
    end

    def info(message)
      @infos << message
    end

    def error(message)
      @errors << message
    end
  end

  class Config
    attr_reader :initializer

    def after_initialize(&block)
      @initializer = block
    end
  end

  class App
    def config
      @config ||= Config.new
    end
  end

  def self.application
    @application ||= App.new
  end

  def self.logger
    @logger ||= Logger.new
  end
end

class FakeAccount
  attr_reader :saved

  def initialize(enabled:)
    @enabled = enabled
    @saved = false
  end

  def feature_enabled?(feature)
    feature == :whatsapp_campaign && @enabled
  end

  def enable_features(feature)
    raise 'unexpected feature' unless feature == :whatsapp_campaign

    @enabled = true
  end

  def save(validate:)
    raise 'validation must remain disabled' unless validate == false

    @saved = true
  end
end

class Account
  class << self
    attr_accessor :records, :failure

    def find_each
      raise failure if failure

      records.each { |record| yield record }
    end
  end
end

class FakeInstallationConfig
  attr_reader :value, :updated_value

  def initialize(value)
    @value = value
  end

  def update!(value:)
    @updated_value = value
  end
end

class InstallationConfig
  class << self
    attr_accessor :record

    def find_by(name:)
      raise 'wrong config name' unless name == 'ACCOUNT_LEVEL_FEATURE_DEFAULTS'

      record
    end
  end
end

load File.expand_path('../whatsapp_campaign_feature_flag.rb', __dir__)

class WhatsappCampaignFeatureFlagTest < Minitest::Test
  def setup
    Account.failure = nil
    Rails.logger.infos.clear
    Rails.logger.errors.clear
  end

  def run_initializer
    Rails.application.config.initializer.call
  end

  def test_enables_existing_accounts_and_future_account_default
    disabled = FakeAccount.new(enabled: false)
    enabled = FakeAccount.new(enabled: true)
    Account.records = [disabled, enabled]
    InstallationConfig.record = FakeInstallationConfig.new([{ 'name' => 'whatsapp_campaign', 'enabled' => false }])

    run_initializer

    assert disabled.feature_enabled?(:whatsapp_campaign)
    assert disabled.saved
    refute enabled.saved
    assert_equal true, InstallationConfig.record.updated_value.first['enabled']
    assert_match(/newly enabled accounts: 1/, Rails.logger.infos.last)
  end

  def test_adds_missing_future_account_default
    Account.records = []
    InstallationConfig.record = FakeInstallationConfig.new([{ 'name' => 'crm_v2', 'enabled' => false }])

    run_initializer

    campaign = InstallationConfig.record.updated_value.find { |feature| feature['name'] == 'whatsapp_campaign' }
    assert_equal({ 'name' => 'whatsapp_campaign', 'enabled' => true }, campaign)
  end

  def test_logs_only_exception_class
    Account.records = []
    Account.failure = RuntimeError.new('postgres://sensitive-value')
    InstallationConfig.record = nil

    run_initializer

    assert_equal ['[CUSTOM] WhatsApp campaign feature setup failed (RuntimeError)'], Rails.logger.errors
    refute_includes Rails.logger.errors.join, 'sensitive-value'
  end
end
