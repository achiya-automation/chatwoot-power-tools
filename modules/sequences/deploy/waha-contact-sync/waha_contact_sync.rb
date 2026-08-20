# frozen_string_literal: true

# Synchronize WAHA public profile names, WhatsApp group subjects and E.164 phone
# numbers into Chatwoot's standard Contact fields. Run with Rails runner inside
# the Chatwoot container:
#
#   bundle exec rails runner /tmp/waha_contact_sync.rb recent
#   bundle exec rails runner /tmp/waha_contact_sync.rb full
#   bundle exec rails runner /tmp/waha_contact_sync.rb full --dry-run
#
# The root-only JSON config is generated on the WAHA host. It contains one
# session-scoped, read-only WAHA key per Chatwoot inbox. Never print it.

require 'json'
require 'net/http'
require 'uri'

class WahaContactSync
  CONFIG_PATH = ENV.fetch('WAHA_CONTACT_SYNC_CONFIG', '/tmp/waha-contact-sync-config.json')
  RECENT_WINDOW_MINUTES = Integer(ENV.fetch('WAHA_CONTACT_SYNC_RECENT_MINUTES', '10'))
  USER_AGENT = 'Mozilla/5.0 (compatible; Achiya-WAHA-Chatwoot-Contact-Sync/1.0)'
  WA_CHAT_ID = 'waha_whatsapp_chat_id'
  WA_JID = 'waha_whatsapp_jid'
  WA_LID = 'waha_whatsapp_lid'
  TECHNICAL_NAME = /\A\d{7,20}@(c\.us|s\.whatsapp\.net|lid|g\.us)\z/i
  PRIVATE_JID = /\A(\d{7,15})@(c\.us|s\.whatsapp\.net)\z/i

  class SyncError < StandardError; end

  def initialize(mode:, dry_run:)
    @mode = mode
    @dry_run = dry_run
    @config = JSON.parse(File.read(CONFIG_PATH))
    @base_url = @config.fetch('waha_base_url').sub(%r{/+\z}, '')
  end

  def run
    raise SyncError, "unsupported mode: #{@mode}" unless %w[recent full].include?(@mode)

    totals = Hash.new(0)
    counter_keys = %i[
      scanned updated_names updated_phones unchanged missing_source_name
      phone_conflicts errors
    ]
    @config.fetch('targets').each do |target|
      result = sync_target(target)
      counter_keys.each { |key| totals[key] += result[key] }
      puts JSON.generate(result.merge(event: 'target_complete', dry_run: @dry_run))
    end
    puts JSON.generate(totals.merge(event: 'sync_complete', mode: @mode, dry_run: @dry_run))
  end

  private

  def sync_target(target)
    session = target.fetch('session')
    account_id = Integer(target.fetch('account_id'))
    inbox_id = Integer(target.fetch('inbox_id'))
    key = target.fetch('key')
    stats = Hash.new(0).merge(
      session: session,
      account_id: account_id,
      inbox_id: inbox_id,
      mode: @mode
    )

    profile_map = @mode == 'full' ? load_all_profiles(session, key) : nil
    group_map = @mode == 'full' ? load_all_groups(session, key) : nil
    scope_for(account_id, inbox_id).find_each do |contact|
      stats[:scanned] += 1
      begin
        sync_contact(contact, session, key, profile_map, group_map, stats)
      rescue StandardError
        # Contact IDs, names and phone numbers are deliberately omitted from logs.
        stats[:errors] += 1
      end
    end
    stats
  rescue StandardError => e
    raise SyncError, "target sync failed for account #{account_id}, inbox #{inbox_id}: #{e.class}"
  end

  def scope_for(account_id, inbox_id)
    scope = Contact.joins(:contact_inboxes)
                   .where(account_id: account_id, contact_inboxes: { inbox_id: inbox_id })
                   .where("contacts.identifier IS NULL OR contacts.identifier <> 'whatsapp.integration'")
                   .where(<<~SQL.squish)
                     contacts.custom_attributes->>'#{WA_CHAT_ID}' IS NOT NULL OR
                     contacts.custom_attributes->>'#{WA_JID}' IS NOT NULL OR
                     contacts.custom_attributes->>'#{WA_LID}' IS NOT NULL
                   SQL
                   .distinct
    return scope if @mode == 'full'

    since = RECENT_WINDOW_MINUTES.minutes.ago
    scope.where('contacts.last_activity_at >= ? OR contacts.created_at >= ?', since, since)
  end

  def sync_contact(contact, session, key, profile_map, group_map, stats)
    attrs = contact.custom_attributes.to_h
    chat_id = normalize_jid(attrs[WA_CHAT_ID])
    jid = normalize_jid(attrs[WA_JID])
    lid = normalize_jid(attrs[WA_LID])
    is_group = [chat_id, jid].compact.any? { |value| value.end_with?('@g.us') }

    if is_group
      group_id = [chat_id, jid].compact.find { |value| value.end_with?('@g.us') }
      desired_name = group_map ? group_map[group_id] : load_one_group_name(session, key, group_id)
      stats[:missing_source_name] += 1 if desired_name.nil?
      apply_changes(contact, desired_name, nil, stats)
      return
    end

    records = if profile_map
                [profile_map[jid], profile_map[lid], profile_map[chat_id]].compact
              else
                [jid, lid, chat_id].compact.uniq.filter_map do |contact_id|
                  load_one_profile(session, key, contact_id)
                end
              end
    desired_name = preferred_profile_name(records)
    phone = phone_from_jid(jid)
    desired_name ||= readable_phone_name(phone) if technical_or_phone_name?(contact.name, jid)
    stats[:missing_source_name] += 1 if desired_name.nil?
    apply_changes(contact, desired_name, phone, stats)
  end

  def apply_changes(contact, desired_name, desired_phone, stats)
    changes = {}
    clean_name = sanitize_name(desired_name)
    changes[:name] = clean_name if clean_name && clean_name != contact.name

    if desired_phone && desired_phone != contact.phone_number
      conflict = Contact.where(account_id: contact.account_id, phone_number: desired_phone)
                        .where.not(id: contact.id)
                        .exists?
      if conflict
        stats[:phone_conflicts] += 1
      else
        changes[:phone_number] = desired_phone
      end
    end

    if changes.empty?
      stats[:unchanged] += 1
      return
    end

    stats[:updated_names] += 1 if changes.key?(:name)
    stats[:updated_phones] += 1 if changes.key?(:phone_number)
    contact.update_columns(changes) unless @dry_run
  end

  def load_all_profiles(session, key)
    rows = get_json('/api/contacts/all', key, session: session, limit: 100_000)
    raise SyncError, 'contacts response is not an array' unless rows.is_a?(Array)

    rows.each_with_object({}) do |row, result|
      id = normalize_jid(row['id'])
      result[id] = row if id
    end
  end

  def load_one_profile(session, key, contact_id)
    encoded = URI.encode_www_form_component(contact_id)
    row = get_json("/api/#{session}/contacts/#{encoded}", key)
    row.is_a?(Hash) ? row : nil
  rescue SyncError
    nil
  end

  def load_all_groups(session, key)
    rows = get_json("/api/#{session}/groups", key, limit: 500)
    raise SyncError, 'groups response is not an array' unless rows.is_a?(Array)

    rows.each_with_object({}) do |row, result|
      id = normalize_jid(row['JID'] || row['id'])
      name = sanitize_name(row['Name'] || row['subject'] || row['name'])
      result[id] = name if id&.end_with?('@g.us') && name
    end
  end

  def load_one_group_name(session, key, group_id)
    encoded = URI.encode_www_form_component(group_id)
    row = get_json("/api/#{session}/groups/#{encoded}", key)
    return nil unless row.is_a?(Hash)

    sanitize_name(row['Name'] || row['subject'] || row['name'])
  rescue SyncError
    nil
  end

  def get_json(path, key, params = {})
    uri = URI.parse("#{@base_url}#{path}")
    uri.query = URI.encode_www_form(params) unless params.empty?
    request = Net::HTTP::Get.new(uri)
    request['X-Api-Key'] = key
    request['Accept'] = 'application/json'
    request['User-Agent'] = USER_AGENT

    response = Net::HTTP.start(
      uri.host,
      uri.port,
      use_ssl: uri.scheme == 'https',
      open_timeout: 10,
      read_timeout: 120
    ) { |http| http.request(request) }
    raise SyncError, "WAHA HTTP #{response.code}" unless response.is_a?(Net::HTTPSuccess)

    JSON.parse(response.body)
  rescue JSON::ParserError
    raise SyncError, 'WAHA returned invalid JSON'
  end

  def preferred_profile_name(records)
    records.each do |row|
      value = sanitize_name(row['pushName'] || row['pushname'])
      return value if value
    end
    records.each do |row|
      value = sanitize_name(row['name'])
      return value if value
    end
    nil
  end

  def normalize_jid(value)
    value = value.to_s.strip
    return nil if value.empty?

    value.sub(/@s\.whatsapp\.net\z/i, '@c.us')
  end

  def phone_from_jid(jid)
    match = jid.to_s.match(PRIVATE_JID)
    match ? "+#{match[1]}" : nil
  end

  def readable_phone_name(phone)
    return nil unless phone

    digits = phone.delete_prefix('+')
    if digits.start_with?('972') && digits.length >= 11
      rest = digits[3..]
      "+972 #{rest[0, 2]}-#{rest[2, 3]}-#{rest[5..]}"
    else
      "+#{digits}"
    end
  end

  def technical_or_phone_name?(name, jid)
    value = name.to_s.strip
    return true if value.empty? || value.match?(TECHNICAL_NAME)

    digits = value.gsub(/\D/, '')
    jid_digits = jid.to_s.sub(/@.*\z/, '')
    !jid_digits.empty? && digits == jid_digits
  end

  def sanitize_name(value)
    value = value.to_s.gsub(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/, '').strip
    return nil if value.empty? || value.match?(TECHNICAL_NAME)

    value[0, 255].strip
  end
end

mode = ARGV.find { |arg| %w[recent full].include?(arg) } || 'recent'
dry_run = ARGV.include?('--dry-run')
WahaContactSync.new(mode: mode, dry_run: dry_run).run
