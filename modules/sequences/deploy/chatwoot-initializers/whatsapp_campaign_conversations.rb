# Custom initializer: WhatsApp campaign enhancements (v4.17 enterprise-graft)
#
# Since 4.17 Chatwoot's enterprise pipeline owns the whole campaign flow — audience freeze,
# per-recipient tracking (public.campaign_recipients), skip/failure reasons and delivery
# webhooks. The engine's reports read that table directly, so this file grafts ONLY what is
# still not native:
# 1. CAROUSEL template support: upstream builds only header/body/footer/buttons components,
#    so Meta rejects carousel templates with error #132012. We append the carousel component
#    built from the synced template definition itself: each card gets its header media + a
#    payload per quick-reply button. Card media: the template's example handle is downloaded
#    and re-uploaded to the WhatsApp Media API (Meta's fetcher 403s on its own scontent
#    links — error 131053), and the media id is cached in Redis for 25 days.
# 2. Records a conversation + message in Chatwoot for every successful campaign send
#    (upstream sends the template via Meta API but records nothing in the inbox), with the
#    original contact identity stamped on the message. Imported contacts can otherwise be
#    represented by a second, channel-bound Contact record with an automatic name and no
#    phone, corrupting reports.
# 3. Applies the optional campaign assignee from trigger_rules. The WhatsApp campaign form
#    stores { assignee: { type: 'User'|'AgentBot', id: N } }; every created/reused
#    conversation is assigned before its outgoing campaign message is recorded.
#
# (Until 20.8.26 this file also wrote the drip.campaign_send_snapshots /
# drip.campaign_audience_snapshots ledger. The engine now reads campaign_recipients for
# 4.17 campaigns — the drip ledger keeps serving pre-4.17 history and resend retries,
# which the engine writes itself.)
#
# Mounted read-only via docker-compose into rails + sidekiq (survives image updates).
# Created: 2026-02-18 | Rewritten: 2026-06-10 (v4.14.1) | Native-first trim: 2026-08-20 (v4.17)
#
# Update safety: the guard below verifies the upstream methods + signature before patching.
# If a future Chatwoot version changes them, the patch is NOT applied — upstream campaign
# sending keeps working, only the local extras (conversation recording, carousel, assignee)
# are skipped — and a loud error is logged.

# The graft rides on Enterprise::Whatsapp::OneoffCampaignService's shape — recipient-first
# sends + provider-response hook. All heavy lifting (helpers) stays defined on the service
# via class_eval below; this module only re-routes the 4.17 pipeline through them.
module WhatsappCampaignGraft417
  private

  # the native 4.17 flow verbatim, plus carousel support before the send and
  # conversation recording after a successful one
  def send_whatsapp_template_message(recipient:, to:, template_params:)
    processor = Whatsapp::TemplateProcessorService.new(
      channel: channel,
      template_params: template_params
    )

    name, namespace, lang_code, processed_parameters = processor.call

    if name.blank?
      recipient.mark_skipped!('Template name could not be resolved')
      return
    end

    processed_parameters = append_carousel_component(name, lang_code, processed_parameters)
    source_id = channel.send_template(to, template_info(name, namespace, lang_code, processed_parameters), nil)
    update_recipient_from_provider_response(recipient, source_id)

    create_campaign_conversation_and_message(recipient.contact, source_id, template_params) if source_id.present?
    source_id
  rescue StandardError => e
    Rails.logger.error "Failed to send WhatsApp template message to #{to}: #{e.message}"
    Rails.logger.error "Backtrace: #{e.backtrace.first(5).join('\n')}"
    recipient.mark_failed!(message: e.message)
    nil
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

  # A Web/Mobile macro calls this guard directly (legacy AutomationRules may call it too).
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

