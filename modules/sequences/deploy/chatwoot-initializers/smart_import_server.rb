# Smart import, server half: Chatwoot 4.20's own import with the smart-import options on top.
#
# Chatwoot imports the contacts itself (Settings > Data > New import). The browser half
# (modules/smart-import) reads the user's CSV or Excel file, lets them map the columns, and hands
# that dialog a CSV in Chatwoot's own format. This file adds what Chatwoot does not have:
#
#   POST /api/v1/accounts/:account_id/smart_import/preview  pre-check counts, no writes
#   POST /api/v1/accounts/:account_id/smart_import/arm      options for the next upload of one exact file
#
# and four small extensions of Chatwoot's import, active only for a file the box armed:
#   - DataImports::CreationService   the armed options ride on the import (source_metadata['cwpt'])
#   - DataImports::Csv::ContactWriter the reserved cwpt: columns land in additional / custom attributes
#   - DataImports::Csv::Importer      each imported contact is linked to the WhatsApp inbox
#   - DataImports::Csv::NotificationJob the agent who started it gets a summary with a row-by-row CSV
#
# An arm is keyed by account, user and the SHA-256 of the exact bytes Chatwoot receives, lives an
# hour in Redis (Redis::Alfred: Rails.cache is a per-container FileStore here, invisible to sidekiq)
# and is used once. Without an arm, Chatwoot's import runs exactly as shipped.
#
# The rules live in plain module functions (tested without Rails, test/smart_import_server_test.rb);
# the Rails half below only wires them in.

require 'digest'
require 'json'

