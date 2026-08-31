# frozen_string_literal: true

require 'minitest/autorun'

class TestLogger
  attr_reader :warnings

  def initialize
    @warnings = []
  end

  def warn(message)
    @warnings << message
  end
end

module Webhooks
  class Trigger; end
end

module Whatsapp
  class IncomingMessageBaseService
    def log_error(message)
      Rails.logger.warn("unsafe #{message['from']} #{message.dig('errors', 0, 'title')}")
    end
  end
end

module Rails
  class TestConfig
    def to_prepare(&block)
      block.call
    end
  end

  class TestApplication
    def config
      @config ||= TestConfig.new
    end
  end

  class << self
    def application
      @application ||= TestApplication.new
    end

    def logger
      @logger ||= TestLogger.new
    end
  end
end

require_relative '../webhook_url_redaction'

class WebhookUrlRedactionTest < Minitest::Test
  def setup
    Rails.logger.warnings.clear
  end

  def test_whatsapp_error_log_excludes_sender_and_provider_title
    message = {
      'from' => '972500000000',
      'type' => 'unsupported',
      'errors' => [{ 'code' => 13_1051, 'title' => 'sensitive provider detail' }]
    }

    Whatsapp::IncomingMessageBaseService.new.log_error(message)

    assert_equal ['Whatsapp Error: code=131051 type=unsupported'], Rails.logger.warnings
    refute_includes Rails.logger.warnings.join, message['from']
    refute_includes Rails.logger.warnings.join, 'sensitive provider detail'
  end

  def test_whatsapp_error_log_handles_missing_fields_without_payload_dump
    Whatsapp::IncomingMessageBaseService.new.log_error({})

    assert_equal ['Whatsapp Error: code=unknown type=unknown'], Rails.logger.warnings
  end
end
