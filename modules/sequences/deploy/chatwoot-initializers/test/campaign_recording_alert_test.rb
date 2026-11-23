# frozen_string_literal: true

# A message that reached the customer but was not recorded in a conversation raises one alert
# per campaign run, to a webhook the operator sets in the environment. The body under test is
# read from the initializer itself, not copied.

require 'minitest/autorun'
require 'json'

SOURCE = File.read(File.expand_path('../whatsapp_campaign_conversations.rb', __dir__), encoding: 'UTF-8')
ALERT_BODY = SOURCE[/        def notify_campaign_recording_failure.*?\n        end\n/m] or
  raise 'notify_campaign_recording_failure not found in the initializer'

module HTTParty
  def self.posts = (@posts ||= [])
  def self.post(url, **opts) = posts << [url, JSON.parse(opts[:body])]
end

module Rails
  def self.logger = (@logger ||= Class.new { def error(*) = nil }.new)
end

Recipients = Struct.new(:count) { def where(**) = self }
Campaign = Struct.new(:id, :display_id, :account_id, :inbox_id) do
  def campaign_recipients = Recipients.new(3)
end

class AlertingService
  def campaign = Campaign.new(41, 7, 2, 5)

  class_eval(ALERT_BODY)
end

class CampaignRecordingAlertTest < Minitest::Test
  def setup
    HTTParty.posts.clear
    ENV.delete('CAMPAIGN_ALERT_WEBHOOK_URL')
  end

  def test_no_webhook_configured_means_no_alert
    AlertingService.new.notify_campaign_recording_failure(StandardError.new('boom'))
    assert_empty HTTParty.posts
  end

  def test_alerts_once_per_campaign_run
    ENV['CAMPAIGN_ALERT_WEBHOOK_URL'] = 'https://ops.example.test/hook'
    service = AlertingService.new
    2.times { service.notify_campaign_recording_failure(StandardError.new('boom')) }

    assert_equal 1, HTTParty.posts.size
    url, body = HTTParty.posts.first
    assert_equal 'https://ops.example.test/hook', url
    assert_equal({ 'account' => 2, 'campaign' => 7, 'campaign_pk' => 41, 'inbox' => 5, 'failed_count' => 3,
                   'error' => 'StandardError: boom' }, body)
  ensure
    ENV.delete('CAMPAIGN_ALERT_WEBHOOK_URL')
  end

  def test_no_webhook_address_is_hardcoded
    refute_match %r{CAMPAIGN_ALERT_WEBHOOK_URL',\s*'https?://}, SOURCE
  end
end
