# התראות מכסת אחסון מדיה.
#
# רץ יומית. לכל חשבון שחרג מהמכסה (או מתקרב אליה) מרכיב מייל ושולח אותו
# לאדמינים של החשבון, ומחזיר JSON עם הסיכום. השליחה קורית רק כש-SEND=1;
# בלי זה זו הרצה יבשה שמדפיסה בדיוק מה היה נשלח ולמי.
#
# משתני סביבה:
#   SEND=1              שולח בפועל (ברירת מחדל: יבש)
#   UPGRADE_URL=...     הקישור שהלקוח מקבל כדי לשדרג מנוי
#   QUOTA_BASE_GB=10    מה כלול במחיר
#   QUOTA_STEP_GB=10    גודל מדרגת התוספת
#   QUOTA_STEP_PRICE=30 ₪ למדרגה
#   QUOTA_WARN_EVERY_DAYS=21   מרווח מינימלי בין תזכורות אזהרה
#   QUOTA_OVER_EVERY_DAYS=14   מרווח מינימלי בין תזכורות חריגה
#   QUOTA_WARN_GROWTH_PCT=5    כמה הצריכה צריכה לטפס (% מהמכסה) כדי להצדיק תזכורת
#   QUOTA_FROM_NAME=...        שם השולח שהלקוח רואה (ברירת מחדל: אחיה אוטומציה)
#   STATE_FILE=...      איפה נשמר מתי הותרע לאחרונה

require 'json'
require 'fileutils'

SEND        = ENV['SEND'] == '1'
UPGRADE_URL = ENV['UPGRADE_URL'].to_s.strip
BASE_GB     = (ENV['QUOTA_BASE_GB']    || 10).to_f
STEP_GB     = (ENV['QUOTA_STEP_GB']    || 10).to_f
STEP_PRICE  = (ENV['QUOTA_STEP_PRICE'] || 30).to_i
WARN_AT     = (ENV['QUOTA_WARN_PCT']   || 80).to_f
WARN_EVERY  = (ENV['QUOTA_WARN_EVERY_DAYS'] || 21).to_i
OVER_EVERY  = (ENV['QUOTA_OVER_EVERY_DAYS'] || 14).to_i
WARN_GROWTH = (ENV['QUOTA_WARN_GROWTH_PCT'] || 5).to_f
STATE_FILE  = ENV['STATE_FILE'] || '/app/tmp/storage-quota-state.json'

# שם התצוגה של השולח. בלעדיו הלקוח רואה כתובת גולמית ("info@...") בראש
# המייל במקום שם העסק. הכתובת עצמה נשארת זו של Chatwoot — רק עוטפים
# אותה בשם, כדי לא לקבע כתובת בקוד שיושב בריפו ציבורי.
FROM_NAME   = (ENV['QUOTA_FROM_NAME'].to_s.strip.empty? ? 'אחיה אוטומציה' : ENV['QUOTA_FROM_NAME'].strip).freeze

# המייל עומד בפני עצמו: client_html מחזיר מסמך HTML שלם עם הנייר, הלוגו
# והפוטר. ה-layout הגנרי של Chatwoot הוא כרטיס לבן בסגנון SaaS — הוא היה
# עוטף את הנייר בכרטיס שני וסותר את העיצוב, ולכן layout: false.
#
# התמונה נשלחת **בתוך** המייל (inline attachment) ולא כקישור לאתר: ג'ימייל
# ואאוטלוק חוסמים תמונות חיצוניות כברירת מחדל, ואז הלקוח היה מקבל מלבן ריק
# במקום המסר. הקבצים מגיעים מהמארח ל-/tmp בקונטיינר דרך storage-quota-alert.sh.
QUOTA_IMAGES = {
  'over' => '/tmp/quota-over.jpg',
  'warn' => '/tmp/quota-warn.jpg'
}.freeze

