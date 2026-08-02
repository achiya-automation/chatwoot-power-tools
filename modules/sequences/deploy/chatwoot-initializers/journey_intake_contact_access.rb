# Custom initializer: allow only the per-account Drip AgentBot to create/update contacts.
#
# Chatwoot intentionally limits AgentBot API tokens to conversation operations. The external
# journey intake needs two additional writes before it can open the WhatsApp conversation:
# create a missing contact, or merge current Facebook/Airtable identifiers into an existing
# one. The exception below is deliberately narrow:
#   * AgentBot owner only
#   * the automatically provisioned Drip bot name only
#   * the bot's own account only (checked from the account_id route parameter because
#     Chatwoot validates bot endpoint access before its current_account callback runs)
#   * ContactsController#create/update only
#
# A normal user token is unchanged, and no read/list/delete endpoint is opened to bots.

module JourneyIntakeContactAccess
  DRIP_BOT_NAME = '🤖 רצפי הודעות'.freeze
  CONTACT_ACTIONS = %w[create update].freeze

  private

  def agent_bot_accessible?
    return true if journey_intake_contact_write?

    super
  end

  def journey_intake_contact_write?
    return false unless @resource.is_a?(AgentBot)
    return false unless params[:controller] == 'api/v1/accounts/contacts'
    return false unless CONTACT_ACTIONS.include?(params[:action])
    return false unless @resource.name == DRIP_BOT_NAME

    @resource.account_id.to_i == params[:account_id].to_i
  end
end

Rails.application.config.to_prepare do
  require_dependency Rails.root.join('app/controllers/concerns/access_token_auth_helper').to_s

  AccessTokenAuthHelper.prepend(JourneyIntakeContactAccess) unless AccessTokenAuthHelper.ancestors.include?(JourneyIntakeContactAccess)
end
