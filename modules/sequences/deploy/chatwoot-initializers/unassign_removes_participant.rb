# frozen_string_literal: true
#
# Un-assigning a conversation must also drop the ex-assignee from its participants.
#
# Core only ever adds: ParticipationListener#assignee_changed creates a participant
# row for every new assignee and returns early when the assignee is cleared
# (app/listeners/participation_listener.rb). Nothing removes it. A participant is a
# permanent notification subscription — Messages::NewMessageNotificationService
# notifies every participant on every message, and each Notification fans out to
# both channels at once (Notification#after_create_commit -> dispatch_create_event
# for the desktop/in-app badge, process_notification_delivery for the mobile push).
#
# So one self-assignment that was later undone kept delivering an alert for every
# message in that conversation, forever, on desktop and phone. Chatwoot exposes no
# setting for this and the participant row is invisible unless the agent opens the
# conversation's participant panel.
#
# 13 stale rows accumulated this way were deleted on 24.8.2026.
#
# ponytail: only a real un-assignment (assignee -> nil) clears the row. Handing a
# conversation to a colleague leaves the previous owner subscribed on purpose —
# that is a transfer, not a withdrawal. Flip the assignee_id guard to also drop
# on re-assignment if that turns out to be unwanted too.

Rails.application.config.to_prepare do
  module UnassignRemovesParticipant
    def assignee_changed(event)
      drop_participant_of_cleared_assignee(event)
      super
    end

    private

    def drop_participant_of_cleared_assignee(event)
      conversation = event.data[:conversation]
      return if conversation.blank?
      return if conversation.assignee_id.present?

      user_id = cleared_assignee_id(event)
      return if user_id.blank?

      conversation.conversation_participants.find_by(user_id: user_id)&.destroy
    rescue StandardError => e
      # never let cleanup break the assignment itself
      Rails.logger.warn "[unassign_removes_participant] conversation #{conversation&.id}: #{e.class}: #{e.message}"
    end

    # previous_changes is dispatched as changed_attributes; ActiveModel keys it
    # with strings, but accept symbols too so a caller that builds the event by
    # hand (automations, specs) is not silently skipped.
    def cleared_assignee_id(event)
      changes = event.data[:changed_attributes]
      return if changes.blank?

      pair = changes['assignee_id'] || changes[:assignee_id]
      pair.is_a?(Array) ? pair.first.presence : nil
    end
  end

  ParticipationListener.prepend(UnassignRemovesParticipant)
end
