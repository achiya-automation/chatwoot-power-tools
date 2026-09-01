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

  # The gaps Chatwoot's own WhatsAppRenderer leaves, and NOTHING it already did.
  #
  # This was a full markdown->WhatsApp port, written when send_text_message got
  # raw markdown. Chatwoot later routed sends through
  # MessageContentPresenter#outgoing_content -> MarkdownRendererService#render_whatsapp,
  # which does that job -- so every send was converted TWICE, the second pass
  # re-reading the first pass's output as markdown:
  #
  #   "**bold**"   -> render_whatsapp "*bold*"   -> here "_bold_"   (italic, not bold)
  #   "**61*x**5#" -> render_whatsapp "*61*x*5#" -> here "_61_x*5#" (not dialable)
  #
  # Bold reached every customer as italic from that upgrade until 1.9.2026. What
  # remains is only what WhatsAppRenderer genuinely does not emit: WhatsApp uses
  # single tildes for strikethrough, and asterisk bullets.
  def markdown_to_whatsapp(text)
    return '' if text.nil? || text.empty?

    text
      .gsub(/~~(.*?)~~/, '~\1~')
      .gsub(/^[-+] /, '* ')
      .gsub(/ +\n/, "\n") # drop hard-break spaces; WhatsApp keeps the \n anyway
  end

  # A dial code is markdown too: «**61*033825601**10#» is a **strong** span and
  # «*61*x*10#» an emphasis one, so a parser eats the very asterisks that make it
  # dialable -- in BOTH directions. The agent read a broken code in the thread,
  # and the customer received a different MMI service than the one intended
  # (3GPP TS 22.030). Backticks stop the parser; WhatsAppRenderer#code (patched
  # below) drops them again at the send boundary, so the agent sees the code
  # whole and the customer gets the bare characters.
  #
  # Every dial code is wrapped, not only the ones markdown would mangle: deciding
  # per match needs the Rails renderer (this file is checked standalone) and buys
  # nothing -- a needless wrap is invisible on the wire and merely renders the
  # code in monospace, which is what it is.
  DIAL_CODE = /(?<![`\w])[*#][\d*#]{2,}#/
  # an existing code span -- fenced block first, then inline -- so an
  # already-shielded code is never re-wrapped: a sender may shield its own codes,
  # and a second pass would match the asterisks INSIDE the span and produce
  # «`*`*61*x**10#``», a destroyed code.
  CODE_SPAN = /(```.*?```|`[^`\n]*`)/m

  def shield_dial_codes(text)
    text.split(CODE_SPAN).each_with_index.map do |segment, index|
      next segment if index.odd? # odd indexes are whole code spans: hands off

      segment.gsub(DIAL_CODE) { |code| "`#{code}`" }
    end.join
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

        # Shield dial codes so the stored body survives the markdown renderer the
        # dashboard displays it with. Safe before the send only on
        # Channel::Whatsapp, where render_whatsapp strips the backticks on the way
        # out; a Channel::Api (WAHA) body is delivered verbatim, so there we
        # shield only what will never be sent -- incoming, or an already
        # delivered message carrying a source_id.
        if inbox.channel_type == 'Channel::Whatsapp' || incoming? || source_id.present?
          self.content = WhatsappTextStyle.shield_dial_codes(content)
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

    # WhatsApp has no inline-code syntax, and upstream already drops the fences
    # for a fenced BLOCK (code_block -> string_content). Doing the same inline
    # turns a backtick into a display-only shield: the agent's thread renders the
    # code verbatim, the customer receives the bare characters.
    module WhatsAppRendererBareCodePatch
      def code(node)
        out(node.string_content)
      end
    end

    Messages::MarkdownRenderers::WhatsAppRenderer.prepend(WhatsAppRendererBareCodePatch)
  end
end
