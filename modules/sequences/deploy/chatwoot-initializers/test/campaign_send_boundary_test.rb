# frozen_string_literal: true

# ‏send_whatsapp_template_message שולח, מסמן את הנמען, ורק אז רושם את השיחה. הרישום נעשה
# אחרי שההודעה כבר יצאה ללקוח, ולכן חייב גבול שגיאות משלו: rescue אחד שעוטף גם את השליחה
# וגם את הרישום היה מסמן mark_failed! נמען שכבר קיבל mark_sent!, כלומר הודעה שנמסרה מופיעה
# בדוח ככישלון — ו"שליחה מחדש לנכשלים" הייתה שולחת אותה שוב לאותו אדם.
#
# הבדיקה מריצה את הגוף האמיתי מתוך הקובץ (לא העתק שלו), מול כפילים מינימליים.

require 'minitest/autorun'

SOURCE = File.expand_path('../whatsapp_campaign_conversations.rb', __dir__)

# חילוץ הגוף של המתודה מהקובץ עצמו, כדי שהבדיקה תיפול אם מישהו יחזיר את הסדר הישן.
# ‏encoding מפורש: File.read הולך לפי ה-locale, ובסביבה שאינה UTF-8 הקובץ (שיש בו
# עברית) נקרא כ-US-ASCII וכל התאמת regex זורקת invalid byte sequence.
BODY = File.read(SOURCE, encoding: 'UTF-8')[/def send_whatsapp_template_message.*?\n  end\n/m] or
  raise 'send_whatsapp_template_message not found in the initializer'

# ‏blank?/present? הם ActiveSupport, לא Ruby — בלעדיהם הגוף האמיתי זורק NoMethodError
# ונופל ל-rescue החיצוני, והבדיקה הייתה "עוברת" מסיבה שגויה.
class Object
  def blank? = respond_to?(:empty?) ? !!empty? : !self
  def present? = !blank?
end
class NilClass; def blank? = true; end

class Recipient
  attr_reader :id, :marks, :contact
  def initialize = (@id = 1; @marks = []; @contact = Object.new)
  def mark_skipped!(_reason) = @marks << :skipped
  def mark_sent!(_source_id) = @marks << :sent
  def mark_failed!(_payload = nil) = @marks << :failed
end

class FakeLogger
  attr_reader :errors
  def initialize = @errors = []
  def error(message) = @errors << message
end

module Rails
  def self.logger = (@logger ||= FakeLogger.new)
  def self.reset_logger! = @logger = FakeLogger.new
end

class Processor
  def initialize(**) = nil
  def call = ['tpl', 'ns', 'he', []]
end

module Whatsapp; TemplateProcessorService = Processor; end

# נושא המתודה: מספק את כל מה שהגוף האמיתי קורא לו.
class Sender
  attr_reader :recorded
  def initialize(record_raises:) = (@record_raises = record_raises; @recorded = false)
  def channel = self
  def send_template(*) = 'wamid.TEST'
  def template_info(*) = {}
  def append_carousel_component(_name, _lang, params) = params
  def update_recipient_from_provider_response(recipient, source_id)
    source_id.to_s.empty? ? recipient.mark_failed! : recipient.mark_sent!(source_id)
  end

  def create_campaign_conversation_and_message(*)
    raise StandardError, 'recording blew up' if @record_raises

    @recorded = true
  end

  class_eval(BODY.sub('def send_whatsapp_template_message', 'def send_whatsapp_template_message'))
  public :send_whatsapp_template_message
end

class CampaignSendBoundaryTest < Minitest::Test
  def setup = Rails.reset_logger!

  def test_successful_send_and_recording_marks_sent_only
    s = Sender.new(record_raises: false)
    r = Recipient.new
    s.send_whatsapp_template_message(recipient: r, to: '972500000000', template_params: {})
    assert_equal [:sent], r.marks
    assert s.recorded
  end

  def test_recording_failure_never_rewrites_a_delivered_send_as_failed
    s = Sender.new(record_raises: true)
    r = Recipient.new
    s.send_whatsapp_template_message(recipient: r, to: '972500000000', template_params: {})
    assert_equal [:sent], r.marks, 'נמען שההודעה נמסרה אליו סומן ככישלון בגלל כשל ברישום'
    refute_empty Rails.logger.errors, 'כשל ברישום חייב להישאר בלוג'
    assert_match(/recording failed after a successful send/, Rails.logger.errors.first)
  end
end
