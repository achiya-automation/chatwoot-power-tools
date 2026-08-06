# Smart-import server engine — moves the actual importing off the browser.
#
# The wizard (modules/smart-import) still parses, maps and previews the file locally, but
# instead of writing thousands of contacts through 3-4 REST calls each (Rack::Attack 429
# cooldowns, an open-tab requirement, ~20 minutes for 2,000 rows), it POSTs the mapped rows
# here once: a Sidekiq job writes them with direct ActiveRecord (model validations and
# callbacks intact), live progress is served from Redis, and the initiating agent gets an
# email summary with the full CSV log when the run finishes — the tab can be closed the
# moment the import starts.
#
# Routes (same devise-token cookie auth as every dashboard API call):
#   POST   /api/v1/accounts/:account_id/smart_import/preview    dedup counts only, no writes
#   POST   /api/v1/accounts/:account_id/smart_import            start → { job_id, email }
#   GET    /api/v1/accounts/:account_id/smart_import/:job_id    progress JSON (404 = unknown)
#   DELETE /api/v1/accounts/:account_id/smart_import/:job_id    request cancel
#
# The wizard probes /preview and falls back to the legacy in-browser runner on any error, so
# this initializer can be live on one server and absent on the other without breaking anyone.
#
# State lives in Redis (Redis::Alfred) and NOT in Rails.cache — production Rails.cache here
# is a per-container FileStore, invisible across the rails/sidekiq container boundary.
#
# Matching mirrors the wizard's dedup.js: key priority identifier → phone_number → email;
# email/identifier compared lowercased (like Contacts::FilterService), phone verbatim as
# +E.164; a row whose keys were already claimed by an earlier file row merges into the
# contact that earlier row just created (the wizard's __dupTail, without the concurrency
# dance — this loop is serial, which is what makes it correct by construction).