module SmartImportServer
  MAX_ROWS = 25_000
  LOG_MAX = 25_000
  ARM_TTL = 60 * 60
  PREFIX = 'cwpt:'.freeze
  MATCH_KEYS = %w[identifier email phone_number].freeze
  ADDITIONAL_KEYS = %w[company_name city country].freeze
  WHATSAPP_CHANNEL = 'Channel::Whatsapp'.freeze

  I18N = {
    'he' => {
      phone_invalid: 'מספר לא תקין (%s) — לא יקבל וואטסאפ',
      phone_missing: 'ללא מספר טלפון — לא יקבל וואטסאפ',
      subject_done: 'הייבוא הושלם — נוצרו %d, עודכנו %d (%s)',
      subject_error: 'הייבוא נעצר עקב שגיאה (%s)',
      body_done: 'הייבוא של %d אנשי קשר בחשבון "%s" הסתיים.',
      body_error: "הייבוא בחשבון \"%s\" נעצר: %s\nמה שכבר נקלט נשאר. אפשר להמשיך אותו מהגדרות › נתונים.",
      counts: "נוצרו: %d\nעודכנו: %d\nדולגו: %d\nנכשלו: %d",
      label_line: 'תווית שהוקצתה: %s',
      no_phone_line: '⚠️ %d אנשי קשר ללא מספר טלפון תקין — לא יקבלו הודעות וואטסאפ.',
      top_error_line: 'השגיאה הנפוצה: %s (×%d)',
      csv_line: 'הדוח המלא, שורה-שורה, מצורף כקובץ CSV.',
      truncated_line: 'הדוח מציג את %d השורות הראשונות.'
    },
    'en' => {
      phone_invalid: 'Invalid phone (%s) — will not receive WhatsApp',
      phone_missing: 'No phone number — will not receive WhatsApp',
      subject_done: 'Import complete — %d created, %d updated (%s)',
      subject_error: 'Import stopped due to an error (%s)',
      body_done: 'The import of %d contacts into "%s" has finished.',
      body_error: "The import into \"%s\" stopped: %s\nRows already imported were kept. You can resume it from Settings › Data.",
      counts: "Created: %d\nUpdated: %d\nSkipped: %d\nFailed: %d",
      label_line: 'Label applied: %s',
      no_phone_line: '⚠️ %d contacts have no usable phone number — they will not receive WhatsApp messages.',
      top_error_line: 'Most common error: %s (×%d)',
      csv_line: 'The full row-by-row report is attached as a CSV file.',
      truncated_line: 'The report lists the first %d rows.'
    }
  }.freeze

  module_function

  def t(locale, key_name)
    (I18N[locale] || I18N['he']).fetch(key_name)
  end

  def text(value)
    value.nil? ? '' : value.to_s.strip
  end

  # A row's keys exactly as Chatwoot's ContactWriter matches them: identifier and phone
  # verbatim, email lowercased (the writer lowercases the file's email, then finds it as is).
  def match_keys(raw)
    MATCH_KEYS.filter_map do |k|
      v = text(raw[k])[0, 255]
      v = v.downcase if k == 'email'
      "#{k}:#{v}" unless v.empty?
    end
  end

  # keys_per_row: match_keys of every row; existing: the keys a contact in the account has.
  # A later row that shares a key with an earlier one updates the contact that row creates.
  def preview_counts(keys_per_row, existing)
    claimed = {}
    counts = { 'total' => keys_per_row.length, 'new' => 0, 'existing' => 0, 'dup_in_file' => 0 }
    keys_per_row.each do |ids|
      bucket = if ids.any? { |id| existing.include?(id) }
                 'existing'
               elsif ids.any? { |id| claimed[id] }
                 'dup_in_file'
               else
                 'new'
               end
      counts[bucket] += 1
      ids.each { |id| claimed[id] = true }
    end
    counts
  end

  def arm_key(account_id, user_id, sha256)
    "cwpt:smart_import:arm:#{account_id}:#{user_id}:#{sha256}"
  end

  # The trust boundary for the options: only these four keys, typed and capped.
  def arm_options(params)
    {
      'whatsapp' => truthy?(params['whatsapp']),
      'email_summary' => truthy?(params['email_summary']),
      'label' => text(params['label'])[0, 255],
      'locale' => params['locale'].to_s == 'en' ? 'en' : 'he'
    }
  end

  def truthy?(value)
    [true, 'true', '1', 1].include?(value)
  end

  # A row's fields -> [the rest for Chatwoot, additional_attributes, custom_attributes].
  # cwpt:row and cwpt:phone_raw only feed the summary, so they go nowhere here.
  def split_fields(fields)
    rest = {}
    extra = {}
    custom = {}
    fields.each do |key, value|
      name = key.to_s
      next rest[key] = value unless name.start_with?(PREFIX)

      v = text(value)
      next if v.empty?

      name = name.delete_prefix(PREFIX)
      if name.start_with?('custom:')
        attr = name.delete_prefix('custom:')
        custom[attr] = v unless attr.empty?
      elsif ADDITIONAL_KEYS.include?(name)
        extra[name] = v
      end
    end
    [rest, extra, custom]
  end

  def phone_note(fields, locale)
    return '' unless text(fields['phone_number']).empty?

    raw = text(fields['cwpt:phone_raw'])
    raw.empty? ? t(locale, :phone_missing) : format(t(locale, :phone_invalid), raw)
  end

  # One DataImportItem -> one report row: the spreadsheet row, name, outcome, contact, reason.
  def log_row(status, contact_id, error, metadata, locale)
    fields = metadata['fields'].is_a?(Hash) ? metadata['fields'] : {}
    row = text(fields['cwpt:row'])
    row = metadata['row_number'].to_i + 1 if row.empty? # Chatwoot counts data rows; the sheet counts the header
    name = text(fields['name'])
    case status
    when 'imported' then [row, name, metadata['outcome'] || 'imported', contact_id, phone_note(fields, locale)]
    when 'failed' then [row, name, 'failed', nil, text(error)[0, 200]]
    else [row, name, status, nil, '']
    end
  end

  def log_csv(rows)
    lines = rows.map { |r| r.map { |v| csv_cell(v) }.join(',') }
    (['row,name,status,contact_id,reason'] + lines).join("\n") + "\n"
  end

  def csv_cell(value)
    s = value.nil? ? '' : value.to_s
    # A name from the user's own file that starts with = + - @ runs as a formula when the
    # attachment opens in Excel; a leading apostrophe neutralizes it.
    s = "'#{s}" if s.match?(/\A[=+\-@\t\r]/)
    /[",\n]/.match?(s) ? "\"#{s.gsub('"', '""')}\"" : s
  end

  # -> [subject, body]. stats: the import's stats['contacts']; top_error: [message, count].
  def summary(locale:, status:, account_name:, stats: {}, label: '', no_phone: 0, top_error: nil, truncated: false, error: '')
    return [format(t(locale, :subject_error), account_name), format(t(locale, :body_error), account_name, error)] if status == 'failed'

    c = stats.to_h
    created, updated, skipped, failed = %w[created updated skipped failed].map { |k| c[k].to_i }
    lines = [format(t(locale, :body_done), c['total'].to_i, account_name), '',
             format(t(locale, :counts), created, updated, skipped, failed), '']
    lines << format(t(locale, :label_line), label) unless text(label).empty?
    lines << format(t(locale, :no_phone_line), no_phone) if no_phone.positive?
    lines << format(t(locale, :top_error_line), *top_error) if top_error
    lines << '' << t(locale, :csv_line)
    lines << format(t(locale, :truncated_line), LOG_MAX) if truncated
    [format(t(locale, :subject_done), created, updated, account_name), lines.join("\n")]
  end

  # ── Rails only from here ──────────────────────────────────────────────────────────

  def existing_keys(account, keys_per_row)
    found = {}
    keys_per_row.flatten.uniq.group_by { |id| id.split(':', 2).first }.each do |field, ids|
      ids.map { |id| id.split(':', 2).last }.each_slice(5000) do |values|
        account.contacts.where(field => values).pluck(field).each { |v| found["#{field}:#{v}"] = true }
      end
    end
    found
  end

  # The account's first WhatsApp Cloud inbox, or none.
  def whatsapp_inbox(account)
    account.inboxes.where(channel_type: WHATSAPP_CHANNEL).order(:id).first
  end

  def arm!(account_id, user_id, sha256, options)
    key = arm_key(account_id, user_id, sha256)
    # set + expire, not setex: Alfred's setex argument order is easy to get wrong silently.
    Redis::Alfred.set(key, options.to_json)
    Redis::Alfred.expire(key, ARM_TTL)
  end

  # The options armed for exactly this upload, used once. nil when there are none, or when
  # anything here fails: Chatwoot's own import must never fail over an extension.
  def take_arm(account_id, user_id, file)
    return nil unless user_id && file.respond_to?(:tempfile)

    key = arm_key(account_id, user_id, Digest::SHA256.file(file.tempfile.path).hexdigest)
    raw = Redis::Alfred.get(key)
    return nil if raw.nil? || raw.empty?

    Redis::Alfred.delete(key)
    JSON.parse(raw)
  rescue StandardError
    nil
  end

  # Best effort: a contact already linked (source_id is unique per inbox)
  # or any hiccup never fails the row.
  def link_inbox(inbox, contact_id)
    contact = inbox.account.contacts.find_by(id: contact_id)
    source_id = contact&.phone_number.to_s.delete('^0-9')
    return if source_id.empty? || ContactInbox.exists?(inbox_id: inbox.id, source_id: source_id)

    ContactInbox.create!(contact_id: contact.id, inbox_id: inbox.id, source_id: source_id)
  rescue StandardError
    nil
  end

  def deliver_summary(data_import)
    data_import.with_lock do
      arm = data_import.source_metadata.to_h['cwpt']
      next unless arm.is_a?(Hash) && arm['email_summary']
      next unless data_import.failed? || data_import.completed? || data_import.completed_with_errors?

      sent_key = "#{data_import.active_import_run_id}:#{data_import.status}"
      next if data_import.source_metadata['cwpt_summary_sent'] == sent_key

      to = data_import.initiated_by&.email
      next if text(to).empty?

      subject, body, csv = summary_mail(data_import, arm, arm['locale'] == 'en' ? 'en' : 'he')
      SmartImportMailer.summary(to, subject, body, csv).deliver_now
      data_import.update!(source_metadata: data_import.source_metadata.merge('cwpt_summary_sent' => sent_key))
    end
  end

  def summary_mail(data_import, arm, locale)
    name = data_import.account.name.to_s
    if data_import.failed?
      error = text(data_import.import_errors.order(:id).last&.message)[0, 300]
      return summary(locale: locale, status: 'failed', account_name: name, error: error) + [nil]
    end

    rows = []
    no_phone = 0
    data_import.items.in_batches(of: 5000) do |batch|
      batch.pluck(:status, :chatwoot_record_id, :last_error_message, :metadata).each do |status, id, error, metadata|
        md = metadata.to_h
        no_phone += 1 if status == 'imported' && text(md.dig('fields', 'phone_number')).empty?
        rows << log_row(status, id, error, md, locale) if rows.length <= LOG_MAX
      end
    end
    top = data_import.items.failed.where.not(last_error_message: nil).group(:last_error_message).count.max_by { |_, n| n }
    subject, body = summary(locale: locale, status: data_import.status, account_name: name,
                            stats: data_import.stats.to_h['contacts'], label: arm['label'], no_phone: no_phone,
                            top_error: top, truncated: rows.length > LOG_MAX)
    [subject, body, log_csv(rows.first(LOG_MAX))]
  end

  # DataImports::CreationService: the arm for these exact bytes rides on the new import.
  module ArmedCreation
    private

    def upload_file
      blob = super
      @cwpt_arm = SmartImportServer.take_arm(@account.id, @initiated_by&.id, @source_params[:import_file])
      blob
    end

    def attributes(totals)
      attrs = super
      return attrs unless @cwpt_arm

      attrs.merge(source_metadata: attrs[:source_metadata].to_h.merge('cwpt' => @cwpt_arm))
    end
  end

  # DataImports::Csv::ContactWriter: the reserved columns, never as custom attributes named "cwpt:…".
  module ReservedColumns
    private

    def assign_fields(contact)
      @fields, extra, custom = SmartImportServer.split_fields(@fields)
      super
      contact.additional_attributes = contact.additional_attributes.to_h.merge(extra) if extra.any?
      contact.custom_attributes = contact.custom_attributes.to_h.merge(custom) if custom.any?
    end
  end

  # DataImports::Csv::Importer: link each imported contact to the WhatsApp inbox.
  module WhatsappLink
    private

    def process_item(item)
      result = super
      inbox = cwpt_whatsapp_inbox
      SmartImportServer.link_inbox(inbox, item.chatwoot_record_id) if inbox && item.imported?
      result
    end

    def cwpt_whatsapp_inbox
      return @cwpt_whatsapp_inbox if defined?(@cwpt_whatsapp_inbox)

      arm = @data_import.source_metadata.to_h['cwpt']
      @cwpt_whatsapp_inbox = (SmartImportServer.whatsapp_inbox(@data_import.account) if arm.is_a?(Hash) && arm['whatsapp'])
    end
  end

  # DataImports::Csv::NotificationJob: Chatwoot mails the admins; the agent who started an armed
  # import gets the summary too. A failure raises, so the job's retry sends it (Chatwoot's own
  # mail is deduplicated by its notification_sent key and is not sent twice).
  module Summary
    def perform(data_import)
      super
      SmartImportServer.deliver_summary(data_import)
    end
  end

  EXTENSIONS = {
    'DataImports::CreationService' => ArmedCreation,
    'DataImports::Csv::ContactWriter' => ReservedColumns,
    'DataImports::Csv::Importer' => WhatsappLink,
    'DataImports::Csv::NotificationJob' => Summary
  }.freeze
end

Rails.application.routes.append do
  namespace :api do
    namespace :v1 do
      resources :accounts, only: [] do
        scope module: :accounts do
          post 'smart_import/preview', to: 'smart_import#preview'
          post 'smart_import/arm', to: 'smart_import#arm'
        end
      end
    end
  end
end

# A proc, so a rails-runner smoke test can run it in an already-booted process (`load` the file,
# then SmartImportServer::DEFINE.call) without a restart. Safe to run twice.
SmartImportServer::DEFINE = proc do
  # safe_constantize: these classes are new in 4.20; on a rolled-back 4.19 nothing is extended.
  SmartImportServer::EXTENSIONS.each do |name, mod|
    klass = name.safe_constantize
    klass.prepend(mod) if klass && !(klass < mod)
  end
  next if defined?(::SmartImportMailer)

  class ::Api::V1::Accounts::SmartImportController < ::Api::V1::Accounts::BaseController
    def preview
      list = params[:contacts]
      unless list.is_a?(Array) && list.length.between?(1, SmartImportServer::MAX_ROWS)
        return render json: { 'error' => "contacts must be an array of 1..#{SmartImportServer::MAX_ROWS} rows" },
                      status: :unprocessable_entity
      end

      si = SmartImportServer
      keys = list.map { |r| si.match_keys(r.respond_to?(:to_unsafe_h) ? r.to_unsafe_h : {}) }
      render json: si.preview_counts(keys, si.existing_keys(Current.account, keys))
                     .merge('whatsapp' => si.whatsapp_inbox(Current.account).present?)
    end

    def arm
      sha = params[:sha256].to_s.downcase
      unless sha.match?(/\A\h{64}\z/)
        return render json: { 'error' => 'sha256 must be 64 hex characters' }, status: :unprocessable_entity
      end

      SmartImportServer.arm!(Current.account.id, current_user.id, sha, SmartImportServer.arm_options(params.to_unsafe_h))
      render json: { 'ok' => true }
    end
  end

  class ::SmartImportMailer < ::ApplicationMailer
    # format.text + render plain (NOT the body:/content_type: shortcut: with attachments present
    # it silently drops the body text). The BOM keeps Hebrew readable when Excel opens the CSV.
    def summary(to, subject, body_text, csv)
      attachments['import-log.csv'] = { mime_type: 'text/csv', content: "﻿#{csv}" } if csv
      mail(to: to, subject: subject) do |format|
        format.text { render plain: body_text }
      end
    end
  end
end

Rails.application.config.to_prepare(&SmartImportServer::DEFINE)
