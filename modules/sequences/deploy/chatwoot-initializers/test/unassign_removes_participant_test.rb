# frozen_string_literal: true

require 'minitest/autorun'

class Object
  def blank?
    respond_to?(:empty?) ? !!empty? : !self
  end

  def present?
    !blank?
  end

  def presence
    self if present?
  end
end

module Rails
  class Logger
    attr_reader :warnings

    def initialize = @warnings = []
    def warn(message) = @warnings << message
  end

  class Config
    def to_prepare(&block) = block.call
  end

  class App
    def config = Config.new
  end

  def self.application = App.new
  def self.logger = (@logger ||= Logger.new)
end

# --- doubles -----------------------------------------------------------------

class FakeParticipants
  attr_reader :user_ids, :destroyed

  def initialize(user_ids, raise_on_find: false)
    @user_ids = user_ids
    @destroyed = []
    @raise_on_find = raise_on_find
  end

  def find_by(user_id:)
    raise 'db exploded' if @raise_on_find

    Participant.new(self, user_id) if @user_ids.include?(user_id)
  end

  def record_destroy(user_id)
    @user_ids.delete(user_id)
    @destroyed << user_id
  end
end

class Participant
  def initialize(collection, user_id)
    @collection = collection
    @user_id = user_id
  end

  def destroy = @collection.record_destroy(@user_id)
end

class FakeConversation
  attr_reader :id, :assignee_id, :conversation_participants

  def initialize(id:, assignee_id:, participant_ids:, raise_on_find: false)
    @id = id
    @assignee_id = assignee_id
    @conversation_participants = FakeParticipants.new(participant_ids, raise_on_find: raise_on_find)
  end
end

Event = Struct.new(:data)

# Core's listener: adds on assign, never removes.
class ParticipationListener
  attr_reader :super_calls

  def initialize = @super_calls = []

  def assignee_changed(event)
    @super_calls << event
    conversation = event.data[:conversation]
    return if conversation.nil? || conversation.assignee_id.nil?

    conversation.conversation_participants.user_ids << conversation.assignee_id
  end
end

load File.expand_path('../unassign_removes_participant.rb', __dir__)

# --- tests -------------------------------------------------------------------

class UnassignRemovesParticipantTest < Minitest::Test
  def build(assignee_id:, participants:, changes:, raise_on_find: false)
    conversation = FakeConversation.new(id: 7, assignee_id: assignee_id, participant_ids: participants,
                                        raise_on_find: raise_on_find)
    [conversation, Event.new({ conversation: conversation, changed_attributes: changes })]
  end

  def run_listener(event)
    listener = ParticipationListener.new
    listener.assignee_changed(event)
    listener
  end

  def test_unassignment_removes_the_previous_assignee
    conversation, event = build(assignee_id: nil, participants: [1, 5], changes: { 'assignee_id' => [1, nil] })
    run_listener(event)

    assert_equal [1], conversation.conversation_participants.destroyed
    assert_equal [5], conversation.conversation_participants.user_ids
  end

  def test_symbol_keyed_changes_are_honoured
    conversation, event = build(assignee_id: nil, participants: [1], changes: { assignee_id: [1, nil] })
    run_listener(event)

    assert_equal [1], conversation.conversation_participants.destroyed
  end

  def test_reassignment_to_a_colleague_keeps_the_previous_owner
    conversation, event = build(assignee_id: 2, participants: [1], changes: { 'assignee_id' => [1, 2] })
    run_listener(event)

    assert_empty conversation.conversation_participants.destroyed
  end

  def test_fresh_assignment_still_adds_the_participant
    conversation, event = build(assignee_id: 3, participants: [], changes: { 'assignee_id' => [nil, 3] })
    run_listener(event)

    assert_empty conversation.conversation_participants.destroyed
    assert_equal [3], conversation.conversation_participants.user_ids
  end

  def test_missing_changed_attributes_is_a_no_op
    conversation, event = build(assignee_id: nil, participants: [1], changes: nil)
    run_listener(event)

    assert_empty conversation.conversation_participants.destroyed
  end

  def test_unassignment_without_a_previous_assignee_is_a_no_op
    conversation, event = build(assignee_id: nil, participants: [1], changes: { 'assignee_id' => [nil, nil] })
    run_listener(event)

    assert_empty conversation.conversation_participants.destroyed
  end

  def test_blank_conversation_does_not_raise
    event = Event.new({ conversation: nil, changed_attributes: { 'assignee_id' => [1, nil] } })
    listener = run_listener(event)

    assert_equal 1, listener.super_calls.size
  end

  def test_a_failing_cleanup_is_logged_and_still_runs_core
    _conversation, event = build(assignee_id: nil, participants: [1], changes: { 'assignee_id' => [1, nil] },
                                 raise_on_find: true)
    listener = run_listener(event)

    assert_equal 1, listener.super_calls.size
    assert_match(/db exploded/, Rails.logger.warnings.last)
  end
end