module SmartImportServer
  MAX_ROWS = 25_000
  MATCH_KEYS = %w[identifier phone_number email].freeze
  TOP_FIELDS = %w[name email identifier phone_number].freeze
  ADDITIONAL_KEYS = %w[company_name city country].freeze
  PROGRESS_TTL = 24 * 60 * 60
  PAYLOAD_TTL = 6 * 60 * 60
  CANCEL_TTL = 6 * 60 * 60
  PROGRESS_EVERY = 20

  I18N = {
    'he' => {
      no_key: 'אין שם או מזהה ייחודי',
      phone_invalid: 'מספר לא תקין (%s) — לא יקבל וואטסאפ',
      phone_missing: 'ללא מספר טלפון — לא יקבל וואטסאפ',
      subject_done: 'הייבוא הושלם — נוצרו %d, עודכנו %d (%s)',
      subject_cancelled: 'הייבוא הופסק — הושלמו %d מתוך %d (%s)',
      subject_error: 'הייבוא נעצר עקב שגיאה (%s)',
      body_done: "הייבוא של %d אנשי קשר בחשבון \"%s\" הסתיים.",
      body_cancelled: "הייבוא בחשבון \"%s\" הופסק לבקשתך אחרי %d מתוך %d שורות. מה שכבר נקלט — נשאר.",
      body_error: "הייבוא בחשבון \"%s\" נעצר עקב שגיאה: %s\nמה שכבר נקלט — נשאר; אפשר להריץ שוב את אותו קובץ (כפילויות ימוזגו ולא ייווצרו פעמיים).",
      counts: "נוצרו: %d\nעודכנו: %d\nדולגו: %d\nנכשלו: %d",
      label_line: 'תווית שהוקצתה: %s',
      no_phone_line: '⚠️ %d אנשי קשר ללא מספר טלפון תקין — לא יקבלו הודעות וואטסאפ.',
      top_error_line: 'השגיאה הנפוצה: %s (×%d)',
      csv_line: 'הדוח המלא, שורה-שורה, מצורף כקובץ CSV.',
    },
    'en' => {
      no_key: 'No name or unique identifier',
      phone_invalid: 'Invalid phone (%s) — will not receive WhatsApp',
      phone_missing: 'No phone number — will not receive WhatsApp',
      subject_done: 'Import complete — %d created, %d updated (%s)',
      subject_cancelled: 'Import stopped — %d of %d done (%s)',
      subject_error: 'Import stopped due to an error (%s)',
      body_done: 'The import of %d contacts into "%s" has finished.',
      body_cancelled: 'The import into "%s" was stopped at your request after %d of %d rows. Rows already imported were kept.',
      body_error: "The import into \"%s\" stopped due to an error: %s\nRows already imported were kept; re-running the same file is safe (duplicates merge).",
      counts: "Created: %d\nUpdated: %d\nSkipped: %d\nFailed: %d",
      label_line: 'Label applied: %s',
      no_phone_line: '⚠️ %d contacts have no usable phone number — they will not receive WhatsApp messages.',
      top_error_line: 'Most common error: %s (×%d)',
      csv_line: 'The full row-by-row report is attached as a CSV file.',
    },
  }.freeze

  module_function

  def t(locale, key_name)
    (I18N[locale] || I18N['he']).fetch(key_name)
  end

  def key(account_id, job_id, part)
    "cwpt:smart_import:#{account_id}:#{job_id}:#{part}"
  end

  # Two calls (set + expire) instead of setex on purpose: Alfred's setex argument order is
  # an easy thing to get wrong silently; this pair has exactly one possible reading.
  def write(redis_key, obj, ttl)
    Redis::Alfred.set(redis_key, obj.to_json)
    Redis::Alfred.expire(redis_key, ttl)
  end

  def norm(match_key, value)
    return nil if value.blank?

    match_key == 'phone_number' ? value.to_s : value.to_s.downcase
  end

  # One wire row → the trusted attribute hash everything downstream works with. Only known
  # keys survive; custom-attribute keys/values are length-capped. This is the trust
  # boundary — the browser payload is user-shaped data.
  def clean_row(raw)
    row = {}
    TOP_FIELDS.each do |f|
      v = raw[f]
      row[f] = v.to_s.strip[0, 255] if v.present?
    end
    add = raw['additional_attributes']
    if add.is_a?(Hash)
      keep = {}
      ADDITIONAL_KEYS.each do |k|
        v = add[k].to_s.strip
        keep[k] = v[0, 255] if v.present?
      end
      row['additional_attributes'] = keep if keep.any?
    end
    cus = raw['custom_attributes']
    if cus.is_a?(Hash)
      keep = {}
      cus.each do |k, v|
        k2 = k.to_s.strip[0, 80]
        v2 = v.to_s.strip[0, 1000]
        keep[k2] = v2 if k2.present? && v2.present?
      end
      row['custom_attributes'] = keep if keep.any?
    end
    row['row_num'] = raw['row_num'].to_i if raw['row_num'].present?
    row['phone_raw'] = raw['phone_raw'].to_s.strip[0, 40] if raw['phone_raw'].present?
    row
  end

  # {'identifier' => {norm value => Contact}, ...} for every value present in the file.
  # Three IN queries (chunked) replace the wizard's dozens of paginated filter calls.
  # LOWER() on email/identifier mirrors Contacts::FilterService's case-insensitive equality
  # (identifier is NOT stored lowercased, so a plain IN would silently create duplicates).
  def preload(account, rows)
    maps = {}
    MATCH_KEYS.each do |k|
      vals = rows.map { |r| norm(k, r[k]) }.compact.uniq
      maps[k] = {}
      next if vals.empty?

      vals.each_slice(5000) do |slice|
        scope = if k == 'phone_number'
                  account.contacts.where(phone_number: slice)
                else
                  account.contacts.where("LOWER(#{k}) IN (?)", slice)
                end
        scope.find_each do |c|
          nv = norm(k, c[k])
          maps[k][nv] ||= c
        end
      end
    end
    maps
  end

  def find_match(maps, row)
    MATCH_KEYS.each do |k|
      nv = norm(k, row[k])
      next if nv.nil?

      hit = maps[k][nv]
      return hit if hit
    end
    nil
  end

  # After a create/update, claim the row's keys so later in-file duplicates merge into
  # this contact instead of creating a twin.
  def register(maps, row, contact)
    MATCH_KEYS.each do |k|
      nv = norm(k, row[k])
      maps[k][nv] ||= contact if nv
    end
  end

  # Dry-run counts for the wizard's preview step. No writes.
  def preview_counts(account, rows)
    maps = preload(account, rows)
    claimed = {}
    fresh = 0
    existing = 0
    dup = 0
    no_phone = 0
    rows.each do |row|
      no_phone += 1 if row['phone_number'].blank?
      if find_match(maps, row)
        existing += 1
        next
      end
      ids = MATCH_KEYS.map { |k| (nv = norm(k, row[k])) && "#{k}:#{nv}" }.compact
      if ids.any? { |id| claimed[id] }
        dup += 1
      else
        fresh += 1
        ids.each { |id| claimed[id] = true }
      end
    end
    { 'total' => rows.length, 'new' => fresh, 'existing' => existing,
      'dup_in_file' => dup, 'no_phone' => no_phone }
  end

  def phone_note(row, locale)
    return '' if row['phone_number'].present?

    if row['phone_raw'].present?
      format(t(locale, :phone_invalid), row['phone_raw'])
    else
      t(locale, :phone_missing)
    end
  end

  # Mirrors the wizard's ImportLog#toCsv, so the emailed report and the in-page download
  # are the same artifact.
  def log_csv(log)
    head = 'row,name,status,contact_id,reason'
    lines = log.map do |r|
      [r['row'], r['name'], r['status'], r['contact_id'], r['reason']]
        .map { |v| csv_cell(v) }.join(',')
    end
    ([head] + lines).join("\n") + "\n"
  end

  def csv_cell(value)
    s = value.nil? ? '' : value.to_s
    /[",\n]/.match?(s) ? '"' + s.gsub('"', '""') + '"' : s
  end

  def top_error(log)
    fails = log.select { |r| r['status'] == 'failed' && r['reason'].present? }
    return nil if fails.empty?

    reason, arr = fails.group_by { |r| r['reason'] }.max_by { |_, v| v.length }
    { 'reason' => reason, 'count' => arr.length }
  end
end

Rails.application.routes.append do
  namespace :api do
    namespace :v1 do
      resources :accounts, only: [] do
        scope module: :accounts do
          post 'smart_import/preview', to: 'smart_import#preview'
          post 'smart_import', to: 'smart_import#create'
          get 'smart_import/:job_id', to: 'smart_import#show'
          delete 'smart_import/:job_id', to: 'smart_import#cancel'
        end
      end
    end
  end
end

# Class definitions live in a callable proc so a rails-runner smoke test can execute them
# inside an already-booted process (`load` the file, then SmartImportServer::DEFINE.call)
# without waiting for a Rails restart. `class` keywords are legal inside a proc — not
# inside a def — which is why this is a proc and not a method.
SmartImportServer::DEFINE = proc do
  # Guard against double definition when the proc runs a second time; in production
  # to_prepare runs exactly once at boot.
  next if defined?(::SmartImportJob)

  class ::Api::V1::Accounts::SmartImportController < ::Api::V1::Accounts::BaseController
    def preview
      rows = wire_rows!
      return if performed?

      render json: SmartImportServer.preview_counts(Current.account, rows)
    end

    def create
      rows = wire_rows!
      return if performed?

      si = SmartImportServer
      job_id = SecureRandom.hex(8)
      si.write(si.key(Current.account.id, job_id, 'payload'), rows, si::PAYLOAD_TTL)
      si.write(si.key(Current.account.id, job_id, 'progress'),
               { 'state' => 'queued', 'done' => 0, 'total' => rows.length,
                 'created' => 0, 'updated' => 0, 'skipped' => 0, 'failed' => 0,
                 'email' => current_user&.email }, si::PROGRESS_TTL)
      SmartImportJob.perform_later(Current.account.id, current_user&.id, job_id,
                                   params[:label_title].to_s, params[:wa_inbox_id],
                                   params[:locale].to_s == 'en' ? 'en' : 'he')
      render json: { 'job_id' => job_id, 'email' => current_user&.email }
    end

    def show
      raw = Redis::Alfred.get(SmartImportServer.key(Current.account.id, safe_job_id, 'progress'))
      return head :not_found if raw.blank?

      render plain: raw, content_type: 'application/json'
    end

    def cancel
      cancel_key = SmartImportServer.key(Current.account.id, safe_job_id, 'cancel')
      Redis::Alfred.set(cancel_key, '1')
      Redis::Alfred.expire(cancel_key, SmartImportServer::CANCEL_TTL)
      head :ok
    end

    private

    def safe_job_id
      params[:job_id].to_s.match?(/\A\h{16}\z/) ? params[:job_id].to_s : 'invalid'
    end

    # Returns cleaned rows, or renders 422 and returns [] (caller checks performed?).
    def wire_rows!
      list = params[:contacts]
      list = list.values if list.is_a?(ActionController::Parameters)
      unless list.is_a?(Array) && list.length.positive? && list.length <= SmartImportServer::MAX_ROWS
        render json: { 'error' => "contacts must be an array of 1..#{SmartImportServer::MAX_ROWS} rows" },
               status: :unprocessable_entity
        return []
      end
      list.map do |r|
        h = if r.respond_to?(:to_unsafe_h)
              r.to_unsafe_h
            else
              r.is_a?(Hash) ? r : {}
            end
        SmartImportServer.clean_row(h.stringify_keys)
      end
    end
  end

  class ::SmartImportJob < ::ApplicationJob
    queue_as :low

    # ponytail: one attempt, always reported — an automatic retry would re-walk half the
    # file on a transient failure; the agent re-runs from the wizard instead (matching
    # makes a re-run merge, not duplicate).
    def perform(account_id, user_id, job_id, label_title, wa_inbox_id, locale)
      si = SmartImportServer
      @progress_key = si.key(account_id, job_id, 'progress')
      cancel_key = si.key(account_id, job_id, 'cancel')
      payload_key = si.key(account_id, job_id, 'payload')

      account = Account.find(account_id)
      user = User.find_by(id: user_id)
      @user_email = user&.email
      @account_name = account.name.to_s

      raw = Redis::Alfred.get(payload_key)
      if raw.blank?
        si.write(@progress_key, { 'state' => 'error', 'error' => 'payload expired', 'email' => @user_email },
                 si::PROGRESS_TTL)
        return
      end
      rows = JSON.parse(raw).map { |r| si.clean_row(r) }
      total = rows.length
      label = label_title.presence
      inbox = wa_inbox_id.present? ? account.inboxes.find_by(id: wa_inbox_id) : nil

      log = []
      counts = Hash.new(0)
      state = 'running'
      maps = si.preload(account, rows)

      rows.each_with_index do |row, i|
        if (i % si::PROGRESS_EVERY).zero?
          if Redis::Alfred.get(cancel_key).present?
            state = 'cancelled'
            break
          end
          si.write(@progress_key, snapshot('running', i, total, counts), si::PROGRESS_TTL)
        end
        import_row(account, row, maps, label, inbox, counts, log, locale)
      end

      state = 'done' if state == 'running'
      final = snapshot(state, log.length, total, counts).merge('log' => log)
      si.write(@progress_key, final, si::PROGRESS_TTL)
      Redis::Alfred.delete(payload_key)

      deliver_summary(account, locale, state, counts, total, log, label)
    rescue StandardError => e
      Rails.logger.error("SmartImportJob #{job_id}: #{e.class} #{e.message}")
      begin
        SmartImportServer.write(@progress_key,
                                { 'state' => 'error', 'error' => e.message.to_s[0, 300], 'email' => @user_email },
                                SmartImportServer::PROGRESS_TTL)
        deliver_error(locale, e)
      rescue StandardError
        nil
      end
    end

    private

    def snapshot(state, done, total, counts)
      { 'state' => state, 'done' => done, 'total' => total,
        'created' => counts['created'], 'updated' => counts['updated'],
        'skipped' => counts['skipped'], 'failed' => counts['failed'],
        'email' => @user_email }
    end

    def import_row(account, row, maps, label, inbox, counts, log, locale)
      si = SmartImportServer
      name = row['name'].to_s
      if name.blank? && si::MATCH_KEYS.all? { |k| row[k].blank? }
        counts['skipped'] += 1
        log << { 'row' => row['row_num'], 'name' => name, 'status' => 'skipped',
                 'contact_id' => nil, 'reason' => si.t(locale, :no_key) }
        return
      end

      match = si.find_match(maps, row)
      contact = match || account.contacts.new
      si::TOP_FIELDS.each do |f|
        contact[f] = row[f] if row[f].present?
      end
      if row['additional_attributes']
        contact.additional_attributes = (contact.additional_attributes || {}).merge(row['additional_attributes'])
      end
      if row['custom_attributes']
        contact.custom_attributes = (contact.custom_attributes || {}).merge(row['custom_attributes'])
      end
      if label
        current = match ? contact.label_list.map(&:to_s) : []
        contact.label_list = (current + [label]).uniq unless current.include?(label)
      end
      contact.save!
      si.register(maps, row, contact)
      link_inbox(contact, inbox)

      status = match ? 'updated' : 'created'
      counts[status] += 1
      log << { 'row' => row['row_num'], 'name' => contact.name.to_s, 'status' => status,
               'contact_id' => contact.id, 'reason' => si.phone_note(row, locale) }
    rescue StandardError => e
      counts['failed'] += 1
      reason = e.is_a?(ActiveRecord::RecordInvalid) ? e.record.errors.full_messages.join('; ') : e.message
      log << { 'row' => row['row_num'], 'name' => name, 'status' => 'failed',
               'contact_id' => nil, 'reason' => reason.to_s[0, 200] }
    end

    # Same best-effort semantics as the wizard: a contact already linked (source_id is
    # unique per inbox) or any linking hiccup must never fail the row.
    def link_inbox(contact, inbox)
      return unless inbox && contact.phone_number.present?

      source_id = contact.phone_number.delete('^0-9')
      return if source_id.blank?
      return if ContactInbox.exists?(inbox_id: inbox.id, source_id: source_id)

      ContactInbox.create!(contact_id: contact.id, inbox_id: inbox.id, source_id: source_id)
    rescue StandardError
      nil
    end

    def deliver_summary(account, locale, state, counts, total, log, label)
      return if @user_email.blank?

      si = SmartImportServer
      done = log.length
      subject = if state == 'cancelled'
                  format(si.t(locale, :subject_cancelled), done, total, account.name)
                else
                  format(si.t(locale, :subject_done), counts['created'], counts['updated'], account.name)
                end
      lines = []
      lines << if state == 'cancelled'
                 format(si.t(locale, :body_cancelled), account.name, done, total)
               else
                 format(si.t(locale, :body_done), total, account.name)
               end
      lines << ''
      lines << format(si.t(locale, :counts), counts['created'], counts['updated'], counts['skipped'], counts['failed'])
      lines << ''
      lines << format(si.t(locale, :label_line), label) if label
      # phone_note is the only reason a created/updated row ever carries.
      no_phone = log.count { |r| %w[created updated].include?(r['status']) && r['reason'].present? }
      lines << format(si.t(locale, :no_phone_line), no_phone) if no_phone.positive?
      top = si.top_error(log)
      lines << format(si.t(locale, :top_error_line), top['reason'], top['count']) if top
      lines << ''
      lines << si.t(locale, :csv_line)
      SmartImportMailer.summary(@user_email, subject, lines.join("\n"), si.log_csv(log)).deliver_now
    end

    def deliver_error(locale, error)
      return if @user_email.blank?

      si = SmartImportServer
      subject = format(si.t(locale, :subject_error), error.class.name)
      body = format(si.t(locale, :body_error), @account_name.to_s, error.message.to_s[0, 300])
      SmartImportMailer.summary(@user_email, subject, body, nil).deliver_now
    end
  end

  class ::SmartImportMailer < ::ApplicationMailer
    # format.text + render plain (NOT the body:/content_type: shortcut — with attachments
    # present that shortcut silently drops the body text). The BOM on the CSV attachment
    # keeps Hebrew readable when Excel opens it.
    def summary(to, subject, body_text, csv)
      attachments['import-log.csv'] = { mime_type: 'text/csv', content: "﻿" + csv } if csv
      mail(to: to, subject: subject) do |format|
        format.text { render plain: body_text }
      end
    end
  end
end

Rails.application.config.to_prepare(&SmartImportServer::DEFINE)
