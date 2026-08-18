# Custom initializer: make the two AgentBot macro actions actually work.
#
# Chatwoot's macro EDITOR offers both of these — see
# app/javascript/dashboard/routes/dashboard/settings/macros/constants.js (MACRO_ACTION_TYPES
# lists `remove_specific_agent_bot`) and composables/useMacros.js (`assign_agent` deliberately
# encodes bots as the string "AgentBot:<id>" via botOptions({ encodedId: true })). Neither has a
# server-side implementation in 4.16.2, so a macro built from the UI silently does nothing:
#
#   * assign_agent(["AgentBot:12"]) — ActionService#agent_belongs_to_inbox? compares that STRING
#     against an array of integer user ids, gets false, and returns early. No error, no change.
#   * remove_specific_agent_bot([12]) — no method by that name exists anywhere in app/, so
#     Macros::ExecutionService#perform raises NoMethodError directly into its own
#     `rescue StandardError` and posts it to the exception tracker. No error reaches the agent.
#
# The consequence is not cosmetic. `assignee_agent_bot` is what actually routes events to a
# webhook bot: AgentBotListener#agent_bots_for pushes every message to
# `conversation.assignee_agent_bot` regardless of whether the inbox-level AgentBotInbox is
# active. A conversation an agent believes they "took over" keeps the bot attached, and the bot
# keeps answering the customer underneath them.
#
# Why this is a macro patch and not a dashboard button: macros are the only conversation action
# surface the Chatwoot MOBILE app exposes. A DASHBOARD_SCRIPTS injection reaches the web
# dashboard only, so the fix has to live server-side to be usable from a phone.
#
# Scope: Macros::ExecutionService only. Automation rules are untouched — their action list is
# separate and does not offer these two actions, so widening the patch would add behaviour
# nobody configured.
#
# Both actions are deliberately narrow:
#   * assign_agent falls through to Chatwoot's own implementation for every non-bot value
#     ('nil', 'self', 'last_responding_agent', plain user ids) — only the "AgentBot:<id>" shape
#     is intercepted.
#   * remove_specific_agent_bot detaches ONLY when the named bot is the one currently attached,
#     so a macro naming bot A cannot detach bot B.
#   * Neither changes status or human assignee. Chatwoot macros already compose — an operator
#     who also wants "assign to me" or "mark open" adds those as further actions in the same
#     macro, which is exactly how the built-in actions are meant to be combined.

module MacroAgentBotActions
  AGENT_BOT_PREFIX = 'AgentBot:'.freeze

  # Intercept only the encoded-bot shape the macro editor produces; everything else is Chatwoot's.
  def assign_agent(agent_ids = [])
    bot_id = macro_encoded_agent_bot_id(agent_ids)
    return super if bot_id.nil?

    assign_conversation_to_agent_bot(bot_id)
  end

  # Detach a specific bot from this conversation. Missing entirely from ActionService in 4.16.2.
  def remove_specific_agent_bot(action_params = [])
    bot_id = Array(action_params).first.to_i
    return if bot_id.zero?
    # Only the currently attached bot may be removed — a stale macro must not detach a
    # different bot that happens to be handling the conversation now.
    return unless @conversation.assignee_agent_bot_id == bot_id

    @conversation.assignee_agent_bot = nil
    @conversation.save!
  end

  private

  def macro_encoded_agent_bot_id(agent_ids)
    raw = Array(agent_ids).first.to_s
    return nil unless raw.start_with?(AGENT_BOT_PREFIX)

    id = raw.delete_prefix(AGENT_BOT_PREFIX).to_i
    id.positive? ? id : nil
  end

  # Reuse Chatwoot's own service rather than writing the association here: it clears the human
  # assignee, scopes the bot with AgentBot.accessible_to(account), and returns nil for a bot the
  # account may not use — the same path POST conversations/:id/assignments takes.
  def assign_conversation_to_agent_bot(bot_id)
    Conversations::AssignmentService.new(
      conversation: @conversation,
      assignee_id: bot_id,
      assignee_type: 'AgentBot'
    ).perform
  end
end

Rails.application.config.to_prepare do
  require_dependency Rails.root.join('app/services/macros/execution_service').to_s

  unless Macros::ExecutionService.ancestors.include?(MacroAgentBotActions)
    Macros::ExecutionService.prepend(MacroAgentBotActions)
  end
end
