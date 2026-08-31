# frozen_string_literal: true

require 'minitest/autorun'
require 'singleton'

class Object
  def present?
    !nil? && (!respond_to?(:empty?) || !empty?)
  end
end

module Rails
  class DisabledInitializerHook
    def after_initialize; end
  end

  class FakeApplication
    def config
      DisabledInitializerHook.new
    end
  end

  def self.application
    FakeApplication.new
  end

  def self.logger
    @logger ||= Object.new.tap do |logger|
      logger.define_singleton_method(:error) { |*_args| nil }
    end
  end
end

class AgentBotInbox
  class << self
    attr_accessor :active_for_inbox

    def where(inbox_id:, status:)
      raise 'wrong status' unless status.zero?

      result = active_for_inbox == inbox_id
      Object.new.tap { |relation| relation.define_singleton_method(:exists?) { result } }
    end
  end
end

class Message
  class << self
    attr_accessor :query_attempted

    def where(*)
      self.query_attempted = true
      raise 'message lookup must not run without a connected bot'
    end
  end
end

load File.expand_path('../presence_humanizer.rb', __dir__)

class PresenceHumanizerTest < Minitest::Test
  Conversation = Struct.new(:inbox_id, :assignee_id, :assignee_agent_bot_id)

  def setup
    AgentBotInbox.active_for_inbox = nil
    Message.query_attempted = false
  end

  def test_default_typing_is_fail_closed
    assert_equal 'off', PresenceHumanizer::DEFAULTS['typing_mode']
  end

  def test_explicit_conversation_bot_is_connected
    conversation = Conversation.new(38, nil, 12)
    assert PresenceHumanizer.bot_connected?(conversation)
  end

  def test_active_inbox_bot_is_connected_for_an_unassigned_conversation
    AgentBotInbox.active_for_inbox = 30
    conversation = Conversation.new(30, nil, nil)
    assert PresenceHumanizer.bot_connected?(conversation)
  end

  def test_human_assignment_wins_over_both_bot_paths
    AgentBotInbox.active_for_inbox = 30
    conversation = Conversation.new(30, 62, 11)
    refute PresenceHumanizer.bot_connected?(conversation)
  end

  def test_no_bot_fails_closed
    conversation = Conversation.new(49, nil, nil)
    refute PresenceHumanizer.bot_connected?(conversation)
  end

  def test_agent_typing_stops_before_message_lookup_without_a_connected_bot
    conversation = Struct.new(:id, :account_id, :inbox_id, :inbox).new(900, 11, 38, Object.new)
    singleton = PresenceHumanizer.singleton_class
    originals = %i[cloud_whatsapp? settings_for bot_connected?].to_h do |name|
      [name, PresenceHumanizer.method(name)]
    end

    singleton.define_method(:cloud_whatsapp?) { |_inbox| true }
    singleton.define_method(:settings_for) { |_account_id, _inbox_id| { 'typing_mode' => 'agent' } }
    singleton.define_method(:bot_connected?) { |_conversation| false }

    PresenceHumanizer.relay_agent_typing(conversation)

    refute Message.query_attempted
  ensure
    originals&.each { |name, implementation| singleton.define_method(name, implementation) }
  end
end
