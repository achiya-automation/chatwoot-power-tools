# frozen_string_literal: true

# Chatwoot logs the complete webhook URL when delivery fails. AgentBot URLs can
# carry authentication in their query string because Chatwoot does not support
# custom headers there, so a timeout would otherwise copy the secret into the
# Rails and Sidekiq logs.

require 'uri'

module CwptWebhookUrlRedaction
  def handle_failure(error)
    original_url = @url
    redacted_url = cwpt_redacted_url(original_url)
    @url = redacted_url

    super(cwpt_redacted_error(error, original_url, redacted_url))
  ensure
    @url = original_url
  end

  private

  def cwpt_redacted_url(url)
    uri = URI.parse(url.to_s)
    uri.user = nil
    uri.password = nil
    uri.query = nil
    uri.fragment = nil
    uri.to_s
  rescue URI::InvalidURIError
    '[FILTERED]'
  end

  def cwpt_redacted_error(error, original_url, redacted_url)
    original = original_url.to_s
    return error if original.empty? || !error.message.to_s.include?(original)

    sanitized = error.exception(error.message.to_s.gsub(original, redacted_url))
    sanitized.set_backtrace(error.backtrace)
    sanitized
  end
end

Rails.application.config.to_prepare do
  Webhooks::Trigger.prepend(CwptWebhookUrlRedaction) unless Webhooks::Trigger.ancestors.include?(CwptWebhookUrlRedaction)
end