class StorageQuotaMailer < ApplicationMailer
  def alert(recipients, subject, html, image_path = nil)
    if image_path && File.exist?(image_path)
      attachments.inline['quota.jpg'] = File.binread(image_path)
      html = html.sub('__QUOTA_IMAGE__', attachments['quota.jpg'].url)
    else
      # בלי קובץ התמונה הכרטיס נפתח ישר בתווית, בלי <img> שבור
      html = html.sub(%r{<!--IMG-->.*?<!--/IMG-->}m, '')
    end

    @html_body = html
    opts = { to: recipients, subject: subject }
    sender = named_sender
    opts[:from] = sender if sender

    mail(**opts) do |format|
      format.html { render inline: '<%= @html_body.html_safe %>', layout: false }
    end
  end

  private

  # מרכיב "אחיה אוטומציה <כתובת>" מתוך ה-from שכבר מוגדר ב-ApplicationMailer.
  # Mail::Address דואג ל-quoting ול-encoding של שם לא-לטיני (RFC 2047).
  # אם משהו בשרשרת הזאת נופל — מחזירים nil וה-from הרגיל של Chatwoot נשאר.
  def named_sender
    address = Mail::Address.new(self.class.default[:from].to_s).address
    return nil if address.to_s.empty?

    addr = Mail::Address.new
    addr.address = address
    addr.display_name = FROM_NAME
    addr.format
  rescue StandardError
    nil
  end
end

# עיצוב "תיק הראיות" של האתר בתוך המייל: נייר קרם, דיו כהה, פינות עלה
# א-סימטריות, מסגרות 2px וצל קשיח. המייל עומד בפני עצמו (layout: false) —
# ה-layout הכללי של Chatwoot הוא כרטיס לבן בסגנון SaaS גנרי שסותר את הנייר,
# ושינוי שלו היה משנה גם את כל שאר מיילי המערכת.
PAPER       = '#f6f0df'.freeze
PAPER_DEEP  = '#ebe0c4'.freeze
PAPER_WHITE = '#fffdf7'.freeze
INK         = '#1d1930'.freeze
INK_SOFT    = '#524d60'.freeze
PURPLE      = '#6e3db7'.freeze
AMBER       = '#f4bc3e'.freeze
CORAL       = '#d95c45'.freeze   # מילוי בלבד
CORAL_TEXT  = '#b03824'.freeze   # גרסה כהה לטקסט — #d95c45 על נייר הוא 3.8:1, מתחת ל-AA
LINE        = 'rgba(29, 25, 48, 0.22)'.freeze

F_HEAD  = "'Suez One', 'Secular One', Arial, sans-serif".freeze
F_BODY  = "'Varela Round', Arial, Helvetica, sans-serif".freeze
F_LABEL = "'Secular One', 'Varela Round', Arial, sans-serif".freeze

# ⚠️ ג'ימייל מסיר <link> לגופנים. כל טיפוגרפיה נופלת ל-Arial, ולכן העיצוב
# נשען על צורה וצבע (עלה, מסגרת, צל) ולא על הגופן.
FONTS_URL = 'https://fonts.googleapis.com/css2?family=Suez+One&family=Varela+Round&family=Secular+One&display=swap'.freeze

