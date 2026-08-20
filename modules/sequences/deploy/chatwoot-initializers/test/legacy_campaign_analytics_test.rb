# frozen_string_literal: true

require 'minitest/autorun'

class Object
  def blank?
    respond_to?(:empty?) ? !!empty? : !self
  end

  def present?
    !blank?
  end
end

module Enumerable
  def index_with
    each_with_object({}) { |key, output| output[key] = yield(key) }
  end
end

class ApplicationRecord; end
class ActiveRecord
  class Base; end
end

module Rails
  class DisabledPrepareHook
    def to_prepare; end
    def after_initialize; end
  end

  class FakeApplication
    def config
      DisabledPrepareHook.new
    end
  end

  def self.application
    FakeApplication.new
  end

  def self.logger
    @logger ||= Class.new do
      def error(*)
        nil
      end
    end.new
  end
end

load File.expand_path('../whatsapp_campaign_conversations.rb', __dir__)

class LegacyCampaignAnalyticsHarness < LegacyCampaignAnalytics417
  def initialize(rows)
    @deliveries = rows
  end
end

class LegacyCampaignAnalyticsTest < Minitest::Test
  def test_metrics_match_native_cumulative_semantics
    analytics = LegacyCampaignAnalyticsHarness.new([
      row('queued'), row('skipped'), row('sent'), row('delivered'), row('read'), row('failed')
    ])

    metrics = analytics.metrics

    assert_equal 6, metrics[:audience]
    assert_equal 3, metrics[:sent]
    assert_equal 2, metrics[:delivered]
    assert_equal 1, metrics[:read]
    assert_equal 1, metrics[:failed]
    assert_equal 1, metrics[:skipped]
    assert_equal 1, metrics[:status_counts]['queued']
  end

  def test_contacts_filter_and_paginate_in_native_shape
    rows = 27.times.map { |index| row(index.even? ? 'failed' : 'read', index: index) }
    analytics = LegacyCampaignAnalyticsHarness.new(rows)

    response = analytics.contacts(status: 'failed', page: 1)

    assert_equal 14, response[:meta][:total_count]
    assert_equal 1, response[:meta][:total_pages]
    assert_equal 14, response[:payload].length
    assert_equal 'failed', response[:payload].first[:status]
    assert_equal false, response[:payload].first[:contact][:linkable]
  end

  def test_unknown_filter_returns_all_rows_and_second_page
    analytics = LegacyCampaignAnalyticsHarness.new(27.times.map { |index| row('sent', index: index) })

    response = analytics.contacts(status: 'all', page: 2)

    assert_equal 27, response[:meta][:total_count]
    assert_equal 2, response[:meta][:total_pages]
    assert_equal 2, response[:payload].length
  end

  private

  def row(status, index: 0)
    {
      'recipient_id' => "snapshot:#{index}",
      'contact_id' => nil,
      'contact_name' => "Contact #{index}",
      'phone_number' => "+97250000#{index}",
      'status' => status,
      'message_content' => 'Hello',
      'error_code' => nil,
      'error_title' => nil,
      'error_message' => nil
    }
  end
end
