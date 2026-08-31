# Custom initializer: Presence humanizer — שני השלמות ל"נקרא/מקליד" של המנוע.
#
# 1. עיכוב מסירה לפי אורך ההודעה (תיבות בוט, typing_mode='auto'):
#    "מקליד" של שנייה ואז פסקה שלמה מסגיר בוט. תשובת AgentBot בתיבת whatsapp_cloud
#    מוחזקת עד שמשך ה"מקליד" שהלקוח רואה תואם קצב הקלדה אנושי (~18 תווים/שנייה,
#    תקרה קשיחה של 15 שניות). הזמן שהבוט כבר "חשב" (מרגע ההודעה הנכנסת) מקוזז,
#    כך שבוט איטי לא נענש פעמיים. המימוש: SendReplyJob מתוזמן מחדש עם wait —
#    אף worker לא נחסם.
#
# 2. ממסר הקלדת נציג (typing_mode='agent' — הפעלה מפורשת, ורק בשיחת בוט):
#    כשנציג אנושי מקליד ב-Chatwoot, הלקוח בוואטסאפ רואה "מקליד…". נתפס מאירוע
#    CONVERSATION_TYPING_ON של ה-dispatcher (בתוך התהליך — SafeFetch חוסם כל
#    webhook לשירות פנימי, ולכן זה יושב כאן ולא במנוע). ממודד ל-20 שניות לשיחה;
#    Meta מכבה את המחוון אחרי 25.
#
# ההגדרות נקראות מ-drip.presence_settings (ירושה: שורת תיבה ← שורת חשבון inbox_id=0
# ← ברירות מחדל). דורש GRANT SELECT לתפקיד chatwoot — migration 035 של המנוע.
# אם הסכימה לא קיימת עדיין (התקנה לפני ריצת המנוע) — הכל דומם, בלי שגיאות.
#
# Update safety: כמו הפאטצ' של הקמפיינים — בודקים שהמתודות הצפויות קיימות לפני
# שנוגעים; אם Chatwoot עתידי ישנה אותן, הפאטצ' לא מוחל ונרשמת שגיאה קולנית.
#
# Mounted read-only via docker-compose into rails + sidekiq (survives image updates).
# Created: 2026-07-27 for Chatwoot v4.16.1

