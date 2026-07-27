# Custom initializer: WhatsApp campaign enhancements
# 1. Records a conversation + message in Chatwoot for every campaign send
#    (upstream sends the template via Meta API but records nothing in the inbox)
# 2. Preserves upstream Liquid personalization per contact:
#    {{contact.first_name}}, {{contact.name}}, {{contact.email}},
#    {{contact.phone_number}}, {{contact.custom_attribute.<key>}},
#    {{agent.name}} etc. — resolved by Whatsapp::LiquidTemplateProcessorService
# 3. CAROUSEL template support: upstream v4.14 builds only header/body/footer/
#    buttons components, so Meta rejects carousel templates with error #132012
#    ("header component parameter should not be empty"). We append the carousel
#    component built from the synced template definition itself: each card gets
#    its header media + a payload per quick-reply button. Card media: the
#    template's example handle is downloaded and re-uploaded to the WhatsApp
#    Media API (Meta's fetcher 403s on its own scontent links — error 131053),
#    and the media id is cached in Redis for 25 days.
# 4. Durable send ledger (drip.campaign_audience_snapshots / campaign_send_snapshots):
#    one immutable row per recipient — including the ones upstream silently drops
#    (no phone, no template params, blank Liquid, Meta rejection). Without it a
#    campaign report has to infer "was this sent?" from content_attributes.campaign_id
#    on the outgoing message, which the panel's own retry button wipes
#    (messages_controller#retry does `update!(content_attributes: {})`), and which
#    never exists at all for a recipient the send never reached.
#
# Mounted read-only via docker-compose into rails + sidekiq (survives image updates).
# Created: 2026-02-18 | Rewritten: 2026-06-10 for Chatwoot v4.14.1
#   The original version was written against an older Chatwoot: it bypassed the
#   (then nonexistent) Liquid processing AND called send_whatsapp_template_message
#   without the template_params: keyword, which raises ArgumentError on v4.14.1
#   and broke campaign sends entirely. This version overrides process_contact +
#   send_whatsapp_template_message (same signature, carousel-aware), reuses
#   upstream Liquid + send logic, and records the *rendered* per-contact text.
#
# Update safety: the guard below verifies the upstream methods + signature
# before patching. If a future Chatwoot version changes them, the patch is NOT
# applied — upstream campaign sending keeps working, only the local extras
# (conversation recording, carousel) are skipped — and a loud error is logged.

# Error sink handed to Chatwoot's send_template in place of the `message` argument.
# Upstream passes nil, so Meta's rejection reason is written to the log and lost. A real
# Message can't be used either: Base::SendOnChannelService skips a send only when
# source_id is already present, so an unsent Message record would be delivered a second
# time by SendReplyJob. This object satisfies the three calls handle_error makes
# (blank? / external_error= / status= / save!) and nothing else.
class WhatsappCampaignErrorSink
  attr_accessor :external_error, :status

  def blank?
    false
  end

  def save!
    true
  end
end

