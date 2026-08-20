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

# Bridges pre-4.17 campaign history into Chatwoot's native 4.17 analytics screen.
#
# Chatwoot 4.17 introduced public.campaign_recipients. New campaigns use it natively, but
# campaigns sent before the upgrade live in the immutable drip audience/send ledgers. Some
# of those historical contacts were later deleted, so copying the ledger into the native
# table would either violate its contact foreign key or recreate hundreds of contacts in the
# live address book. This adapter leaves the data in place and supplies the native controller
# with the same payload shape. Native rows always win; the fallback is used only when a
# campaign has no campaign_recipients and a legacy source has rows.

class LegacyCampaignAnalytics417
  RESULTS_PER_PAGE = 25
  STATUSES = %w[queued skipped sent delivered read failed].freeze

  def initialize(campaign)
    @campaign = campaign
    @connection = ApplicationRecord.connection
  end

  def available?
    return false if @campaign.campaign_recipients.exists?
    return false unless legacy_tables_available?

    deliveries.any?
  rescue StandardError => e
    Rails.logger.error("[CUSTOM] Legacy campaign analytics availability failed: #{e.class}: #{e.message}")
    false
  end

  def metrics
    counts = STATUSES.index_with { 0 }
    deliveries.each { |row| counts[row.fetch('status')] += 1 }

    {
      audience: deliveries.length,
      sent: counts['sent'] + counts['delivered'] + counts['read'],
      delivered: counts['delivered'] + counts['read'],
      read: counts['read'],
      failed: counts['failed'],
      skipped: counts['skipped'],
      status_counts: counts
    }
  end

  def contacts(status:, page:)
    filtered = STATUSES.include?(status.to_s) ? deliveries.select { |row| row['status'] == status.to_s } : deliveries
    current_page = [page.to_i, 1].max
    total_count = filtered.length
    total_pages = (total_count.to_f / RESULTS_PER_PAGE).ceil
    offset = (current_page - 1) * RESULTS_PER_PAGE

    {
      payload: (filtered.slice(offset, RESULTS_PER_PAGE) || []).map { |row| recipient_payload(row) },
      meta: {
        current_page: current_page,
        total_pages: total_pages,
        total_count: total_count
      }
    }
  end

  private

  def deliveries
    @deliveries ||= begin
      rows = if audience_snapshot_exists?
               audience_snapshot_deliveries
             elsif send_snapshot_exists?
               send_snapshot_deliveries
             else
               tagged_message_deliveries
             end

      rows.map do |row|
        row['message_content'] = @campaign.message if row['message_content'].blank?
        row
      end
    end
  end

  def legacy_tables_available?
    @legacy_tables_available ||= begin
      tables = @connection.select_rows(<<~SQL.squish)
        SELECT to_regclass('drip.campaign_audience_snapshots')::text,
               to_regclass('drip.campaign_send_snapshots')::text
      SQL
      tables.dig(0, 0).present? && tables.dig(0, 1).present?
    end
  end

  def audience_snapshot_exists?
    select_value(<<~SQL).to_i.positive?
      SELECT 1
        FROM drip.campaign_audience_snapshots
       WHERE account_id = :account_id AND campaign_id = :campaign_id
       LIMIT 1
    SQL
  end

  def send_snapshot_exists?
    select_value(<<~SQL).to_i.positive?
      SELECT 1
        FROM drip.campaign_send_snapshots
       WHERE account_id = :account_id AND campaign_id = :campaign_id
       LIMIT 1
    SQL
  end

  def audience_snapshot_deliveries
    select_all(<<~SQL)
      WITH audience AS MATERIALIZED (
        SELECT DISTINCT ON (a.contact_id)
               a.contact_id, a.contact_name, a.phone, a.captured_at
          FROM drip.campaign_audience_snapshots a
         WHERE a.account_id = :account_id AND a.campaign_id = :campaign_id
         ORDER BY a.contact_id, a.captured_at DESC
      ), attempts AS MATERIALIZED (
        SELECT s.contact_id,
               s.contact_name,
               s.phone,
               s.source_id,
               s.error_title,
               s.attempted_at,
               m.content AS message_content,
               cv.contact_id AS conversation_contact_id,
               CASE
                 WHEN s.status IN (3, 4) THEN s.status
                 ELSE greatest(s.status, coalesce(m.status, 0))
               END AS effective_status
          FROM drip.campaign_send_snapshots s
          LEFT JOIN LATERAL (
            SELECT mm.id, mm.status, mm.content, mm.conversation_id
              FROM public.messages mm
             WHERE mm.account_id = s.account_id
               AND (mm.id = s.message_id OR (mm.source_id IS NOT NULL AND mm.source_id = s.source_id))
             ORDER BY (mm.id = s.message_id) DESC, mm.id DESC
             LIMIT 1
          ) m ON true
          LEFT JOIN public.conversations cv ON cv.id = coalesce(m.conversation_id, s.conversation_id)
         WHERE s.account_id = :account_id AND s.campaign_id = :campaign_id
      ), ranked AS (
        SELECT attempts.*,
               row_number() OVER (
                 PARTITION BY contact_id
                 ORDER BY CASE effective_status
                            WHEN 2 THEN 5 WHEN 1 THEN 4 WHEN 0 THEN 3
                            WHEN 3 THEN 2 WHEN 4 THEN 1 ELSE 0
                          END DESC,
                          attempted_at DESC NULLS LAST,
                          source_id DESC NULLS LAST
               ) AS attempt_rank
          FROM attempts
      )
      SELECT 'snapshot:' || audience.contact_id::text AS recipient_id,
             coalesce(direct_contact.id, conversation_contact.id) AS contact_id,
             coalesce(nullif(audience.contact_name, ''), direct_contact.name, conversation_contact.name, '') AS contact_name,
             coalesce(nullif(audience.phone, ''), direct_contact.phone_number, conversation_contact.phone_number, '') AS phone_number,
             CASE ranked.effective_status
               WHEN 0 THEN 'sent'
               WHEN 1 THEN 'delivered'
               WHEN 2 THEN 'read'
               WHEN 3 THEN 'failed'
               WHEN 4 THEN 'skipped'
               ELSE 'queued'
             END AS status,
             ranked.message_content,
             substring(ranked.error_title FROM '^([0-9]+)') AS error_code,
             ranked.error_title,
             ranked.error_title AS error_message,
             ranked.attempted_at
        FROM audience
        LEFT JOIN ranked ON ranked.contact_id = audience.contact_id AND ranked.attempt_rank = 1
        LEFT JOIN public.contacts direct_contact
          ON direct_contact.id = audience.contact_id AND direct_contact.account_id = :account_id
        LEFT JOIN public.contacts conversation_contact
          ON conversation_contact.id = ranked.conversation_contact_id
         AND conversation_contact.account_id = :account_id
       ORDER BY ranked.attempted_at DESC NULLS LAST, audience.contact_id DESC
    SQL
  end

  def send_snapshot_deliveries
    select_all(<<~SQL)
      WITH attempts AS MATERIALIZED (
        SELECT s.*,
               coalesce(
                 CASE WHEN s.contact_id IS NOT NULL THEN 'contact:' || s.contact_id::text END,
                 CASE WHEN nullif(regexp_replace(coalesce(s.phone, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
                      THEN 'phone:' || regexp_replace(s.phone, '[^0-9]', '', 'g') END,
                 'source:' || coalesce(s.source_id, s.id::text)
               ) AS recipient_key,
               m.content AS message_content,
               cv.contact_id AS conversation_contact_id,
               CASE
                 WHEN s.status IN (3, 4) THEN s.status
                 ELSE greatest(s.status, coalesce(m.status, 0))
               END AS effective_status
          FROM drip.campaign_send_snapshots s
          LEFT JOIN LATERAL (
            SELECT mm.id, mm.status, mm.content, mm.conversation_id
              FROM public.messages mm
             WHERE mm.account_id = s.account_id
               AND (mm.id = s.message_id OR (mm.source_id IS NOT NULL AND mm.source_id = s.source_id))
             ORDER BY (mm.id = s.message_id) DESC, mm.id DESC
             LIMIT 1
          ) m ON true
          LEFT JOIN public.conversations cv ON cv.id = coalesce(m.conversation_id, s.conversation_id)
         WHERE s.account_id = :account_id AND s.campaign_id = :campaign_id
      ), ranked AS (
        SELECT attempts.*,
               row_number() OVER (
                 PARTITION BY recipient_key
                 ORDER BY CASE effective_status
                            WHEN 2 THEN 5 WHEN 1 THEN 4 WHEN 0 THEN 3
                            WHEN 3 THEN 2 WHEN 4 THEN 1 ELSE 0
                          END DESC,
                          attempted_at DESC NULLS LAST,
                          id DESC
               ) AS attempt_rank
          FROM attempts
      )
      SELECT ranked.recipient_key AS recipient_id,
             coalesce(direct_contact.id, conversation_contact.id) AS contact_id,
             coalesce(nullif(ranked.contact_name, ''), direct_contact.name, conversation_contact.name, '') AS contact_name,
             coalesce(nullif(ranked.phone, ''), direct_contact.phone_number, conversation_contact.phone_number, '') AS phone_number,
             CASE ranked.effective_status
               WHEN 0 THEN 'sent'
               WHEN 1 THEN 'delivered'
               WHEN 2 THEN 'read'
               WHEN 3 THEN 'failed'
               WHEN 4 THEN 'skipped'
               ELSE 'queued'
             END AS status,
             ranked.message_content,
             substring(ranked.error_title FROM '^([0-9]+)') AS error_code,
             ranked.error_title,
             ranked.error_title AS error_message,
             ranked.attempted_at
        FROM ranked
        LEFT JOIN public.contacts direct_contact
          ON direct_contact.id = ranked.contact_id AND direct_contact.account_id = :account_id
        LEFT JOIN public.contacts conversation_contact
          ON conversation_contact.id = ranked.conversation_contact_id
         AND conversation_contact.account_id = :account_id
       WHERE ranked.attempt_rank = 1
       ORDER BY ranked.attempted_at DESC NULLS LAST, ranked.recipient_key
    SQL
  end

  def tagged_message_deliveries
    select_all(<<~SQL)
      WITH tagged AS MATERIALIZED (
        SELECT m.id,
               m.status,
               m.content AS message_content,
               m.created_at AS attempted_at,
               attrs.value AS attributes,
               cv.contact_id AS conversation_contact_id,
               coalesce(
                 CASE WHEN (attrs.value ->> 'campaign_contact_id') ~ '^[0-9]+$'
                      THEN 'contact:' || (attrs.value ->> 'campaign_contact_id') END,
                 CASE WHEN cv.contact_id IS NOT NULL THEN 'contact:' || cv.contact_id::text END,
                 CASE WHEN nullif(regexp_replace(coalesce(
                        attrs.value ->> 'campaign_phone', ci.source_id, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
                      THEN 'phone:' || regexp_replace(coalesce(
                        attrs.value ->> 'campaign_phone', ci.source_id, ''), '[^0-9]', '', 'g') END,
                 'message:' || m.id::text
               ) AS recipient_key
          FROM public.messages m
          CROSS JOIN LATERAL (
            SELECT (m.content_attributes::jsonb #>> '{}')::jsonb AS value
          ) attrs
          LEFT JOIN public.conversations cv ON cv.id = m.conversation_id
          LEFT JOIN public.contact_inboxes ci ON ci.id = cv.contact_inbox_id
         WHERE m.account_id = :account_id
           AND (attrs.value ->> 'campaign_id') ~ '^[0-9]+$'
           AND (attrs.value ->> 'campaign_id')::bigint = :campaign_id
      ), ranked AS (
        SELECT tagged.*,
               row_number() OVER (
                 PARTITION BY recipient_key
                 ORDER BY CASE status
                            WHEN 2 THEN 4 WHEN 1 THEN 3 WHEN 0 THEN 2 WHEN 3 THEN 1 ELSE 0
                          END DESC,
                          attempted_at DESC,
                          id DESC
               ) AS attempt_rank
          FROM tagged
      )
      SELECT ranked.recipient_key AS recipient_id,
             coalesce(campaign_contact.id, conversation_contact.id) AS contact_id,
             coalesce(nullif(ranked.attributes ->> 'campaign_contact_name', ''),
                      campaign_contact.name, conversation_contact.name, '') AS contact_name,
             coalesce(nullif(ranked.attributes ->> 'campaign_phone', ''),
                      campaign_contact.phone_number, conversation_contact.phone_number, '') AS phone_number,
             CASE ranked.status
               WHEN 0 THEN 'sent'
               WHEN 1 THEN 'delivered'
               WHEN 2 THEN 'read'
               WHEN 3 THEN 'failed'
               ELSE 'queued'
             END AS status,
             ranked.message_content,
             substring(ranked.attributes ->> 'external_error' FROM '^([0-9]+)') AS error_code,
             ranked.attributes ->> 'external_error' AS error_title,
             ranked.attributes ->> 'external_error' AS error_message,
             ranked.attempted_at
        FROM ranked
        LEFT JOIN public.contacts campaign_contact
          ON campaign_contact.id = CASE
               WHEN (ranked.attributes ->> 'campaign_contact_id') ~ '^[0-9]+$'
               THEN (ranked.attributes ->> 'campaign_contact_id')::bigint
             END
         AND campaign_contact.account_id = :account_id
        LEFT JOIN public.contacts conversation_contact
          ON conversation_contact.id = ranked.conversation_contact_id
         AND conversation_contact.account_id = :account_id
       WHERE ranked.attempt_rank = 1
       ORDER BY ranked.attempted_at DESC, ranked.id DESC
    SQL
  end

  def recipient_payload(row)
    {
      recipient_id: row['recipient_id'],
      contact: {
        id: row['contact_id']&.to_i,
        name: row['contact_name'],
        phone_number: row['phone_number'],
        linkable: row['contact_id'].present?
      },
      status: row['status'],
      message_content: row['message_content'],
      error_code: row['error_code'],
      error_title: row['error_title'],
      error_message: row['error_message']
    }
  end

  def select_value(sql)
    @connection.select_value(interpolate(sql))
  end

  def select_all(sql)
    @connection.select_all(interpolate(sql)).to_a
  end

  def interpolate(sql)
    ActiveRecord::Base.send(
      :sanitize_sql_array,
      [sql, { account_id: @campaign.account_id.to_i, campaign_id: @campaign.id.to_i }]
    )
  end
end

module LegacyCampaignAnalyticsController417
  def metrics
    analytics = legacy_campaign_analytics_417
    return super unless analytics.available?

    render json: analytics.metrics
  end

  def contacts
    analytics = legacy_campaign_analytics_417
    return super unless analytics.available?

    render json: analytics.contacts(status: params[:status], page: params[:page])
  end

  private

  def legacy_campaign_analytics_417
    @legacy_campaign_analytics_417 ||= LegacyCampaignAnalytics417.new(@campaign)
  end
end

Rails.application.config.to_prepare do
  controller = 'Api::V1::Accounts::Campaigns::AnalyticsController'.safe_constantize
  next unless controller
  next if controller.ancestors.include?(LegacyCampaignAnalyticsController417)

  controller.prepend(LegacyCampaignAnalyticsController417)
  Rails.logger.info '[CUSTOM] Legacy campaign analytics adapter active for Chatwoot 4.17'
end
