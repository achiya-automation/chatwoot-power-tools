# frozen_string_literal: true

require 'minitest/autorun'

# ── Rails / Chatwoot stubs ───────────────────────────────────────────────────
# The initializer's to_prepare block is disabled here: the real one prepends onto
# Macros::ExecutionService, which does not exist outside a Rails boot. The harness below
# prepends the module onto a fake service instead, which is what we actually want to test.
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

load File.expand_path('../macro_agent_bot_actions.rb', __dir__)

# Minimal stand-in for the conversation row the action mutates.
class FakeConversation
  attr_accessor :assignee_agent_bot_id, :assignee_agent_bot
  attr_reader :saves

  def initialize(bot_id: nil)
    @assignee_agent_bot_id = bot_id
    @assignee_agent_bot = bot_id
    @saves = 0
  end

  def save!
    @saves += 1
    # mirror ActiveRecord: writing the association keeps the id column in step
    @assignee_agent_bot_id = @assignee_agent_bot
    true
  end
end

# Records what Chatwoot's own AssignmentService would have been asked to do.
module Conversations
  class AssignmentService
    class << self
      attr_accessor :calls
    end
    self.calls = []

    def initialize(conversation:, assignee_id:, assignee_type: nil)
      @args = { conversation: conversation, assignee_id: assignee_id, assignee_type: assignee_type }
    end

    def perform
      self.class.calls << @args
      :assigned
    end
  end
end

# Stands in for Macros::ExecutionService: `super` here is Chatwoot's stock assign_agent, which
# we only need to observe (it must still receive every non-bot value untouched).
class MacroHarness
  attr_reader :conversation, :super_calls

  def initialize(conversation)
    @conversation = conversation
    @super_calls = []
    # the patched module reads @conversation, same as ActionService
    @conversation = conversation
  end

  def assign_agent(agent_ids = [])
    @super_calls << agent_ids
    :stock
  end

  prepend MacroAgentBotActions
end

class MacroAgentBotActionsTest < Minitest::Test
  def setup
    Conversations::AssignmentService.calls = []
    @conv = FakeConversation.new(bot_id: 12)
    @svc = MacroHarness.new(@conv)
    @svc.instance_variable_set(:@conversation, @conv)
  end

  # ── assign_agent: the encoded shape the macro editor produces ──

  def test_encoded_agent_bot_is_routed_to_the_assignment_service
    @svc.assign_agent(['AgentBot:12'])
    calls = Conversations::AssignmentService.calls
    assert_equal 1, calls.length
    assert_equal 12, calls[0][:assignee_id]
    assert_equal 'AgentBot', calls[0][:assignee_type]
    assert_empty @svc.super_calls, 'must not fall through to the stock implementation'
  end

  def test_non_bot_values_still_reach_chatwoots_own_implementation
    # This is the regression that matters: intercepting too eagerly would break every ordinary
    # "assign to agent" macro in the instance.
    [['nil'], ['self'], ['last_responding_agent'], [7], ['7'], [], [nil]].each do |ids|
      @svc.super_calls.clear
      @svc.assign_agent(ids)
      assert_equal [ids], @svc.super_calls, "#{ids.inspect} should pass through"
    end
    assert_empty Conversations::AssignmentService.calls
  end

  def test_malformed_encoded_ids_pass_through_rather_than_assigning_bot_zero
    [['AgentBot:'], ['AgentBot:abc'], ['AgentBot:0'], ['AgentBot:-3']].each do |ids|
      @svc.super_calls.clear
      @svc.assign_agent(ids)
      assert_equal [ids], @svc.super_calls, "#{ids.inspect} should pass through"
    end
    assert_empty Conversations::AssignmentService.calls
  end

  # ── remove_specific_agent_bot: absent from Chatwoot entirely ──

  def test_detaches_the_attached_bot
    @svc.remove_specific_agent_bot([12])
    assert_nil @conv.assignee_agent_bot
    assert_nil @conv.assignee_agent_bot_id
    assert_equal 1, @conv.saves
  end

  def test_accepts_the_id_as_a_string_too
    @svc.remove_specific_agent_bot(['12'])
    assert_nil @conv.assignee_agent_bot_id
  end

  def test_does_not_detach_a_different_bot
    # A macro naming bot 99 must leave bot 12 alone — otherwise a stale macro silently
    # unhooks whichever bot happens to be handling the conversation now.
    @svc.remove_specific_agent_bot([99])
    assert_equal 12, @conv.assignee_agent_bot_id
    assert_equal 0, @conv.saves
  end

  def test_is_a_noop_when_no_bot_is_attached
    conv = FakeConversation.new(bot_id: nil)
    svc = MacroHarness.new(conv)
    svc.instance_variable_set(:@conversation, conv)
    svc.remove_specific_agent_bot([12])
    assert_equal 0, conv.saves
  end

  def test_ignores_empty_or_junk_params
    [[], [nil], [''], ['abc'], [0]].each do |params|
      @conv.assignee_agent_bot_id = 12
      @conv.assignee_agent_bot = 12
      @svc.remove_specific_agent_bot(params)
      assert_equal 12, @conv.assignee_agent_bot_id, "#{params.inspect} should be a no-op"
    end
  end
end