Rails.application.config.after_initialize do
  Rails.logger.info '[CUSTOM] Loading WhatsApp campaign conversation patch...'

  begin
    svc = Whatsapp::OneoffCampaignService

    expected_send_signature = [%i[keyreq to], %i[keyreq template_params]]
    problems = []

    %i[process_audience process_contact process_liquid_template_params send_whatsapp_template_message].each do |meth|
      problems << "missing method ##{meth}" unless svc.private_method_defined?(meth) || svc.method_defined?(meth)
    end

    if problems.empty? && svc.instance_method(:send_whatsapp_template_message).parameters != expected_send_signature
      problems << "#send_whatsapp_template_message signature changed to #{svc.instance_method(:send_whatsapp_template_message).parameters.inspect}"
    end

    if problems.any?
      Rails.logger.error "[CUSTOM] WhatsApp campaign patch NOT applied (upstream changed): #{problems.join('; ')}"
      Rails.logger.error '[CUSTOM] Campaign sends keep working natively, but conversations/messages and the ' \
                         'send ledger will not be recorded — campaign reports go blind. ' \
                         'Review /opt/chatwoot/custom-initializers/whatsapp_campaign_conversations.rb against the new Chatwoot version!'
    else
      # Ledger status codes used below. 0..3 mirror Message#status
      # (sent / delivered / read / failed); 4 is local and means "no send was
      # attempted at all" — the reason is carried in error_title.
      svc.class_eval do
        private

        # Same as upstream, plus the audience snapshot. Label membership drifts after a
        # send (contacts get re-tagged, imported twins appear), so a report that resolves
        # the audience from the label at read time reports a different campaign than the
        # one that ran. Capture it once, before the first send.
        def process_audience(audience_labels)
          contacts = campaign.account.contacts.tagged_with(audience_labels, any: true)
          Rails.logger.info "Processing #{contacts.count} contacts for campaign #{campaign.id}"

          capture_campaign_audience(contacts)
          contacts.each { |contact| process_contact(contact) }

          Rails.logger.info "Campaign #{campaign.id} processing completed"
        end

        # Same flow as upstream v4.14.1 #process_contact (including Liquid), plus
        # conversation/message recording after a successful send and a ledger row for
        # every outcome — upstream returns silently on each skip, which is exactly how
        # a recipient disappears from the report with no reason attached.
        def process_contact(contact)
          Rails.logger.info "Processing contact: #{contact.name} (#{contact.phone_number})"

          if contact.phone_number.blank?
            Rails.logger.info "Skipping contact #{contact.name} - no phone number"
            return record_campaign_send(contact, status: 4, error: 'no_phone')
          end

          if campaign.template_params.blank?
            Rails.logger.error "Skipping contact #{contact.name} - no template_params found for WhatsApp campaign"
            return record_campaign_send(contact, status: 4, error: 'no_template_params')
          end

          processed_template_params = process_liquid_template_params(contact)
          if processed_template_params.nil?
            return record_campaign_send(contact, status: 4, error: 'liquid_blank')
          end

          error_sink = WhatsappCampaignErrorSink.new
          whatsapp_message_id = send_whatsapp_template_message(
            to: contact.phone_number, template_params: processed_template_params, error_sink: error_sink
          )

          if whatsapp_message_id.present?
            message = create_campaign_conversation_and_message(contact, whatsapp_message_id, processed_template_params)
            record_campaign_send(contact, status: 0, source_id: whatsapp_message_id,
                                          message_id: message&.id, conversation_id: message&.conversation_id)
          else
            Rails.logger.error "Campaign #{campaign.id}: Send failed for #{contact.phone_number}"
            record_campaign_send(contact, status: 3,
                                          error: error_sink.external_error.presence || 'send_failed')
          end
        end

        # Same as upstream v4.14.1, plus append_carousel_component before send and the
        # error sink in place of upstream's nil (see WhatsappCampaignErrorSink).
        def send_whatsapp_template_message(to:, template_params:, error_sink: nil)
          processor = Whatsapp::TemplateProcessorService.new(
            channel: channel,
            template_params: template_params
          )

          name, namespace, lang_code, processed_parameters = processor.call

          if name.blank?
            error_sink&.external_error = 'template_not_found'
            return
          end

          processed_parameters = append_carousel_component(name, lang_code, processed_parameters)

          channel.send_template(to, {
                                  name: name,
                                  namespace: namespace,
                                  lang_code: lang_code,
                                  parameters: processed_parameters
                                }, error_sink)
        rescue StandardError => e
          Rails.logger.error "Failed to send WhatsApp template message to #{to}: #{e.message}"
          Rails.logger.error "Backtrace: #{e.backtrace.first(5).join('\n')}"
          error_sink&.external_error = e.message.to_s.first(200)
          nil
        end

        def append_carousel_component(template_name, lang_code, parameters)
          parameters ||= []
          template = channel.message_templates&.find do |t|
            t['name'] == template_name && t['language'].to_s.casecmp?(lang_code.to_s)
          end
          carousel = template&.dig('components')&.find { |c| c['type'] == 'CAROUSEL' }
          return parameters if carousel.blank?

          cards = (carousel['cards'] || []).each_with_index.map do |card, card_index|
            { card_index: card_index, components: carousel_card_components(card) }
          end

          parameters + [{ type: 'carousel', cards: cards }]
        end

        def carousel_card_components(card)
          components = []
          card_components = card['components'] || []

          header = card_components.find { |c| c['type'] == 'HEADER' }
          handle = header&.dig('example', 'header_handle', 0)
          if handle.present?
            media_type = (header['format'] || 'IMAGE').downcase
            media_id = carousel_media_id(handle, media_type)
            media_ref = media_id.present? ? { id: media_id } : { link: handle }
            components << {
              type: 'header',
              parameters: [{ type: media_type, media_type.to_sym => media_ref }]
            }
          end

          buttons = card_components.find { |c| c['type'] == 'BUTTONS' }
          ((buttons && buttons['buttons']) || []).each_with_index do |button, button_index|
            # Static URL buttons need no parameters; quick replies require a payload
            next unless button['type'] == 'QUICK_REPLY'

            components << {
              type: 'button',
              sub_type: 'quick_reply',
              index: button_index.to_s,
              parameters: [{ type: 'payload', payload: button['text'].to_s.first(128) }]
            }
          end

          components
        end

        # Meta's own fetcher gets 403 on scontent.whatsapp.net example handles
        # (webhook error 131053), although the URL is publicly downloadable.
        # So we download the image ourselves and upload it once to the WhatsApp
        # Media API, then send cards with the media id. The id is cached in
        # Redis for 25 days (Meta keeps uploaded media 30 days). The cache key
        # uses the stable file name, so template re-syncs (which rotate the
        # signed query string) keep hitting the same cached media id.
        def carousel_media_id(handle_url, media_type)
          stable_name = URI.parse(handle_url).path.split('/').last
          cache_key = "custom:wa_carousel_media:#{channel.id}:#{stable_name}"
          cached = Redis::Alfred.get(cache_key)
          return cached if cached.present?

          media_id = upload_carousel_media(handle_url, media_type)
          Redis::Alfred.setex(cache_key, media_id, 25.days) if media_id.present?
          media_id
        rescue StandardError => e
          Rails.logger.error "Carousel media upload failed for #{handle_url}: #{e.message}"
          nil
        end

        def upload_carousel_media(handle_url, media_type)
          download = HTTParty.get(handle_url, timeout: 30)
          unless download.success?
            Rails.logger.error "Carousel media download failed (#{download.code}) for #{handle_url}"
            return nil
          end

          content_type = media_type == 'video' ? 'video/mp4' : 'image/jpeg'
          filename = stable_log_name(handle_url)
          filename = "carousel#{media_type == 'video' ? '.mp4' : '.jpg'}" if filename.blank?

          # Hand-built multipart: HTTParty's multipart support drops the file
          # part here ("(#100) The parameter file is required" from Meta).
          boundary = "----ChatwootCarousel#{SecureRandom.hex(12)}"
          body = +''.b
          body << "--#{boundary}\r\n".b
          body << "Content-Disposition: form-data; name=\"messaging_product\"\r\n\r\nwhatsapp\r\n".b
          body << "--#{boundary}\r\n".b
          body << "Content-Disposition: form-data; name=\"type\"\r\n\r\n#{content_type}\r\n".b
          body << "--#{boundary}\r\n".b
          body << "Content-Disposition: form-data; name=\"file\"; filename=\"#{filename}\"\r\n".b
          body << "Content-Type: #{content_type}\r\n\r\n".b
          body << download.body.to_s.b
          body << "\r\n--#{boundary}--\r\n".b

          api_base = ENV.fetch('WHATSAPP_CLOUD_BASE_URL', 'https://graph.facebook.com')
          response = HTTParty.post(
            "#{api_base}/v13.0/#{channel.provider_config['phone_number_id']}/media",
            headers: {
              'Authorization' => "Bearer #{channel.provider_config['api_key']}",
              'Content-Type' => "multipart/form-data; boundary=#{boundary}"
            },
            body: body
          )

          if response.success? && response.parsed_response['id'].present?
            media_id = response.parsed_response['id']
            Rails.logger.info "Carousel media uploaded: #{media_id} (#{filename})"
            media_id
          else
            Rails.logger.error "Carousel media upload rejected: #{response.body}"
            nil
          end
        end

        def stable_log_name(url)
          URI.parse(url).path.split('/').last
        rescue StandardError
          url.to_s.first(60)
        end

        # ── Durable send ledger ──────────────────────────────────────────────
        # Written by Rails (the only place that sees every outcome) and read by the
        # campaign report. Best-effort by design: an installation without the drip
        # schema, or a revoked grant, must never break an actual send — the write is
        # logged and skipped.

        def campaign_ledger_exec(sql)
          ActiveRecord::Base.connection.exec_query(sql, 'campaign-ledger')
          true
        rescue StandardError => e
          Rails.logger.warn "[CUSTOM] Campaign ledger write skipped: #{e.class}: #{e.message}"
          false
        end

        def capture_campaign_audience(contacts)
          values = contacts.map do |c|
            ActiveRecord::Base.sanitize_sql_array(
              ['(?, ?, ?, ?, ?)', campaign.account_id, campaign.id, c.id, c.name.to_s, c.phone_number.to_s]
            )
          end
          return if values.empty?

          # ON CONFLICT DO NOTHING keeps a re-run (retriggered campaign) from rewriting
          # the original capture — the first snapshot is the historical truth.
          values.each_slice(500) do |slice|
            campaign_ledger_exec(<<~SQL.squish)
              INSERT INTO drip.campaign_audience_snapshots
                (account_id, campaign_id, contact_id, contact_name, phone)
              VALUES #{slice.join(', ')}
              ON CONFLICT (account_id, campaign_id, contact_id) DO NOTHING
            SQL
          end
        end

        def record_campaign_send(contact, status:, source_id: nil, error: nil, message_id: nil, conversation_id: nil)
          # source_id is part of the primary key, but a skip/rejection has no Meta id —
          # a per-contact synthetic key keeps one row per recipient and makes a re-run
          # update that row instead of appending a duplicate.
          key = source_id.presence || "skip:#{campaign.id}:#{contact.id}"
          template = <<~SQL.squish
            INSERT INTO drip.campaign_send_snapshots
              (account_id, campaign_id, contact_id, contact_name, phone, source_id,
               conversation_id, message_id, status, error_title)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (account_id, campaign_id, source_id) DO UPDATE
              SET status = EXCLUDED.status,
                  error_title = EXCLUDED.error_title,
                  conversation_id = COALESCE(EXCLUDED.conversation_id, drip.campaign_send_snapshots.conversation_id),
                  message_id = COALESCE(EXCLUDED.message_id, drip.campaign_send_snapshots.message_id),
                  status_updated_at = now()
          SQL
          campaign_ledger_exec(ActiveRecord::Base.sanitize_sql_array(
                                 [template, campaign.account_id, campaign.id, contact.id, contact.name.to_s,
                                  contact.phone_number.to_s, key, conversation_id, message_id, status, error]
                               ))
          nil
        end

        # Returns the recorded Message (nil if anything went wrong) so the caller can
        # link the ledger row to the conversation.
        def create_campaign_conversation_and_message(contact, whatsapp_message_id, template_params)
          phone_number = contact.phone_number.to_s.delete_prefix('+')

          contact_inbox = ::ContactInboxWithContactBuilder.new(
            source_id: phone_number,
            inbox: inbox,
            contact_attributes: {
              'name' => contact.name,
              'phone_number' => contact.phone_number
            }
          ).perform

          return unless contact_inbox

          conversation = contact_inbox.conversations.where.not(status: :resolved).last
          unless conversation
            conversation = ::Conversation.create(
              account_id: campaign.account_id,
              inbox_id: inbox.id,
              contact_id: contact_inbox.contact_id,
              contact_inbox_id: contact_inbox.id,
              campaign_id: campaign.id
            )
            unless conversation.persisted?
              Rails.logger.error "Campaign #{campaign.id}: Failed to create conversation: #{conversation.errors.full_messages.join(', ')}"
              return
            end
          end

          template_text = build_template_text(template_params)
          sender = campaign.sender || campaign.account.users.first

          message = conversation.messages.create(
            account_id: campaign.account_id,
            inbox_id: inbox.id,
            message_type: :outgoing,
            content: template_text,
            source_id: whatsapp_message_id.to_s,
            sender: sender,
            status: :sent,
            content_attributes: { 'campaign_id' => campaign.id }
          )

          if message.persisted?
            Rails.logger.info "Campaign #{campaign.id}: Created message #{message.id} in conversation #{conversation.id} for #{contact.phone_number}"
            message
          else
            Rails.logger.error "Campaign #{campaign.id}: Failed to create message: #{message.errors.full_messages.join(', ')}"
            nil
          end
        rescue StandardError => e
          Rails.logger.error "Campaign #{campaign.id}: Conversation creation failed for #{contact.phone_number}: #{e.message}"
          Rails.logger.error e.backtrace.first(5).join("\n")
          nil
        end

        # Renders the template body using the per-contact (Liquid-resolved)
        # params, so the recorded message shows the real values sent.
        def build_template_text(template_params)
          template_name = template_params['name']
          template = channel.message_templates&.find { |t| t['name'] == template_name }

          body_component = template&.dig('components')&.find { |c| c['type'] == 'BODY' }
          text = body_component&.dig('text') || campaign.message

          body_params = template_params.dig('processed_params', 'body') || {}
          body_params.each do |key, value|
            text = text.gsub("{{#{key}}}", value.to_s)
          end

          text
        end
      end

      Rails.logger.info '[CUSTOM] WhatsApp campaign conversation patch loaded successfully (v4.14.1 Liquid-aware)'
    end
  rescue StandardError => e
    Rails.logger.error "[CUSTOM] WhatsApp campaign patch failed to load: #{e.class}: #{e.message}"
  end
end
