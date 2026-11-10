# frozen_string_literal: true

require 'minitest/autorun'

# The initializer's Rails half only runs inside Chatwoot; the rules live in a plain module.
module Rails
  def self.application = Struct.new(:config).new(Struct.new(:x) { def to_prepare; end }.new)
end

require_relative '../failed_message_email'

class FailedMessageEmailTest < Minitest::Test
  Message = Struct.new(:private, :message_type, :additional_attributes)

  def test_recipients_swap_sender_and_drop_everything_that_is_not_an_address
    setting = ['sender', ' Owner@Example.com ', 'not-an-address', 'owner@example.com']
    assert_equal %w[agent@example.com owner@example.com], FailedMessageEmail.recipients(setting, 'agent@example.com')
    assert_equal %w[owner@example.com], FailedMessageEmail.recipients(setting, nil)
  end

  def test_a_saved_setting_keeps_only_sender_and_real_addresses
    sent = ['Sender', ' Owner@Example.com ', 'owner@example.com', 'javascript:alert(1)', '', nil, { 'a' => 1 }]
    assert_equal %w[sender owner@example.com], FailedMessageEmail.clean(sent)
    assert_empty FailedMessageEmail.clean(nil)
    assert_empty FailedMessageEmail.clean('owner@example.com, other@example.com')
    assert_equal FailedMessageEmail::MAX_RECIPIENTS, FailedMessageEmail.clean((1..40).map { |n| "a#{n}@example.com" }).size
  end

  def test_an_account_without_the_setting_gets_no_email
    assert_empty FailedMessageEmail.recipients(nil, 'agent@example.com')
    assert_empty FailedMessageEmail.recipients(true, 'agent@example.com')
    assert_empty FailedMessageEmail.recipients('sender', 'agent@example.com')
  end

  def test_known_meta_codes_become_a_sentence_and_unknown_errors_stay_as_sent
    assert_match(/24/, FailedMessageEmail.reason('131047: Re-engagement message', :he))
    assert_match(/24 hours/, FailedMessageEmail.reason('(#131047) Re-engagement message', :en))
    assert_equal 'Template not found', FailedMessageEmail.reason('Template not found', :he)
    assert_equal 'לא ידוע', FailedMessageEmail.reason(nil, :he)
  end

  def test_every_reason_exists_in_both_languages
    assert_equal FailedMessageEmail::REASONS[:he].keys, FailedMessageEmail::REASONS[:en].keys
  end

  def test_only_messages_a_person_sent_to_a_customer_are_reported
    assert FailedMessageEmail.reportable?(Message.new(false, 'outgoing', {}))
    assert FailedMessageEmail.reportable?(Message.new(false, 'template', nil))
    refute FailedMessageEmail.reportable?(Message.new(true, 'outgoing', {}))
    refute FailedMessageEmail.reportable?(Message.new(false, 'incoming', {}))
    refute FailedMessageEmail.reportable?(Message.new(false, 'outgoing', { 'campaign_id' => 7 }))
  end

  def test_html_escapes_customer_text_and_follows_the_account_language
    html = FailedMessageEmail.html(lang: :he, contact: '<b>דנה</b>', phone: '+972500000000', reason: 'סיבה',
                                   preview: 'שלום & תודה', url: 'https://chat.example/app/accounts/1/conversations/2')
    assert_includes html, 'dir="rtl"'
    assert_includes html, '&lt;b&gt;דנה&lt;/b&gt; · +972500000000'
    assert_includes html, 'שלום &amp; תודה'
    assert_includes html, 'href="https://chat.example/app/accounts/1/conversations/2"'
    assert_equal 'הודעה לא נשלחה אל דנה', FailedMessageEmail.subject(:he, 'דנה')
    assert_includes FailedMessageEmail.html(lang: :en, contact: 'Dana', phone: nil, reason: 'r', preview: '', url: 'u'), 'dir="ltr"'
  end
end
