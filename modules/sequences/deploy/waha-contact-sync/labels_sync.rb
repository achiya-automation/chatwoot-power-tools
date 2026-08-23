# Import WhatsApp Business labels into Chatwoot for the sessions that have them.
require 'json'; require 'net/http'; require 'uri'
CFG = JSON.parse(File.read(ENV.fetch('LBL_CFG')))
BASE = CFG.fetch('waha_base_url').sub(%r{/+\z}, '')
DRY = ARGV.include?('--dry-run')

def get(path, key, params = {})
  uri = URI.parse("#{BASE}#{path}")
  uri.query = URI.encode_www_form(params) unless params.empty?
  r = Net::HTTP::Get.new(uri); r['X-Api-Key'] = key; r['Accept'] = 'application/json'
  r['User-Agent'] = 'Mozilla/5.0 (compatible; Achiya-WAHA-Chatwoot-Contact-Sync/1.0)'
  res = Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 10, read_timeout: 120) { |h| h.request(r) }
  res.is_a?(Net::HTTPSuccess) ? JSON.parse(res.body) : nil
rescue StandardError
  nil
end

def norm(v) = (v = v.to_s.strip).empty? ? nil : v.sub(/@s\.whatsapp\.net\z/i, '@c.us')

# Chatwoot מאשר בכותרת תווית רק אותיות, ספרות, מקף וקו תחתון —
# רווח הופך למקף, ואימוג'י או סימן נשמט. "תמיכה ⚙️" -> "תמיכה"
def label_title(raw)
  t = raw.to_s.gsub(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/, '')
         .gsub(/[^\p{L}\p{N}\s_-]/, '')
         .strip.squeeze(' ').tr(' ', '-').gsub(/-+/, '-').gsub(/\A-|-\z/, '')
  t.empty? ? nil : t
end

CFG.fetch('targets').each do |t|
  session = t.fetch('session'); key = t.fetch('key')
  aid = Integer(t.fetch('account_id')); iid = Integer(t.fetch('inbox_id'))
  labels = get("/api/#{session}/labels", key)
  next unless labels.is_a?(Array) && labels.any?

  # צ'אט מתויג מגיע לרוב כ-LID; פותרים אותו למספר כדי למצוא את איש הקשר.
  lid_rows = get("/api/#{session}/lids", key, limit: 100_000, offset: 0)
  lid_map = {}
  if lid_rows.is_a?(Array)
    lid_rows.each do |row|
      l = norm(row['lid']); pn = norm(row['pn'])
      lid_map[l] = pn if l&.end_with?('@lid') && pn&.end_with?('@c.us')
    end
  end

  s = Hash.new(0)
  labels.each do |l|
    title = label_title(l['name'])
    if title.nil?
      s[:title_unusable] += 1
      next
    end

    colour = l['colorHex'].to_s.match?(/\A#[0-9a-f]{6}\z/i) ? l['colorHex'] : '#1f93ff'
    label = Label.find_by(account_id: aid, title: title)
    if label.nil?
      s[:labels_created] += 1
      label = Label.new(account_id: aid, title: title, color: colour,
                        description: 'תווית מוואטסאפ עסקי') unless DRY
      label.save! unless DRY
    else
      s[:labels_existing] += 1
    end

    chats = get("/api/#{session}/labels/#{URI.encode_www_form_component(l['id'].to_s)}/chats", key)
    next unless chats.is_a?(Array)

    chats.each do |row|
      chat_id = norm(row.is_a?(Hash) ? (row['id'] || row['chatId'] || row['jid']) : row)
      next unless chat_id

      ids = [chat_id, lid_map[chat_id]].compact.uniq
      phones = ids.filter_map { |i| (m = i.match(/\A(\d{7,15})@c\.us\z/)) && "+#{m[1]}" }
      contact = Contact.where(account_id: aid)
                       .where("custom_attributes->>'waha_whatsapp_chat_id' = ANY(ARRAY[:c]) OR
                               custom_attributes->>'waha_whatsapp_jid' = ANY(ARRAY[:c]) OR
                               custom_attributes->>'waha_whatsapp_lid' = ANY(ARRAY[:c])", c: ids).first
      contact ||= Contact.where(account_id: aid, phone_number: phones).first if phones.any?
      if contact.nil?
        s[:chat_not_in_chatwoot] += 1
        next
      end
      if contact.label_list.include?(label ? label.title : title)
        s[:already_tagged] += 1
      else
        s[:TAGGED] += 1
        unless DRY
          contact.add_labels([title])
          contact.save!
        end
      end
    end
  end
  puts JSON.generate(s.merge(account_id: aid, inbox_id: iid, dry_run: DRY))
end