module PresenceHumanizer
  CPS = 18.0          # תווים לשנייה — קלדן מהיר; מתחת לזה מרגיש זחילה
  MIN_TYPING = 2.0    # שניות "מקליד" מינימליות כשמחזיקים הודעה
  MAX_HOLD = 15.0     # תקרת עיכוב קשיחה — SLA לפני ריאליזם
  TYPING_TTL = 20     # ממסר הקלדה: לא לפנות ל-Meta יותר מפעם ב-20ש' לשיחה
  HOLD_FLAG = 'presence_hold_done'.freeze

  DEFAULTS = {
    # חייב להיות זהה לברירת המחדל של engine/src/presence.js. ברירת מחדל פעילה
    # כאן עקפה את המנוע וגרמה לחשבון/תיבה חדשים לשלוח status=read בלי שבוט חובר.
    'typing_mode' => 'off',
    'read_delay_min' => 2.0, 'read_delay_max' => 5.0,
    'typing_delay_min' => 2.0, 'typing_delay_max' => 4.0,
  }.freeze

  @typing_at = {}
  @typing_mutex = Mutex.new

  class << self
    # הגדרות בתוקף לתיבה, עם ירושה. nil ⇒ סכימת drip לא קיימת/לא נגישה — דוממים.
    def settings_for(account_id, inbox_id)
      sql = ActiveRecord::Base.sanitize_sql_array([<<~SQL.squish, account_id, inbox_id])
        SELECT typing_mode, read_delay_min, read_delay_max, typing_delay_min, typing_delay_max
          FROM drip.presence_settings
         WHERE account_id = ? AND inbox_id IN (0, ?)
         ORDER BY inbox_id DESC LIMIT 1
      SQL
      row = ActiveRecord::Base.connection.select_one(sql)
      DEFAULTS.merge(row || {})
    rescue ActiveRecord::StatementInvalid
      nil
    end

    def cloud_whatsapp?(inbox)
      inbox&.channel_type == 'Channel::Whatsapp' && inbox.channel.try(:provider) == 'whatsapp_cloud'
    end

    # אותו מודל בעלות של engine/src/presence.js: שיחה מוקצית לבוט, או בוט פעיל
    # ברמת התיבה. הקצאה לאדם תמיד גוברת. `status=0` הוא enum active בכל גרסאות
    # Chatwoot הנתמכות; משתמשים בעמודה הוותיקה כדי להישאר תואמים ל-4.16 ול-4.17+.
    def bot_connected?(conversation)
      return false if conversation.assignee_id.present?
      return true if conversation.assignee_agent_bot_id.present?

      AgentBotInbox.where(inbox_id: conversation.inbox_id, status: 0).exists?
    rescue StandardError => e
      Rails.logger.error "[presence] bot ownership check failed: #{e.class}: #{e.message}"
      false
    end

    # כמה שניות להחזיק את ההודעה. 0 ⇒ לשלוח מיד.
    def hold_seconds(message)
      return 0 unless message.outgoing? && !message.private? && message.sender_type == 'AgentBot'

      inbox = message.inbox
      return 0 unless cloud_whatsapp?(inbox)

      s = settings_for(message.account_id, message.inbox_id)
      return 0 unless s && s['typing_mode'] == 'auto'

      len = message.content.to_s.length
      return 0 if len.zero? # הודעת מדיה בלבד — אין "הקלדה" לדמות

      last_incoming = Message.where(conversation_id: message.conversation_id, message_type: :incoming)
                             .where('id < ?', message.id).order(id: :desc).first
      return 0 unless last_incoming # הבוט יזם — אף אחד לא ממתין מולו

      # ה"מקליד" של המנוע נדלק בערך read_delay+typing_delay אחרי ההודעה הנכנסת;
      # מאותו רגע הלקוח סופר. מקזזים את מה שכבר עבר (כולל זמן החשיבה של ה-LLM).
      lead = (s['read_delay_min'].to_f + s['read_delay_max'].to_f) / 2 +
             (s['typing_delay_min'].to_f + s['typing_delay_max'].to_f) / 2
      needed = (len / CPS).clamp(MIN_TYPING, MAX_HOLD)
      elapsed = Time.current - last_incoming.created_at
      (lead + needed - elapsed).clamp(0, MAX_HOLD)
    rescue StandardError => e
      Rails.logger.error "[presence] hold_seconds failed: #{e.class}: #{e.message}"
      0
    end

    # ממסר "מקליד" של נציג אנושי → Meta. רץ בתהליכון כדי לא לחסום את ה-listener.
    def relay_agent_typing(conversation)
      inbox = conversation.inbox
      return unless cloud_whatsapp?(inbox)

      s = settings_for(conversation.account_id, conversation.inbox_id)
      return unless s && s['typing_mode'] != 'off'
      # גם payload של "מקליד" כולל status=read. לכן opt-in מסוג auto או agent
      # אינו רשאי לעקוף את שער הבעלות ולסמן שיחה רגילה כנקראה.
      return unless bot_connected?(conversation)

      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      @typing_mutex.synchronize do
        last = @typing_at[conversation.id]
        return if last && now - last < TYPING_TTL

        @typing_at[conversation.id] = now
        @typing_at.clear if @typing_at.size > 5000
      end

      wamid = Message.where(conversation_id: conversation.id, message_type: :incoming)
                     .where("source_id LIKE 'wamid.%'").order(id: :desc).limit(1).pick(:source_id)
      return unless wamid

      cfg = inbox.channel.provider_config || {}
      token = cfg['api_key']
      phone_id = cfg['phone_number_id']
      return if token.blank? || phone_id.blank?

      Thread.new do
        HTTParty.post(
          "https://graph.facebook.com/v21.0/#{phone_id}/messages",
          headers: { 'Authorization' => "Bearer #{token}", 'Content-Type' => 'application/json' },
          body: {
            messaging_product: 'whatsapp', status: 'read', message_id: wamid,
            typing_indicator: { type: 'text' },
          }.to_json,
          timeout: 10
        )
      rescue StandardError => e
        Rails.logger.warn "[presence] typing relay failed conv=#{conversation.id}: #{e.message}"
      end
    rescue StandardError => e
      Rails.logger.error "[presence] relay_agent_typing failed: #{e.class}: #{e.message}"
    end
  end

  # --- עיכוב המסירה: עוטף את SendReplyJob#perform ---
  module SendReplyHold
    def perform(message_id)
      message = Message.find_by(id: message_id)
      return super if message.nil?
      return super if message.additional_attributes&.key?(PresenceHumanizer::HOLD_FLAG)

      delay = PresenceHumanizer.hold_seconds(message)
      # עיכוב קצר משנייה לא שווה סבב תזמון (ל-scheduled set של sidekiq יש רזולוציית polling).
      return super if delay < 1

      attrs = (message.additional_attributes || {}).merge(PresenceHumanizer::HOLD_FLAG => true)
      message.update_column(:additional_attributes, attrs) # rubocop:disable Rails/SkipsModelValidations
      Rails.logger.info "[presence] holding message #{message.id} for #{delay.round(1)}s (len=#{message.content.to_s.length})"
      self.class.set(wait: delay.seconds).perform_later(message_id)
    end
  end

  # --- ממסר ההקלדה: מאזין לאירועי ה-dispatcher ---
  class TypingListener
    include Singleton

    def conversation_typing_on(event)
      return if event.data[:is_private]

      user = event.data[:user]
      return unless user.is_a?(User) # הקלדת לקוח (widget/API) לא ממוסרת חזרה אליו

      conversation = event.data[:conversation]
      PresenceHumanizer.relay_agent_typing(conversation) if conversation
    end

    # Wisper מפרסם כל אירוע לכל listener — חייבים לבלוע את השאר בשקט.
    def method_missing(_name, *_args) = nil
    def respond_to_missing?(_name, _include_private = false) = true
  end

  module ListenerRegistration
    def listeners
      super + [PresenceHumanizer::TypingListener.instance]
    end
  end
end

Rails.application.config.after_initialize do
  ok = defined?(SendReplyJob) &&
       SendReplyJob.instance_method(:perform).arity == 1 &&
       defined?(AsyncDispatcher) &&
       Message.column_names.include?('additional_attributes')

  if ok
    SendReplyJob.prepend(PresenceHumanizer::SendReplyHold)
    # ה-async dispatcher מריץ מאזינים בתוך sidekiq (EventDispatcherJob) — המקום הנכון
    # לקריאת HTTP. load_listeners רץ אחר כך ב-to_prepare ואוסף גם את שלנו.
    AsyncDispatcher.prepend(PresenceHumanizer::ListenerRegistration)
    Rails.logger.info '[presence] humanizer active (hold + typing relay)'
  else
    Rails.logger.error '[presence] humanizer NOT applied — upstream methods changed; presence works without hold/relay'
  end
end
