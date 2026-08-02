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
# 4. Captures the exact audience before processing and stamps the original contact identity on
#    every recorded message. Imported contacts can otherwise be represented by a second,
#    channel-bound Contact record with an automatic name and no phone, corrupting CSV reports.
# 5. Records a ledger row for EVERY recipient, including the ones upstream drops in silence:
#    no phone, no template params, blank Liquid, or a send Meta rejected. Without them a
#    recipient simply vanishes from the report with no reason attached — that is how 39
#    phone-less contacts sat in a campaign audience and received nothing, unnoticed.
# 6. Applies the optional campaign assignee from trigger_rules. The WhatsApp campaign form
#    stores { assignee: { type: 'User'|'AgentBot', id: N } }; every created/reused conversation
#    is assigned before its outgoing campaign message is recorded.
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

# Delivery webhooks can update or replace Chatwoot's presentation message. Keep the durable
# attempt row in sync by Meta source id so reports do not lose a final status with the UI row.
module WhatsappCampaignStatusSnapshotWriter
  def self.record(message)
    return if message.source_id.blank?

    connection = ActiveRecord::Base.connection
    status = message.status_before_type_cast.to_i
    error = status == 3 ? message.external_error : nil
    connection.execute(<<~SQL.squish)
      UPDATE drip.campaign_send_snapshots
         SET message_id = #{message.id.to_i},
             conversation_id = #{message.conversation_id.to_i},
             status = CASE
               WHEN status = 3 OR #{status} = 3 THEN 3
               ELSE GREATEST(status, #{status})
             END,
             error_title = CASE
               WHEN #{status} = 3 THEN #{connection.quote(error)}
               ELSE error_title
             END,
             status_updated_at = CURRENT_TIMESTAMP
       WHERE account_id = #{message.account_id.to_i}
         AND source_id = #{connection.quote(message.source_id.to_s)}
    SQL
  rescue StandardError => e
    Rails.logger.error "Campaign delivery snapshot update failed: #{e.class}: #{e.message}"
  end
end

module WhatsappCampaignIncomingStatusPatch
  private

  def update_message_with_status(message, status)
    result = super
    WhatsappCampaignStatusSnapshotWriter.record(message)
    result
  end
end

# Error sink handed to Chatwoot's send_template in place of the `message` argument.
# Upstream passes nil, so Meta's rejection reason is written to the log and lost. A real
# Message can't be used either: Base::SendOnChannelService skips a send only when source_id
# is already present, so an unsent Message record would be delivered a second time by
# SendReplyJob. This object satisfies the calls handle_error makes and nothing else.
class WhatsappCampaignErrorSink
  attr_accessor :external_error, :status

  def blank?
    false
  end

  def save!
    true
  end
end

# The campaign opener automation must assign the selected/default bot before its webhook is
# queued. Doing this in Chatwoot closes the race where n8n receives the outgoing opener while
# the conversation is still unassigned. Existing User/AgentBot assignments always win, so a
# campaign-level selection or a human takeover is never overwritten.
module WhatsappCampaignAutomationActionService
  private

  def assign_agent_bot_if_unassigned(agent_bot_ids = [])
    return if @conversation.assignee_id.present? || @conversation.assignee_agent_bot_id.present?

    agent_bot_id = Array(agent_bot_ids).first.to_i
    return if agent_bot_id.zero?

    Conversations::AssignmentService.new(
      conversation: @conversation,
      assignee_id: agent_bot_id,
      assignee_type: 'AgentBot'
    ).perform
  end

  # A mobile macro adds a short-lived label, and its AutomationRule calls this action.
  # The explicit action may replace a human assignment, but only after proving that the
  # contact has a recorded campaign opener. This preserves the campaign-only bot boundary.
  # Params: [agent_bot_id, inbox_id, opener_marker_1, opener_marker_2, ...]
  def assign_agent_bot_for_campaign_contact(params = [])
    agent_bot_id, inbox_id, *campaign_markers = Array(params)
    agent_bot_id = agent_bot_id.to_i
    inbox_id = inbox_id.to_i

    return if agent_bot_id.zero? || inbox_id.zero?
    return unless @conversation.inbox_id == inbox_id
    return unless AgentBot.accessible_to(@account).exists?(id: agent_bot_id)

    @conversation.with_lock do
      unless campaign_contact?(inbox_id, campaign_markers)
        Rails.logger.info(
          "[CUSTOM] Campaign bot assignment skipped for conversation #{@conversation.id}: contact is not campaign-eligible"
        )
        next
      end

      Conversations::AssignmentService.new(
        conversation: @conversation,
        assignee_id: agent_bot_id,
        assignee_type: 'AgentBot'
      ).perform
    end
  end

  # Removes only the requested AgentBot. Human and team assignments are never changed.
  # Params: [agent_bot_id]
  def remove_specific_agent_bot(agent_bot_ids = [])
    agent_bot_id = Array(agent_bot_ids).first.to_i
    return if agent_bot_id.zero?

    @conversation.with_lock do
      next unless @conversation.assignee_agent_bot_id == agent_bot_id

      Conversations::AssignmentService.new(
        conversation: @conversation,
        assignee_id: nil,
        assignee_type: 'User'
      ).perform
    end
  end

  def campaign_contact?(inbox_id, campaign_markers)
    return false if @conversation.contact_id.blank?

    related_conversations = @account.conversations.where(inbox_id: inbox_id, contact_id: @conversation.contact_id)
    if @conversation.contact_inbox_id.present?
      same_contact_inbox = @account.conversations.where(
        inbox_id: inbox_id,
        contact_inbox_id: @conversation.contact_inbox_id
      )
      related_conversations = related_conversations.or(same_contact_inbox)
    end

    return true if related_conversations.where.not(campaign_id: nil).exists?

    campaign_messages = Message.reorder(nil).where(
      account_id: @account.id,
      conversation_id: related_conversations.select(:id),
      message_type: :outgoing
    )
    return true if campaign_messages.where("messages.content_attributes::jsonb ? 'campaign_id'").exists?

    campaign_markers.compact_blank.any? do |marker|
      escaped_marker = ActiveRecord::Base.sanitize_sql_like(marker.to_s)
      campaign_messages.where('messages.content ILIKE ?', "%#{escaped_marker}%").exists?
    end
  end
end

module WhatsappCampaignAutomationRuleActions
  def actions_attributes
    super + %w[assign_agent_bot_if_unassigned assign_agent_bot_for_campaign_contact remove_specific_agent_bot]
  end
end

Rails.application.config.after_initialize do
  Rails.logger.info '[CUSTOM] Loading WhatsApp campaign conversation patch...'

  begin
    unless AutomationRule.ancestors.include?(WhatsappCampaignAutomationRuleActions)
      AutomationRule.prepend(WhatsappCampaignAutomationRuleActions)
    end

    unless AutomationRules::ActionService.ancestors.include?(WhatsappCampaignAutomationActionService)
      AutomationRules::ActionService.prepend(WhatsappCampaignAutomationActionService)
    end

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
      svc.class_eval do
        private

        # Freeze the exact relation once so the audience count, snapshot and processed contacts
        # cannot drift if label membership changes while a large campaign is running.
        def process_audience(audience_labels)
          contacts = campaign.account.contacts.tagged_with(audience_labels, any: true).to_a
          Rails.logger.info "Processing #{contacts.length} contacts for campaign #{campaign.id}"

          snapshot_campaign_audience(contacts)
          contacts.each { |contact| process_contact(contact) }

          Rails.logger.info "Campaign #{campaign.id} processing completed"
        end

        # Best-effort by design: a reporting-table problem must never block customer messages.
        # ON CONFLICT DO NOTHING preserves the first (historically correct) audience on job retry.
        def snapshot_campaign_audience(contacts)
          return if contacts.empty?

          connection = ActiveRecord::Base.connection
          contacts.each_slice(500) do |batch|
            values = batch.map do |contact|
              "(#{campaign.account_id.to_i},#{campaign.id.to_i},#{contact.id.to_i}," \
                "#{connection.quote(contact.name)},#{connection.quote(contact.phone_number)},CURRENT_TIMESTAMP)"
            end.join(',')

            connection.execute(<<~SQL.squish)
              INSERT INTO drip.campaign_audience_snapshots
                (account_id, campaign_id, contact_id, contact_name, phone, captured_at)
              VALUES #{values}
              ON CONFLICT (account_id, campaign_id, contact_id) DO NOTHING
            SQL
          end
          Rails.logger.info "Campaign #{campaign.id}: Captured audience snapshot (#{contacts.length} contacts)"
        rescue StandardError => e
          Rails.logger.error "Campaign #{campaign.id}: Audience snapshot failed: #{e.class}: #{e.message}"
        end

        # Record the accepted Meta send before touching Chatwoot's conversation/message layer.
        # source_id is Meta's stable wamid and therefore remains reliable even when an outgoing
        # echo is later represented by a different Chatwoot message row.
        #
        # status: 0 = accepted by Meta, 3 = Meta rejected the request, 4 = local skip, no send
        # was attempted at all (reason in error_title). 4 is ours; 0..3 mirror Message#status.
        def snapshot_campaign_send(contact, whatsapp_message_id, status: 0, error: nil)
          connection = ActiveRecord::Base.connection
          # A skip or a rejection has no wamid, but source_id is part of the primary key —
          # a per-contact synthetic key keeps one row per recipient and lets a re-run update it.
          key = whatsapp_message_id.presence || "skip:#{campaign.id}:#{contact.id}"
          # ⚠️ No `--` comments inside the heredoc: .squish collapses it to a single line and
          # a SQL line comment would swallow everything after it.
          # ON CONFLICT rules: a terminal outcome (3/4) always wins, because a re-run can turn
          # a skip into a real send or the reverse. An accepted send (0) must NOT overwrite a
          # status a delivery webhook has already advanced.
          connection.execute(<<~SQL.squish)
            INSERT INTO drip.campaign_send_snapshots
              (account_id, campaign_id, contact_id, contact_name, phone, source_id, status,
               error_title, attempted_at, status_updated_at)
            VALUES
              (#{campaign.account_id.to_i}, #{campaign.id.to_i}, #{contact.id.to_i},
               #{connection.quote(contact.name)}, #{connection.quote(contact.phone_number)},
               #{connection.quote(key.to_s)}, #{status.to_i}, #{connection.quote(error)},
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (account_id, campaign_id, source_id) DO UPDATE
              SET contact_id = EXCLUDED.contact_id,
                  contact_name = EXCLUDED.contact_name,
                  phone = EXCLUDED.phone,
                  status = CASE WHEN EXCLUDED.status >= 3 THEN EXCLUDED.status
                                ELSE drip.campaign_send_snapshots.status END,
                  error_title = COALESCE(EXCLUDED.error_title, drip.campaign_send_snapshots.error_title),
                  status_updated_at = CURRENT_TIMESTAMP
          SQL
        rescue StandardError => e
          Rails.logger.error "Campaign #{campaign.id}: Send snapshot failed: #{e.class}: #{e.message}"
        end

        def attach_campaign_send_snapshot(whatsapp_message_id, conversation, message = nil)
          connection = ActiveRecord::Base.connection
          message_id_sql = message&.id ? message.id.to_i : 'message_id'
          status = message&.status_before_type_cast.to_i
          connection.execute(<<~SQL.squish)
            UPDATE drip.campaign_send_snapshots
               SET conversation_id = #{conversation.id.to_i},
                   message_id = #{message_id_sql},
                   status = CASE WHEN status = 3 THEN 3 ELSE GREATEST(status, #{status}) END,
                   status_updated_at = CURRENT_TIMESTAMP
             WHERE account_id = #{campaign.account_id.to_i}
               AND campaign_id = #{campaign.id.to_i}
               AND source_id = #{connection.quote(whatsapp_message_id.to_s)}
          SQL
        rescue StandardError => e
          Rails.logger.error "Campaign #{campaign.id}: Send snapshot link failed: #{e.class}: #{e.message}"
        end

        # Same flow as upstream v4.14.1 #process_contact (including Liquid), plus
        # conversation/message recording after a successful send — and a ledger row for every
        # outcome. Upstream returns silently on each of these skips, which is exactly how a
        # recipient disappears from the report with no reason attached.
        def process_contact(contact)
          Rails.logger.info "Processing contact: #{contact.name} (#{contact.phone_number})"

          if contact.phone_number.blank?
            Rails.logger.info "Skipping contact #{contact.name} - no phone number"
            return snapshot_campaign_send(contact, nil, status: 4, error: 'no_phone')
          end

          if campaign.template_params.blank?
            Rails.logger.error "Skipping contact #{contact.name} - no template_params found for WhatsApp campaign"
            return snapshot_campaign_send(contact, nil, status: 4, error: 'no_template_params')
          end

          processed_template_params = process_liquid_template_params(contact)
          if processed_template_params.nil?
            return snapshot_campaign_send(contact, nil, status: 4, error: 'liquid_blank')
          end

          error_sink = WhatsappCampaignErrorSink.new
          whatsapp_message_id = send_whatsapp_template_message(
            to: contact.phone_number, template_params: processed_template_params, error_sink: error_sink
          )

          if whatsapp_message_id.present?
            snapshot_campaign_send(contact, whatsapp_message_id)
            create_campaign_conversation_and_message(contact, whatsapp_message_id, processed_template_params)
          else
            Rails.logger.error "Campaign #{campaign.id}: Send failed for #{contact.phone_number}"
            snapshot_campaign_send(contact, nil, status: 3,
                                                 error: error_sink.external_error.presence || 'send_failed')
          end
        end

        # Same as upstream v4.14.1, plus append_carousel_component before send and the error
        # sink in place of upstream's nil (see WhatsappCampaignErrorSink).
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

          assign_campaign_conversation(conversation)
          attach_campaign_send_snapshot(whatsapp_message_id, conversation)

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
            content_attributes: {
              'campaign_id' => campaign.id,
              'campaign_contact_id' => contact.id,
              'campaign_contact_name' => contact.name,
              'campaign_phone' => contact.phone_number
            }
          )

          if message.persisted?
            attach_campaign_send_snapshot(whatsapp_message_id, conversation, message)
            Rails.logger.info "Campaign #{campaign.id}: Created message #{message.id} in conversation #{conversation.id} for #{contact.phone_number}"
          else
            Rails.logger.error "Campaign #{campaign.id}: Failed to create message: #{message.errors.full_messages.join(', ')}"
          end
        rescue StandardError => e
          Rails.logger.error "Campaign #{campaign.id}: Conversation creation failed for #{contact.phone_number}: #{e.message}"
          Rails.logger.error e.backtrace.first(5).join("\n")
        end

        def assign_campaign_conversation(conversation)
          assignee = campaign.trigger_rules&.dig('assignee')
          return if assignee.blank?

          assignee_id = assignee['id'].to_i
          assignee_type = assignee['type'].to_s
          valid_assignee = if assignee_type == 'AgentBot'
                             AgentBot.accessible_to(campaign.account).exists?(id: assignee_id)
                           elsif assignee_type == 'User'
                             campaign.account.users.exists?(id: assignee_id)
                           else
                             false
                           end

          unless valid_assignee
            Rails.logger.error "Campaign #{campaign.id}: Invalid #{assignee_type} assignee #{assignee_id}"
            return
          end

          Conversations::AssignmentService.new(
            conversation: conversation,
            assignee_id: assignee_id,
            assignee_type: assignee_type
          ).perform
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

      unless Whatsapp::IncomingMessageBaseService.ancestors.include?(WhatsappCampaignIncomingStatusPatch)
        Whatsapp::IncomingMessageBaseService.prepend(WhatsappCampaignIncomingStatusPatch)
      end

      Rails.logger.info '[CUSTOM] WhatsApp campaign conversation patch loaded successfully (v4.14.1 Liquid-aware)'
    end
  rescue StandardError => e
    Rails.logger.error "[CUSTOM] WhatsApp campaign patch failed to load: #{e.class}: #{e.message}"
  end
end
