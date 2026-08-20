# Custom initializer: WhatsApp Flow replies (nfm_reply) — preserve the answers.
#
# Upstream v4.16 message_content() maps button_reply/list_reply to their titles
# but returns nil for interactive type nfm_reply, so a completed WhatsApp Flow
# (form) lands in the inbox as an EMPTY message: the owner sees a blank bubble,
# and any agent-bot webhook downstream drops it (no content to forward). This is
# how customers of עונים לי submitted the details form and "nothing happened"
# (verified against production rows, 2026-08-09: message_type=0, content NULL,
# no attachments, right after the bot opened the Flow).
#
# The patch flattens the reply to a marked, machine-parsable line:
#     📋 טופס: {"business_name":"...","greeting":"..."}
# The marker keeps it recognizable to bots (and honest to humans — the raw
# answers are exactly what the customer typed); response_json is compact
# single-line JSON straight from Meta. flow_token is stripped: it is routing
# metadata, not an answer, and must not leak into the visible thread.
#
# Spoofing note: a customer typing the marker themselves gains nothing — the
# form's fields are their own account details, writable by the same sender via
# the ordinary settings commands anyway.
#
# Mounted read-only via docker-compose into rails + sidekiq (survives image
# updates). Created: 2026-08-09 for Chatwoot v4.16.2.

module WhatsappFlowReplyContent
  MARKER = '📋 טופס: '.freeze

  def message_content(message)
    upstream = super
    return upstream if upstream.present?

    raw = message.dig(:interactive, :nfm_reply, :response_json)
    return upstream if raw.blank?

    begin
      answers = JSON.parse(raw)
      answers.delete('flow_token')
      MARKER + answers.to_json
    rescue JSON::ParserError
      # Unparsable payload still beats a silent empty bubble.
      MARKER + raw
    end
  end
end

Rails.application.config.to_prepare do
  helpers = Whatsapp::IncomingMessageServiceHelpers
  ok = helpers.instance_method(:message_content).arity == 1 rescue false

  if ok && !helpers.include?(WhatsappFlowReplyContent)
    helpers.prepend(WhatsappFlowReplyContent)
    Rails.logger.info '[flow-reply] nfm_reply content patch active'
  elsif !ok
    Rails.logger.error '[flow-reply] NOT applied — upstream message_content changed; flow replies stay empty'
  end
end
