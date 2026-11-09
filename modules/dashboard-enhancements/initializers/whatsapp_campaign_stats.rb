# frozen_string_literal: true

# Campaign delivery stats for the WhatsApp campaign analytics screen (our own implementation).
#
# Chatwoot 4.19 put GET /campaigns/:id/analytics/{metrics,contacts} behind a paid plan flag, so
# the MIT dashboard screen got 403. These routes are prepended ahead of the upstream ones and
# served by our own controller. It reads only MIT core data:
#   - public.campaign_recipients (core db/schema.rb) for campaigns sent on 4.17+
#   - the drip ledgers / tagged messages via LegacyCampaignAnalytics417
#     (whatsapp_campaign_conversations.rb) for older campaigns
# and returns the payload shape the dashboard's .vue code reads.
#
# Auth: Api::V1::Accounts::BaseController (user/token auth + account membership) and the core
# CampaignPolicy#show?, which allows account administrators only. Agents — restricted or not —
# get 401/403 and never see recipients. No plan or feature flag is touched.
#
# Mounted read-only into rails via docker-compose (survives image updates).
# Created: 2026-10-23 (Chatwoot 4.19.0)

# Classes are defined in to_prepare: app constants (and LegacyCampaignAnalytics417 from
# whatsapp_campaign_conversations.rb) are only safe to reference after initialization.
Rails.application.config.to_prepare do
  class CampaignDeliveryStats < LegacyCampaignAnalytics417
    # Integer → name for public.campaign_recipients.status, taken at runtime from the app's own
    # model when present; otherwise the status is derived from the row's timestamps.
    def self.recipient_status_names
      model = 'CampaignRecipient'.safe_constantize
      model.respond_to?(:statuses) ? model.statuses.invert : {}
    end

    private

    def deliveries
      @deliveries ||= native_rows.presence || super
    end

    def native_rows
      names = self.class.recipient_status_names
      select_all(<<~SQL).map { |row| row.merge('status' => status_name(row, names)) }
        SELECT 'recipient:' || r.id::text AS recipient_id,
               c.id AS contact_id,
               coalesce(c.name, '') AS contact_name,
               coalesce(c.phone_number, '') AS phone_number,
               r.status AS raw_status,
               r.sent_at, r.delivered_at, r.read_at, r.failed_at,
               coalesce(r.message_content, '') AS message_content,
               r.error_code, r.error_title, r.error_message
          FROM public.campaign_recipients r
          LEFT JOIN public.contacts c ON c.id = r.contact_id AND c.account_id = :account_id
         WHERE r.account_id = :account_id AND r.campaign_id = :campaign_id
         ORDER BY coalesce(r.read_at, r.delivered_at, r.sent_at, r.failed_at, r.updated_at) DESC, r.id DESC
      SQL
    end

    def status_name(row, names)
      name = names[row['raw_status']]
      return name if STATUSES.include?(name)
      return 'failed' if row['failed_at']
      return 'read' if row['read_at']
      return 'delivered' if row['delivered_at']
      return 'sent' if row['sent_at']

      row['error_code'].present? ? 'skipped' : 'queued'
    end
  end

  class CampaignDeliveryStatsController < Api::V1::Accounts::BaseController
    def metrics
      render json: stats.metrics
    end

    def contacts
      render json: stats.contacts(status: params[:status], page: params[:page])
    end

    private

    def stats
      campaign = Current.account.campaigns.find_by!(display_id: params[:campaign_id])
      authorize campaign, :show?
      CampaignDeliveryStats.new(campaign)
    end
  end

end

Rails.application.routes.prepend do
  scope 'api/v1/accounts/:account_id/campaigns/:campaign_id/analytics', defaults: { format: 'json' },
                                                                        constraints: { account_id: /\d+/ } do
    get 'metrics', to: 'campaign_delivery_stats#metrics'
    get 'contacts', to: 'campaign_delivery_stats#contacts'
  end
end
