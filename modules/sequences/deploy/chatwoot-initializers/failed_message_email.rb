# frozen_string_literal: true
#
# Email an account's people when an outgoing message fails to send.
#
# Chatwoot marks a failed message with a small red icon inside the conversation and
# nothing else. An agent who sent a template and moved on never learns that the
# customer did not get it. This sends one short email per failed message: who it was
# for, why it failed in plain words, and a link back to the conversation.
#
# Off unless the account opts in. The setting lives on the account itself, so it can
# be switched on for one account without a deploy:
#
#   account.custom_attributes['failed_message_email'] = ['sender', 'owner@example.com']
#
# 'sender' is the agent who sent the message; any other entry is an email address.
#
# Every path that fails a message (the send job, the provider's status webhook) ends
# in a Message update, and both run in Sidekiq, so one after_update_commit covers
# them all. Campaign messages are skipped: a broadcast can fail by the hundreds and
# has its own analytics screen.
#
# ponytail: a flat cap of 30 emails per account per hour; anything above it is dropped,
# not queued. Switch to a digest if an account ever needs more than that.

module FailedMessageEmail
  SETTING = 'failed_message_email'
  HOURLY_CAP = 30
  EMAIL = /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/

  # Meta's WhatsApp error codes in words an agent can act on.
  REASONS = {
    he: {
      130_429 => 'המספר הגיע למגבלת הקצב של מטא. אפשר לנסות שוב בעוד כמה דקות.',
      130_472 => 'המספר של הנמען נמצא בניסוי של מטא ולא מקבל כרגע הודעות שיווק.',
      131_026 => 'למספר הזה אין וואטסאפ פעיל, או שהוא לא יכול לקבל את ההודעה.',
      131_042 => 'יש בעיית תשלום בחשבון הוואטסאפ העסקי במטא.',
      131_047 => 'עברו יותר מ-24 שעות מההודעה האחרונה של הלקוח. אפשר לשלוח לו רק הודעת תבנית.',
      131_048 => 'מטא הגבילה את קצב השליחה מהמספר. אפשר לנסות שוב מאוחר יותר.',
      131_049 => 'מטא החליטה לא למסור את ההודעה, כדי לא להעמיס על הנמען הודעות שיווק. אפשר לנסות שוב מחר.',
      131_050 => 'הנמען ביקש לא לקבל הודעות שיווק.',
      131_053 => 'מטא לא הצליחה להוריד את הקובץ המצורף.',
      131_056 => 'נשלחו יותר מדי הודעות למספר הזה בזמן קצר. אפשר לנסות שוב בעוד כמה דקות.',
      132_000 => 'הפרטים שמולאו בתבנית לא תואמים למה שהתבנית מצפה לקבל.',
      132_001 => 'התבנית לא קיימת או עדיין לא אושרה במטא.',
      132_012 => 'הפרטים שמולאו בתבנית לא תואמים למה שהתבנית מצפה לקבל.',
      132_015 => 'התבנית מושהית אצל מטא בגלל איכות נמוכה.',
      132_016 => 'התבנית הושבתה אצל מטא בגלל איכות נמוכה.'
    },
    en: {
      130_429 => 'The number hit Meta\'s rate limit. Try again in a few minutes.',
      130_472 => 'The recipient\'s number is part of a Meta experiment and gets no marketing messages for now.',
      131_026 => 'This number has no active WhatsApp, or cannot receive the message.',
      131_042 => 'There is a payment problem on the WhatsApp Business account at Meta.',
      131_047 => 'More than 24 hours passed since the customer\'s last message. Only a template message can be sent.',
      131_048 => 'Meta limited the sending rate of this number. Try again later.',
      131_049 => 'Meta chose not to deliver the message, to spare the recipient more marketing messages. Try again tomorrow.',
      131_050 => 'The recipient asked not to receive marketing messages.',
      131_053 => 'Meta could not download the attached file.',
      131_056 => 'Too many messages were sent to this number in a short time. Try again in a few minutes.',
      132_000 => 'The values filled into the template do not match what the template expects.',
      132_001 => 'The template does not exist or is not approved by Meta yet.',
      132_012 => 'The values filled into the template do not match what the template expects.',
      132_015 => 'The template is paused by Meta because of low quality.',
      132_016 => 'The template was disabled by Meta because of low quality.'
    }
  }.freeze

  TEXT = {
    he: { subject: 'הודעה לא נשלחה אל %s', title: 'הודעה לא נשלחה', to: 'אל', why: 'הסיבה',
          message: 'ההודעה', open: 'פתיחת השיחה', unknown: 'לא ידוע', dir: 'rtl' },
    en: { subject: 'A message to %s was not sent', title: 'A message was not sent', to: 'To', why: 'Reason',
          message: 'Message', open: 'Open the conversation', unknown: 'Unknown', dir: 'ltr' }
  }.freeze

  module_function

  # Addresses to notify: the setting's emails, with 'sender' replaced by the sending agent.
  def recipients(setting, sender_email)
    return [] unless setting.is_a?(Array)

    setting.map { |entry| entry.to_s.strip.casecmp('sender').zero? ? sender_email.to_s : entry.to_s.strip }
           .select { |address| address.match?(EMAIL) }
           .map(&:downcase).uniq
  end

  def language(locale)
    locale.to_s.start_with?('he') ? :he : :en
  end

  # The provider's error as a sentence. Unknown codes fall back to the provider's own text.
  def reason(error, lang)
    text = error.to_s.strip
    code = text[/\A\(?#?(\d{5,6})/, 1].to_i
    REASONS[lang][code] || (text.empty? ? TEXT[lang][:unknown] : text)
  end

  def escape(value)
    value.to_s.gsub('&', '&amp;').gsub('<', '&lt;').gsub('>', '&gt;').gsub('"', '&quot;')
  end

  def subject(lang, contact)
    format(TEXT[lang][:subject], contact)
  end

  def html(lang:, contact:, phone:, reason:, preview:, url:)
    words = TEXT[lang]
    who = [contact, phone].map(&:to_s).reject(&:empty?).uniq.join(' · ')
    row = lambda do |label, value|
      next '' if value.to_s.empty?

      "<p style=\"margin:0 0 14px\"><span style=\"color:#6b7280;font-size:13px\">#{escape(label)}</span><br>" \
        "<span style=\"font-size:16px\">#{escape(value)}</span></p>"
    end
    <<~HTML
      <div dir="#{words[:dir]}" style="font-family:Arial,Helvetica,sans-serif;color:#111827;max-width:520px;margin:0 auto;padding:24px">
        <h1 style="font-size:20px;margin:0 0 20px">#{escape(words[:title])}</h1>
        #{row.call(words[:to], who)}
        #{row.call(words[:why], reason)}
        #{row.call(words[:message], preview)}
        <p style="margin:24px 0 0"><a href="#{escape(url)}" style="background:#1f93ff;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:15px;display:inline-block">#{escape(words[:open])}</a></p>
      </div>
    HTML
  end

  # True for a message a person sent to a customer: outgoing, visible, not part of a broadcast.
  def reportable?(message)
    return false if message.private
    return false unless %w[outgoing template].include?(message.message_type.to_s)

    (message.additional_attributes || {})['campaign_id'].to_s.empty?
  end
end

Rails.application.config.to_prepare do
  class FailedMessageMailer < ActionMailer::Base
    def notice(to, subject, html)
      mail(from: ENV.fetch('MAILER_SENDER_EMAIL', 'Chatwoot <accounts@chatwoot.com>'),
           to: to, subject: subject, content_type: 'text/html', body: html)
    end
  end

  module FailedMessageEmailHook
    def email_failed_message
      return unless FailedMessageEmail.reportable?(self)

      setting = account.custom_attributes&.dig(FailedMessageEmail::SETTING)
      sender_email = sender.is_a?(User) ? sender.email : nil
      to = FailedMessageEmail.recipients(setting, sender_email)
      return if to.empty?
      return if failed_message_email_capped?

      lang = FailedMessageEmail.language(account.locale)
      contact = conversation.contact
      name = contact&.name.presence || contact&.phone_number.presence || FailedMessageEmail::TEXT[lang][:unknown]
      body = FailedMessageEmail.html(
        lang: lang, contact: name, phone: contact&.phone_number,
        reason: FailedMessageEmail.reason(external_error, lang),
        preview: content.to_s.truncate(300),
        url: "#{ENV.fetch('FRONTEND_URL', '').chomp('/')}/app/accounts/#{account_id}/conversations/#{conversation.display_id}"
      )
      FailedMessageMailer.notice(to, FailedMessageEmail.subject(lang, name), body).deliver_later
    rescue StandardError => e
      # a notice must never break the status update it reports on
      Rails.logger.warn "[failed_message_email] message #{id}: #{e.class}"
    end

    private

    def failed_message_email_capped?
      key = "cwpt:failed_message_email:#{account_id}:#{Time.now.utc.strftime('%Y%m%d%H')}"
      count = ::Redis::Alfred.incr(key)
      ::Redis::Alfred.expire(key, 2 * 60 * 60) if count == 1
      count > FailedMessageEmail::HOURLY_CAP
    end
  end

  unless Message.include?(FailedMessageEmailHook)
    Message.include(FailedMessageEmailHook)
    Message.after_update_commit :email_failed_message, if: -> { saved_change_to_status? && failed? }
  end
end