# Chatwoot macros historically accept only human ids in the built-in `assign_agent`
# action. The dashboard overlay represents an AgentBot as `AgentBot:<id>` so User and
# AgentBot ids can never collide, while every legacy macro payload keeps its original
# behaviour through `super`.
#
# Bot 12 is deliberately campaign-only. Keeping this policy here (rather than only in
# the dashboard) means a macro executed from Web, Mobile or the API cannot bypass it.
module WhatsappCampaignMacroActionService
  CAMPAIGN_ONLY_AGENT_BOTS = {
    [11, 12] => {
      inbox_id: 38,
      markers: ['חשבת אולי למכור', 'רציתי לשאול בנוגע לדירה', 'חשבתם אולי למכור']
    }
  }.freeze

  private

  def assign_agent(agent_ids)
    encoded_assignee = Array(agent_ids).first.to_s
    match = encoded_assignee.match(/\AAgentBot:(\d+)\z/)
    return super unless match

    agent_bot_id = match[1].to_i
    policy = CAMPAIGN_ONLY_AGENT_BOTS[[@account.id, agent_bot_id]]
    if policy
      return assign_agent_bot_for_campaign_contact(
        [agent_bot_id, policy[:inbox_id], *policy[:markers]]
      )
    end

    return unless AgentBot.accessible_to(@account).exists?(id: agent_bot_id)

    @conversation.with_lock do
      Conversations::AssignmentService.new(
        conversation: @conversation,
        assignee_id: agent_bot_id,
        assignee_type: 'AgentBot'
      ).perform
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

    # `remove_specific_agent_bot` is a direct macro action. Register it additively,
    # preserving every upstream action and failing loudly if the registry shape changes.
    macro_actions = Macro.const_get(:ACTIONS_ATTRS, false)
    raise 'Macro::ACTIONS_ATTRS changed upstream' unless macro_actions.is_a?(Array)

    unless macro_actions.include?('remove_specific_agent_bot')
      Macro.send(:remove_const, :ACTIONS_ATTRS)
      Macro.const_set(:ACTIONS_ATTRS, (macro_actions + ['remove_specific_agent_bot']).uniq.freeze)
    end

    unless Macros::ExecutionService.ancestors.include?(WhatsappCampaignAutomationActionService)
      Macros::ExecutionService.prepend(WhatsappCampaignAutomationActionService)
    end

    unless Macros::ExecutionService.ancestors.include?(WhatsappCampaignMacroActionService)
      Macros::ExecutionService.prepend(WhatsappCampaignMacroActionService)
    end

    svc = Whatsapp::OneoffCampaignService

    # 4.17: the effective pipeline is Enterprise::Whatsapp::OneoffCampaignService (prepended
    # upstream). The graft rides on ITS shape — recipient-first sends + provider-response hook.
    expected_send_signature = [%i[keyreq recipient], %i[keyreq to], %i[keyreq template_params]]
    problems = []

    # Only what the graft itself calls: the send override + the upstream helpers it reuses.
    %i[send_whatsapp_template_message update_recipient_from_provider_response template_info].each do |meth|
      problems << "missing method ##{meth}" unless svc.private_method_defined?(meth) || svc.method_defined?(meth)
    end

    problems << 'CampaignRecipient model missing' unless defined?(CampaignRecipient)
    %i[mark_skipped! mark_failed!].each do |meth|
      problems << "CampaignRecipient##{meth} missing" if defined?(CampaignRecipient) && !CampaignRecipient.method_defined?(meth)
    end

    if problems.empty? && svc.instance_method(:send_whatsapp_template_message).parameters != expected_send_signature
      problems << "#send_whatsapp_template_message signature changed to #{svc.instance_method(:send_whatsapp_template_message).parameters.inspect}"
    end

    if problems.any?
      Rails.logger.error "[CUSTOM] WhatsApp campaign patch NOT applied (upstream changed): #{problems.join('; ')}"
      Rails.logger.error '[CUSTOM] Campaign sends and reports keep working natively, but carousel templates, ' \
                         'the per-send conversation/message and the campaign assignee will be skipped. ' \
                         'Review /opt/chatwoot/custom-initializers/whatsapp_campaign_conversations.rb against the new Chatwoot version!'
    else
      svc.class_eval do
        private

        # (process_contact and the drip snapshot writers were removed in the 4.17 native-first
        # trim — the enterprise pipeline owns audience/skips/statuses via campaign_recipients,
        # and the engine reads that table directly. See WhatsappCampaignGraft417.)

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

          # Symbol keys are mandatory. ContactInboxWithContactBuilder reads
          # contact_attributes[:name] / [:phone_number]; with string keys both read back nil, so
          # find_contact_by_phone_number never matches the imported contact and create_contact
          # persists a blank record named by Haikunator ("dry-haze-861") with no phone number.
          contact_inbox = ::ContactInboxWithContactBuilder.new(
            source_id: phone_number,
            inbox: inbox,
            contact_attributes: {
              name: contact.name,
              phone_number: contact.phone_number
            }
          ).perform

          return unless contact_inbox

          restore_campaign_contact_identity(contact_inbox, contact)

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
            Rails.logger.info "Campaign #{campaign.id}: Created message #{message.id} in conversation #{conversation.id} for #{contact.phone_number}"
          else
            Rails.logger.error "Campaign #{campaign.id}: Failed to create message: #{message.errors.full_messages.join(', ')}"
          end
        rescue StandardError => e
          Rails.logger.error "Campaign #{campaign.id}: Conversation creation failed for #{contact.phone_number}: #{e.message}"
          Rails.logger.error e.backtrace.first(5).join("\n")
        end

        CAMPAIGN_PLACEHOLDER_NAME = /\A[a-z]+-[a-z]+-\d+\z/

        # Defence in depth. The builder returns an existing contact_inbox untouched, so a blank
        # placeholder contact created before the symbol-key fix — or by an inbound message that
        # arrived before the import — stays nameless and phoneless forever, invisible to both
        # phone lookups and import dedup. Restore what the campaign already knows.
        # ponytail: repair only; when another contact owns the number this leaves the duplicate
        # pair alone for modules/smart-import/maintenance/fix-hidden-phones.rb to merge.
        def restore_campaign_contact_identity(contact_inbox, campaign_contact)
          target = contact_inbox.contact
          return if target.blank?
          return if target.phone_number.present? && !target.name.to_s.match?(CAMPAIGN_PLACEHOLDER_NAME)
          return if campaign_contact.phone_number.blank?

          if target.phone_number.blank?
            owner_exists = campaign.account.contacts
                                   .where(phone_number: campaign_contact.phone_number)
                                   .where.not(id: target.id).exists?
            return if owner_exists

            target.phone_number = campaign_contact.phone_number
          end

          target.name = campaign_contact.name if campaign_contact.name.present? &&
                                                 target.name.to_s.match?(CAMPAIGN_PLACEHOLDER_NAME)
          return if target.save

          Rails.logger.warn "Campaign #{campaign.id}: identity restore rejected for contact " \
                            "#{target.id}: #{target.errors.full_messages.join(', ')}"
        rescue StandardError => e
          Rails.logger.warn "Campaign #{campaign.id}: identity restore failed for contact " \
                            "#{contact_inbox.contact_id}: #{e.message}"
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

      unless svc.ancestors.include?(WhatsappCampaignGraft417)
        svc.prepend(WhatsappCampaignGraft417)
      end

      Rails.logger.info '[CUSTOM] WhatsApp campaign conversation patch loaded successfully (v4.17 enterprise-graft)'
    end
  rescue StandardError => e
    Rails.logger.error "[CUSTOM] WhatsApp campaign patch failed to load: #{e.class}: #{e.message}"
  end
end
