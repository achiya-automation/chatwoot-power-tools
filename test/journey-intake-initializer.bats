#!/usr/bin/env bats

@test "Journey intake contact access is limited to the Drip bot, its route account, and write actions" {
  initializer="$BATS_TEST_DIRNAME/../modules/sequences/deploy/chatwoot-initializers/journey_intake_contact_access.rb"

  run ruby - "$initializer" <<'RUBY'
module AccessTokenAuthHelper
  def agent_bot_accessible?
    params[:controller] == 'existing/bot/endpoint'
  end
end

class AgentBot
  attr_reader :name, :account_id

  def initialize(name:, account_id:)
    @name = name
    @account_id = account_id
  end
end

load ARGV.fetch(0)

Harness = Class.new do
  include AccessTokenAuthHelper

  def allowed?(resource:, account_id:, action: 'create', controller: 'api/v1/accounts/contacts')
    @resource = resource
    @test_params = { account_id: account_id, action: action, controller: controller }
    agent_bot_accessible?
  end

  private

  def params
    @test_params
  end
end

h = Harness.new
bot = AgentBot.new(name: '🤖 רצפי הודעות', account_id: 14)
raise 'expected own-account create to pass' unless h.allowed?(resource: bot, account_id: 14)
raise 'wrong route account passed' if h.allowed?(resource: bot, account_id: 15)
raise 'read action passed' if h.allowed?(resource: bot, account_id: 14, action: 'show')
raise 'foreign controller passed' if h.allowed?(resource: bot, account_id: 14, controller: 'api/v1/accounts/users')
raise 'renamed bot passed' if h.allowed?(resource: AgentBot.new(name: 'other', account_id: 14), account_id: 14)
raise 'existing bot endpoint was broken' unless h.allowed?(
  resource: AgentBot.new(name: 'other', account_id: 99),
  account_id: 14,
  controller: 'existing/bot/endpoint'
)
RUBY

  [ "$status" -eq 0 ]
}
