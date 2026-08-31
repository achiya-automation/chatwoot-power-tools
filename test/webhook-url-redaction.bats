#!/usr/bin/env bats

@test "webhook failures never log query credentials or URL userinfo" {
  initializer="$BATS_TEST_DIRNAME/../modules/sequences/deploy/chatwoot-initializers/webhook_url_redaction.rb"

  run ruby - "$initializer" <<'RUBY'
class TestRailsConfig
  def to_prepare(&block)
    block.call
  end
end

module Rails
  class TestLogger
    attr_reader :warnings

    def initialize
      @warnings = []
    end

    def warn(message)
      @warnings << message
    end
  end

  def self.application
    Struct.new(:config).new(TestRailsConfig.new)
  end

  def self.logger
    @logger ||= TestLogger.new
  end
end

module Webhooks
  class Trigger
    attr_reader :handled_error

    def initialize(url)
      @url = url
    end

    def handle_failure(error)
      @handled_error = error
      Rails.logger.warn "Exception: Invalid webhook URL #{@url} : #{error.message}"
    end

    def current_url
      @url
    end
  end
end

load ARGV.fetch(0)

secret_url = 'https://api-user:api-password@example.com/hook?t=secret-token&key=another-secret#fragment'
error = StandardError.new("delivery failed for #{secret_url}")
trigger = Webhooks::Trigger.new(secret_url)
trigger.handle_failure(error)

warning = Rails.logger.warnings.fetch(0)
raise 'query token leaked' if warning.include?('secret-token')
raise 'second query secret leaked' if warning.include?('another-secret')
raise 'URL username leaked' if warning.include?('api-user')
raise 'URL password leaked' if warning.include?('api-password')
raise 'safe endpoint was lost' unless warning.include?('https://example.com/hook')
raise 'error message still contains the secret URL' if trigger.handled_error.message.include?('secret-token')
raise 'trigger URL was not restored' unless trigger.current_url == secret_url

malformed = Webhooks::Trigger.new('not a valid URL ?t=secret-token')
malformed.handle_failure(StandardError.new('failed'))
raise 'malformed URL was not fully redacted' unless Rails.logger.warnings.last.include?('[FILTERED]')
raise 'malformed URL secret leaked' if Rails.logger.warnings.last.include?('secret-token')

Webhooks::Trigger.prepend(CwptWebhookUrlRedaction)
raise 'initializer was prepended more than once' unless Webhooks::Trigger.ancestors.count(CwptWebhookUrlRedaction) == 1
RUBY

  [ "$status" -eq 0 ]
}
