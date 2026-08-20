# frozen_string_literal: true

require 'minitest/autorun'

class Hash
  def stringify_keys
    each_with_object({}) { |(key, value), output| output[key.to_s] = value }
  end
end

class Object
  def blank?
    respond_to?(:empty?) ? !!empty? : !self
  end
end

class AgentBot
  attr_reader :name, :account_id

  def initialize(name:, account_id:)
    @name = name
    @account_id = account_id
  end
end

module Rails
  class DisabledPrepareHook
    def to_prepare; end
  end

  class FakeApplication
    def config
      DisabledPrepareHook.new
    end
  end

  def self.application
    FakeApplication.new
  end
end

load File.expand_path('../journey_intake_contact_access.rb', __dir__)

class ContactAccessHarness
  def initialize(resource:, params:)
    @resource = resource
    @params = params
  end

  def params
    @params
  end

  def agent_bot_accessible?
    false
  end

  prepend JourneyIntakeContactAccess
end

class JourneyIntakeContactAccessTest < Minitest::Test
  DRIP_BOT_NAME = '🤖 רצפי הודעות'

  def setup
    @bot = AgentBot.new(name: DRIP_BOT_NAME, account_id: 14)
  end

  def test_allows_contact_create_and_update_for_matching_bot_and_account
    assert_access(action: 'create')
    assert_access(action: 'update')
  end

  def test_allows_only_one_exact_phone_filter
    assert_access(action: 'filter', payload: [phone_predicate])
  end

  def test_rejects_other_contact_reads
    refute_access(action: 'index')
    refute_access(action: 'search')
    refute_access(action: 'show')
    refute_access(action: 'destroy')
  end

  def test_rejects_non_phone_or_non_exact_predicates
    refute_access(action: 'filter', payload: [phone_predicate.merge('attribute_key' => 'email')])
    refute_access(action: 'filter', payload: [phone_predicate.merge('filter_operator' => 'contains')])
    refute_access(action: 'filter', payload: [phone_predicate.merge('values' => ['+972501234567', '+972509876543'])])
    refute_access(action: 'filter', payload: [phone_predicate.merge('values' => ['not-a-phone'])])
    refute_access(action: 'filter', payload: [phone_predicate.merge('values' => [972501234567])])
  end

  def test_rejects_extra_predicates_or_keys
    refute_access(action: 'filter', payload: [phone_predicate, phone_predicate])
    refute_access(action: 'filter', payload: [phone_predicate.merge('query_operator' => 'and')])
  end

  def test_requires_contact_inboxes_to_be_excluded
    refute access_for(action: 'filter', payload: [phone_predicate], include_contact_inboxes: 'true')
    refute access_for(action: 'filter', payload: [phone_predicate], include_contact_inboxes: nil)
  end

  def test_rejects_wrong_bot_account_or_controller
    refute access_for(action: 'filter', payload: [phone_predicate], account_id: 15)

    other_bot = AgentBot.new(name: 'Other bot', account_id: 14)
    refute access_for(action: 'filter', payload: [phone_predicate], resource: other_bot)

    refute access_for(action: 'filter', payload: [phone_predicate], controller: 'api/v1/accounts/conversations')
  end

  private

  def phone_predicate
    {
      'attribute_key' => 'phone_number',
      'filter_operator' => 'equal_to',
      'values' => ['+972501234567'],
      'attribute_model' => 'standard',
      'custom_attribute_type' => ''
    }
  end

  def assert_access(**options)
    assert access_for(**options)
  end

  def refute_access(**options)
    refute access_for(**options)
  end

  def access_for(action:, payload: nil, account_id: 14, controller: 'api/v1/accounts/contacts', resource: @bot,
                 include_contact_inboxes: 'false')
    request_params = {
      controller: controller,
      action: action,
      account_id: account_id,
      include_contact_inboxes: include_contact_inboxes
    }
    request_params[:payload] = payload unless payload.nil?

    ContactAccessHarness.new(resource: resource, params: request_params).send(:agent_bot_accessible?)
  end
end
