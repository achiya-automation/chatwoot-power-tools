# Custom initializer: allow only the per-account Drip AgentBot to write contacts or look one
# up by an exact phone number.
#
# Chatwoot intentionally limits AgentBot API tokens to conversation operations. The external
# journey intake needs two additional writes before it can open the WhatsApp conversation:
# create a missing contact, or merge current Facebook/Airtable identifiers into an existing
# one. Make's official-WhatsApp no-answer scenario also needs to resolve the already-existing
# contact before posting one approved template. The exceptions below are deliberately narrow:
#   * AgentBot owner only
#   * the automatically provisioned Drip bot name only
#   * the bot's own account only (checked from the account_id route parameter because
#     Chatwoot validates bot endpoint access before its current_account callback runs)
#   * ContactsController#create/update only
#   * ContactsController#filter only for one exact, syntactically valid phone-number predicate
#
# A normal user token is unchanged. No list/search/show/delete endpoint is opened to bots, and
# the filter exception rejects every field/operator other than an exact phone number.

module JourneyIntakeContactAccess
  DRIP_BOT_NAME = '🤖 רצפי הודעות'.freeze
  CONTACT_WRITE_ACTIONS = %w[create update].freeze
  EXACT_PHONE_FILTER_KEYS = %w[attribute_key filter_operator values attribute_model custom_attribute_type].freeze
  E164_PHONE_PATTERN = /\A\+[1-9]\d{7,14}\z/

  private

  def agent_bot_accessible?
    return true if journey_intake_contact_write?
    return true if journey_intake_exact_phone_filter?

    super
  end

  def journey_intake_contact_write?
    drip_agent_bot_for_account? && CONTACT_WRITE_ACTIONS.include?(params[:action])
  end

  def journey_intake_exact_phone_filter?
    return false unless drip_agent_bot_for_account?
    return false unless params[:action] == 'filter'
    return false unless params[:include_contact_inboxes] == 'false'

    payload = params[:payload]
    return false unless payload.is_a?(Array) && payload.length == 1

    predicate = payload.first
    return false unless predicate.respond_to?(:to_unsafe_h) || predicate.is_a?(Hash)

    predicate = predicate.to_unsafe_h if predicate.respond_to?(:to_unsafe_h)
    predicate = predicate.stringify_keys
    return false unless predicate.keys.sort == EXACT_PHONE_FILTER_KEYS.sort
    return false unless predicate['attribute_key'] == 'phone_number'
    return false unless predicate['filter_operator'] == 'equal_to'
    return false unless predicate['attribute_model'] == 'standard'
    return false unless predicate['custom_attribute_type'].blank?

    values = predicate['values']
    values.is_a?(Array) && values.length == 1 && values.first.is_a?(String) && values.first.match?(E164_PHONE_PATTERN)
  end

  def drip_agent_bot_for_account?
    return false unless @resource.is_a?(AgentBot)
    return false unless params[:controller] == 'api/v1/accounts/contacts'
    return false unless @resource.name == DRIP_BOT_NAME

    @resource.account_id.to_i == params[:account_id].to_i
  end
end

Rails.application.config.to_prepare do
  require_dependency Rails.root.join('app/controllers/concerns/access_token_auth_helper').to_s

  AccessTokenAuthHelper.prepend(JourneyIntakeContactAccess) unless AccessTokenAuthHelper.ancestors.include?(JourneyIntakeContactAccess)
end
