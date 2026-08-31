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

# Chatwoot's native WhatsApp error logger includes the sender's full phone number and the
# provider's free-form title.  Both are unnecessary for operations and can turn retained
# logs into a copy of customer data (or of a provider message that embeds request details).
# Keep only the bounded error code and message type.
module CwptWhatsappErrorLogRedaction
  def log_error(message)
    error = Array(message['errors']).first.to_h
    code = error['code'].to_s
    code = 'unknown' if code.empty?
    message_type = message['type'].to_s
    message_type = 'unknown' if message_type.empty?
    Rails.logger.warn("Whatsapp Error: code=#{code} type=#{message_type}")
  end
end

Rails.application.config.to_prepare do
  Webhooks::Trigger.prepend(CwptWebhookUrlRedaction) unless Webhooks::Trigger.ancestors.include?(CwptWebhookUrlRedaction)

  next unless defined?(Whatsapp::IncomingMessageBaseService)

  service = Whatsapp::IncomingMessageBaseService
  service.prepend(CwptWhatsappErrorLogRedaction) unless service.ancestors.include?(CwptWhatsappErrorLogRedaction)
end
