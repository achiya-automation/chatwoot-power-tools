#!/usr/bin/env bats

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/.." && pwd)"
  CAMPAIGN_INITIALIZER="$REPO_ROOT/modules/sequences/deploy/chatwoot-initializers/whatsapp_campaign_conversations.rb"
}

@test "campaign integration uses Chatwoot native API version and portable account policy" {
  run ruby -c "$CAMPAIGN_INITIALIZER"
  [ "$status" -eq 0 ]

  run grep -F "GlobalConfigService.load('WHATSAPP_API_VERSION'" "$CAMPAIGN_INITIALIZER"
  [ "$status" -eq 0 ]

  run grep -E 'CAMPAIGN_ONLY_AGENT_BOTS|\[11, 12\]|/v13\.0/' "$CAMPAIGN_INITIALIZER"
  [ "$status" -eq 1 ]

  run grep -F "cwpt_campaign_only_agent_bots" "$CAMPAIGN_INITIALIZER"
  [ "$status" -eq 0 ]
}

@test "obsolete WhatsApp Flow content override stays removed on Chatwoot 4.17" {
  [ ! -e "$REPO_ROOT/modules/sequences/deploy/chatwoot-initializers/whatsapp_flow_reply_content.rb" ]
}

@test "campaign initializer never writes phone numbers or raw Meta bodies to logs" {
  run grep -E 'Rails\.logger\..*contact\.phone_number|Rails\.logger\..*response\.body' "$CAMPAIGN_INITIALIZER"
  [ "$status" -eq 1 ]
}
