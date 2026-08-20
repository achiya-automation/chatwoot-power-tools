# frozen_string_literal: true

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