# הכתם הכתום — תווית "תיק" בסגנון הסטיקרים באתר.
def sticker(text, bg = AMBER)
  %(<span style="display:inline-block;font-family:#{F_LABEL};font-size:12.5px;) +
    %(letter-spacing:.02em;color:#{INK};background:#{bg};border:2px solid #{INK};) +
    %(border-radius:13px 5px 13px 5px;box-shadow:3px 4px 0 rgba(29,25,48,.74);) +
    %(padding:5px 13px 6px;mso-line-height-rule:exactly">#{text}</span>)
end

# מד השימוש. טבלה ולא div — אאוטלוק לא מכבד רוחב באחוזים על div.
# ב-RTL התא הראשון יושב מימין, ולכן המילוי גדל מימין לשמאל כמו בעברית.
def bar_html(pct, color)
  fill = [[pct, 100].min, 4].max
  rest = 100 - fill
  rest_cell = rest.positive? ? %(<td width="#{rest}%" style="font-size:0;line-height:0">&nbsp;</td>) : ''
  <<~HTML
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl"
           style="width:100%;border-collapse:separate;background:#{PAPER_DEEP};
                  border:2px solid #{INK};border-radius:10px 3px 10px 3px;
                  box-shadow:3px 4px 0 rgba(29,25,48,.18);overflow:hidden;margin:10px 0 6px">
      <tr>
        <td width="#{fill}%" bgcolor="#{color}"
            style="background:#{color};height:17px;font-size:0;line-height:0">&nbsp;</td>
        #{rest_cell}
      </tr>
    </table>
  HTML
end

# שורת נתון. קו מקווקו כמו האינדקסים העריכוניים באתר.
def row(label, value, strong: false, tone: INK)
  weight = strong ? '700' : '400'
  <<~HTML
    <tr>
      <td style="padding:11px 0 10px;font-family:#{F_BODY};font-size:14.5px;color:#{INK_SOFT};
                 border-bottom:1.5px dashed rgba(29,25,48,.16)">#{label}</td>
      <td align="left" dir="ltr" style="padding:11px 0 10px;font-family:#{F_LABEL};font-size:16px;
                 font-weight:#{weight};color:#{tone};text-align:left;
                 border-bottom:1.5px dashed rgba(29,25,48,.16)">#{value}</td>
    </tr>
  HTML
end

def client_html(a)
  over  = a[:level] == 'over'
  color = over ? CORAL : AMBER
  pct   = a[:quota_gb].positive? ? (a[:used_gb] / a[:quota_gb] * 100).round : 0

  headline = over ? 'האחסון בחשבון עבר את המכסה' : 'האחסון בחשבון מתקרב למכסה'
  tab      = over ? 'חריגה במכסת אחסון' : 'התראת אחסון'
  img_alt  = over ? 'צנצנת מדידה שנשפכת מעבר לשוליים' : 'צנצנת מדידה שהתמלאה כמעט עד הסימן'

  details = +''
  details << row('בשימוש כעת', "#{a[:used_gb]} GB", strong: true)
  details << row('כלול בחבילה', "#{a[:quota_gb].round} GB")
  details << row('מעבר למכסה', "#{a[:over_gb]} GB", strong: true, tone: CORAL_TEXT) if over

  steps_text =
    if a[:extra_steps] == 1
      "מדרגה אחת של #{STEP_GB.round}GB בתוספת #{STEP_PRICE}₪ לחודש,"
    else
      "#{a[:extra_steps]} מדרגות של #{STEP_GB.round}GB, #{STEP_PRICE}₪ כל אחת,"
    end

  cta =
    if over
      <<~HTML
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="width:100%;border-collapse:separate;background:#{PAPER_DEEP};
                      border:2px solid #{INK};border-radius:22px 6px 22px 6px;
                      box-shadow:4px 6px 0 rgba(29,25,48,.16);margin:22px 0 6px">
          <tr>
            <td style="padding:18px 20px 20px">
              <div style="font-family:#{F_HEAD};font-size:19px;color:#{INK};line-height:1.4">
                התוספת החודשית: #{a[:extra_ils]}₪
              </div>
              <div style="font-family:#{F_BODY};font-size:14.5px;color:#{INK_SOFT};
                          line-height:1.65;padding-top:7px">
                #{steps_text} והמכסה שלך תעודכן ל-#{a[:new_quota_gb]} GB.
              </div>
            </td>
          </tr>
        </table>
      HTML
    else
      %(<p style="font-family:#{F_BODY};font-size:15px;color:#{INK_SOFT};line-height:1.75;margin:18px 0 6px">) +
        %(בקצב הנוכחי הנפח צפוי לעבור את המכסה בקרוב. אם זה קורה, התוספת היא ) +
        %(#{STEP_PRICE}₪ לחודש לכל #{STEP_GB.round}GB נוספים — בלי הפתעות ובלי מחיקה של כלום.</p>)
    end

  button =
    if UPGRADE_URL.empty?
      ''
    else
      <<~HTML
        <p style="margin:24px 0 6px">
          <a href="#{UPGRADE_URL}"
             style="display:inline-block;font-family:#{F_LABEL};font-size:15.5px;color:#ffffff;
                    background:#{PURPLE};text-decoration:none;padding:13px 30px 14px;
                    border:2px solid #{INK};border-radius:17px 5px 17px 5px;
                    box-shadow:4px 6px 0 rgba(29,25,48,.82);mso-line-height-rule:exactly">לעדכון המנוי</a>
        </p>
      HTML
    end

  <<~HTML
    <!DOCTYPE html>
    <html dir="rtl" lang="he" xmlns="http://www.w3.org/1999/xhtml">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <meta name="color-scheme" content="light only" />
      <meta name="supported-color-schemes" content="light only" />
      <title>#{headline}</title>
      <link rel="stylesheet" href="#{FONTS_URL}" />
      <style type="text/css">
        body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
        img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
        table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
        a { color:#{PURPLE}; }
        @media only screen and (max-width:620px) {
          .wrap { padding:22px 12px 30px !important; }
          .card-pad { padding:22px 20px 24px !important; }
          .headline { font-size:22px !important; line-height:1.35 !important; }
        }
      </style>
    </head>
    <body bgcolor="#{PAPER}" dir="rtl"
          style="margin:0;padding:0;background:#{PAPER};font-family:#{F_BODY};color:#{INK}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#{PAPER}"
             style="width:100%;background:#{PAPER}">
        <tr>
          <td align="center" class="wrap" style="padding:34px 16px 44px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                   style="width:100%;max-width:600px;margin:0 auto">

              <!-- לוגו במסגרת נייר, כמו תצלום מוצמד לתיק -->
              <tr>
                <td align="center" style="padding-bottom:18px">
                  <a href="https://achiya-automation.com" style="text-decoration:none">
                    <img src="https://achiya-automation.com/logo-email.png" width="56" height="56"
                         alt="אחיה אוטומציה"
                         style="width:56px;height:56px;display:block;margin:0 auto;
                                border:2px solid #{INK};border-radius:17px 5px 17px 5px;
                                box-shadow:3px 5px 0 rgba(29,25,48,.74)" />
                  </a>
                  <div style="font-family:#{F_HEAD};font-size:16px;color:#{INK};padding-top:13px">
                    אחיה אוטומציה
                  </div>
                  <div style="font-family:#{F_BODY};font-size:12.5px;color:#{INK_SOFT};padding-top:3px">
                    מערכת השיחות שלך · Chatwoot
                  </div>
                </td>
              </tr>

              <!-- הכרטיס -->
              <tr>
                <td>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                         bgcolor="#{PAPER_WHITE}"
                         style="width:100%;background:#{PAPER_WHITE};border:2px solid #{INK};
                                border-radius:30px 8px 30px 8px;box-shadow:6px 8px 0 rgba(71,42,112,.16)">
                    <!--IMG-->
                    <tr>
                      <td style="padding:0;font-size:0;line-height:0">
                        <img src="__QUOTA_IMAGE__" width="596" alt="#{img_alt}"
                             style="display:block;width:100%;max-width:596px;height:auto;
                                    border-radius:28px 6px 0 0;
                                    border-bottom:2px solid #{INK}" />
                      </td>
                    </tr>
                    <!--/IMG-->
                    <tr>
                      <td class="card-pad" style="padding:22px 32px 30px">

                        <div style="padding-bottom:16px">#{sticker(tab)}</div>

                        <div style="font-family:#{F_BODY};font-size:15px;color:#{INK_SOFT};padding-bottom:6px">
                          שלום #{a[:name]},
                        </div>

                        <div class="headline"
                             style="font-family:#{F_HEAD};font-size:25px;line-height:1.3;color:#{INK};padding-bottom:4px">
                          #{headline}
                        </div>

                        #{bar_html(pct, color)}
                        <div style="font-family:#{F_LABEL};font-size:12.5px;color:#{INK_SOFT};padding-bottom:14px">
                          #{pct}% מהמכסה
                        </div>

                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                               style="width:100%;border-collapse:collapse">#{details}</table>

                        #{cta}
                        #{button}

                        <div style="font-family:#{F_BODY};font-size:13.5px;color:#{INK_SOFT};
                                    line-height:1.7;padding-top:16px">
                          כל הקבצים שכבר בחשבון ממשיכים להישמר כרגיל — שום דבר לא נמחק אוטומטית.
                        </div>

                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td align="center"
                    style="font-family:#{F_BODY};font-size:12.5px;color:#{INK_SOFT};
                           line-height:1.75;padding:22px 10px 0">
                  קיבלת את המייל הזה כי יש לך חשבון במערכת השיחות שמופעלת על ידי
                  <a href="https://achiya-automation.com"
                     style="color:#{PURPLE};font-weight:700;text-decoration:none">אחיה אוטומציה</a>.
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  HTML
end

# --- שימוש בפועל לכל חשבון -------------------------------------------------
# blob משותף נספר פעם אחת לחשבון. אחרת דדופ היה "מוריד" ללקוח אחסון שהוא
# באמת צורך, והחיוב היה קופץ ויורד בלי שהוא עשה דבר.
usage = ActiveRecord::Base.connection.select_all(<<~SQL).to_a
  SELECT account_id, SUM(byte_size) AS bytes FROM (
    SELECT DISTINCT a.account_id, b.id, b.byte_size
    FROM active_storage_attachments asa
    JOIN active_storage_blobs b ON b.id = asa.blob_id
    JOIN attachments a          ON a.id = asa.record_id
    WHERE asa.record_type = 'Attachment'
  ) t GROUP BY account_id
SQL

# האם להזכיר שוב ללקוח שכבר קיבל מייל על אותו מצב.
#
# תזכורת בקצב קבוע היא חפירה: לקוח שיושב על 85% ולא זז קיבל מייל כל שבוע
# בלי ששום דבר השתנה אצלו. כאן מזכירים רק כשיש **חדשות**:
#   over — נכנס למדרגת חיוב חדשה (מיד, זה כסף), או שהחריגה גדלה ועברו
#          OVER_EVERY ימים
#   warn — הצריכה טיפסה עוד WARN_GROWTH אחוזים מהמכסה ועברו WARN_EVERY ימים
# ירידה מ-over ל-warn לא מייצרת מייל: אחרת לקוח שמתנדנד סביב הגבול היה
# מקבל הודעה בכל תנודה.
def remind?(prev, level:, today:, used:, quota:, steps:)
  return true if prev.nil? || prev.empty?

  last = prev['last_sent']
  return true if last.nil?

  days = (today - Date.parse(last)).to_i
  grew = used - prev['used_gb'].to_f

  if level == 'over'
    return true if steps > prev['extra_steps'].to_i
    days >= OVER_EVERY && grew.positive?
  else
    days >= WARN_EVERY && grew >= quota * WARN_GROWTH / 100
  end
rescue StandardError
  true # state פגום — עדיף מייל אחד מיותר מאשר לקוח שלא יודע שנגמר לו המקום
end

state  = File.exist?(STATE_FILE) ? (JSON.parse(File.read(STATE_FILE)) rescue {}) : {}
today  = Date.current
alerts = []
below  = [] # ירדו מתחת לסף — מנקים מה-state כדי שחצייה עתידית תתחיל מדף חדש

usage.each do |r|
  acc = Account.find_by(id: r['account_id'])
  next if acc.nil?

  used  = r['bytes'].to_f / 1024**3
  quota = (acc.custom_attributes || {})['storage_quota_gb'].to_f
  quota = BASE_GB if quota <= 0
  if used < quota * WARN_AT / 100
    below << acc.id.to_s
    next
  end

  over  = [used - quota, 0].max
  steps = over.positive? ? (over / STEP_GB).ceil : 0
  level = over.positive? ? 'over' : 'warn'

  next unless remind?(state[acc.id.to_s], level: level, today: today,
                      used: used, quota: quota, steps: steps)

  alerts << {
    account_id: acc.id, name: acc.name, level: level,
    used_gb: used.round(2), quota_gb: quota.round(2), over_gb: over.round(2),
    extra_steps: steps, extra_ils: steps * STEP_PRICE,
    new_quota_gb: (quota + steps * STEP_GB).round.to_i,
    admin_emails: acc.administrators.map(&:email).compact.uniq
  }
end

# --- שליחה ------------------------------------------------------------------
sent = []
if SEND
  alerts.each do |a|
    next if a[:admin_emails].empty?

    begin
      subject = a[:level] == 'over' ? 'חריגה במכסת אחסון המדיה' : 'התקרבות למכסת אחסון המדיה'
      StorageQuotaMailer.alert(a[:admin_emails], subject, client_html(a), QUOTA_IMAGES[a[:level]]).deliver_now
      sent << a[:account_id]
      # used_gb ו-extra_steps נשמרים כדי שהתזכורת הבאה תוכל לשאול
      # "האם משהו השתנה מאז", ולא רק "כמה זמן עבר"
      state[a[:account_id].to_s] = {
        'last_sent' => today.to_s, 'level' => a[:level],
        'used_gb' => a[:used_gb], 'extra_steps' => a[:extra_steps]
      }
    rescue StandardError => e
      a[:send_error] = "#{e.class}: #{e.message[0, 120]}"
    end
  end

  below.each { |id| state.delete(id) }

  FileUtils.mkdir_p(File.dirname(STATE_FILE))
  File.write(STATE_FILE, JSON.pretty_generate(state))
end

puts JSON.pretty_generate(
  mode: SEND ? 'SEND' : 'DRY_RUN',
  generated_at: Time.current.iso8601,
  pricing: { base_gb: BASE_GB, step_gb: STEP_GB, step_price_ils: STEP_PRICE },
  upgrade_url: UPGRADE_URL.empty? ? nil : UPGRADE_URL,
  alerts_count: alerts.size,
  sent_to_accounts: sent,
  alerts: alerts
)
