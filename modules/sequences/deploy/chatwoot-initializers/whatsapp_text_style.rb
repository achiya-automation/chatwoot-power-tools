# frozen_string_literal: true
#
# WhatsApp <-> Chatwoot text-style parity.
#
# Chatwoot stores message bodies as markdown; WhatsApp has its own inline
# syntax. Without conversion each side shows the other's control characters
# literally:
#
#   incoming  *bold* from WhatsApp   -> rendered italic (markdown emphasis)
#   incoming  single line breaks     -> collapsed to spaces by strict-commonmark
#                                       renderers (the Chatwoot mobile app)
#   outgoing  **bold** / [t](url)    -> sent raw to the WhatsApp Cloud API, the
#                                       customer sees literal asterisks
#
# The WAHA bridge already converts both directions for its Channel::Api inboxes
# (apps/chatwoot/messages/to/{chatwoot,whatsapp}/markdown in the WAHA image).
# This initializer closes the remaining gaps and is a no-op on content the
# bridge already converted:
#
#   1. incoming text on WhatsApp/Api inboxes: WhatsApp markup -> markdown, and
#      soft newlines -> markdown hard breaks (two trailing spaces) so every
#      commonmark renderer preserves them
#   2. outgoing text: the same hard-break treatment, so multi-line replies keep
#      their line breaks in the mobile app too
#   3. Channel::Whatsapp (Cloud API) text sends: markdown -> WhatsApp syntax at
#      the send boundary (port of WAHA's MarkdownToWhatsApp, so both channel
#      types behave the same). Template messages are untouched - their text
#      must match the approved template.
#
# The regexes for incoming mirror WAHA's WhatsappToMarkdown (same boundary
# lookarounds), so double-processing a bridge-converted message changes nothing.

module WhatsappTextStyle
  WHATSAPP_CHANNELS = %w[Channel::Whatsapp Channel::Api].freeze

  URL_SEGMENT = %r{(https?://\S+)}
  WA_BOLD     = /(?<![\p{L}\p{N}_*])\*(?!\*)(?=\S)(.+?)(?<=\S)\*(?![\p{L}\p{N}_*])/
  WA_STRIKE   = /(?<![\p{L}\p{N}_~])~(?!~)(?=\S)(.+?)(?<=\S)~(?![\p{L}\p{N}_~])/
  # a lone \n that is not a paragraph break, not an existing hard break
  # (backslash or two-space form) and not preceded by another \n
  SOFT_BREAK  = /(?<!\n)(?<!\\)(?<!  )\n(?!\n)/

  module_function

  # WhatsApp inline markup -> markdown (incoming). URL segments are left as-is
  # so asterisks/tildes inside links never get mangled.
  def whatsapp_to_markdown(text)
    text.split(URL_SEGMENT).each_with_index.map do |segment, index|
      next segment if index.odd? # odd indexes are the captured URLs

      segment.gsub(WA_BOLD) { "**#{Regexp.last_match(1)}**" }
             .gsub(WA_STRIKE) { "~~#{Regexp.last_match(1)}~~" }
    end.join
  end

  # Make every soft newline a markdown hard break so strict commonmark
  # renderers (mobile app) keep the line break instead of joining lines.
  def hard_breaks(text)
    text.gsub(SOFT_BREAK, "  \n")
  end

  # Chatwoot markdown -> WhatsApp syntax (outgoing via Cloud API). Port of
  # WAHA's MarkdownToWhatsApp so official and bridge inboxes look the same.
  def markdown_to_whatsapp(text)
    return '' if text.nil? || text.empty?

    text
      .gsub(/\\\n/, "\n")
      .gsub(/(?<!\*)\*(?!\*)(.*?)\*(?!\*)|(?<!_)_(?!_)(.*?)_(?!_)/) do
        "_#{Regexp.last_match(1) || Regexp.last_match(2)}_"
      end
      .gsub(/\*\*(.*?)\*\*/, '*\1*')
      .gsub(/~~(.*?)~~/, '~\1~')
      .gsub(%r{\[([^\]]+)\]\((https?://[^\s)]+)\)}, '\1 (\2)')
      .gsub(/^[-+*] /, '* ')
      .gsub(/ +\n/, "\n") # drop hard-break spaces; WhatsApp keeps the \n anyway
  end
end

if defined?(Rails)
  Rails.application.config.to_prepare do
    Message.class_eval do
      before_create :cwpt_apply_whatsapp_text_style

      private

      def cwpt_apply_whatsapp_text_style
        return unless content_type == 'text' && content.present?
        return unless inbox && WhatsappTextStyle::WHATSAPP_CHANNELS.include?(inbox.channel_type)

        if incoming? || (outgoing? && source_id.present?)
          # WhatsApp-origin text (incoming, or fromMe synced by the bridge with
          # a source_id at create time): real WhatsApp markup -> markdown
          self.content = WhatsappTextStyle.hard_breaks(WhatsappTextStyle.whatsapp_to_markdown(content))
        elsif outgoing?
          # dashboard/API-composed text is already markdown - only keep breaks
          self.content = WhatsappTextStyle.hard_breaks(content)
        end
      end
    end

    # Convert markdown at the Cloud API send boundary. Interactive payloads and
    # templates keep their original body on purpose.
    module WhatsappCloudTextStylePatch
      def send_text_message(phone_number, message)
        response = HTTParty.post(
          "#{phone_id_path}/messages",
          headers: api_headers,
          body: {
            messaging_product: 'whatsapp',
            context: whatsapp_reply_context(message),
            **recipient_params(phone_number),
            text: { body: WhatsappTextStyle.markdown_to_whatsapp(message.outgoing_content) },
            type: 'text'
          }.to_json
        )

        process_response(response, message)
      end
    end

    Whatsapp::Providers::WhatsappCloudService.prepend(WhatsappCloudTextStylePatch)
  end
end
