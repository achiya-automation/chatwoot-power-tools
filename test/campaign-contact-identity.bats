#!/usr/bin/env bats

# Regression guard for the "dry-haze-861" incident (07-09.08.2026): the campaign handed
# ContactInboxWithContactBuilder a string-keyed contact_attributes hash. The builder reads
# [:name] / [:phone_number], so both came back nil — phone dedup never matched the imported
# contact and every recipient got a fresh, nameless, phoneless duplicate.

@test "campaign contact_attributes survives the builder's symbol-key read" {
  initializer="$BATS_TEST_DIRNAME/../modules/sequences/deploy/chatwoot-initializers/whatsapp_campaign_conversations.rb"

  run ruby - "$initializer" <<'RUBY'
# encoding: utf-8
source = File.read(ARGV.fetch(0), encoding: 'UTF-8')

literal = source[/contact_attributes:\s*(\{.*?\})\s*\)\.perform/m, 1]
abort 'contact_attributes literal not found next to .perform' if literal.nil?

contact = Struct.new(:name, :phone_number).new('ציון שועו', '+972509022803')
attrs = eval(literal) # rubocop:disable Security/Eval

# Verbatim from app/builders/contact_inbox_with_contact_builder.rb.
name = attrs[:name] || 'haikunated-placeholder-1'
phone = attrs[:phone_number]

abort "name read back as #{name.inspect} — the builder would haikunate it" unless name == contact.name
abort "phone read back as #{phone.inspect} — the builder would skip phone dedup" unless phone == contact.phone_number
puts 'ok'
RUBY

  [ "$status" -eq 0 ]
  [[ "$output" == *ok* ]]
}

@test "campaign repairs a placeholder contact the builder hands back untouched" {
  initializer="$BATS_TEST_DIRNAME/../modules/sequences/deploy/chatwoot-initializers/whatsapp_campaign_conversations.rb"

  run ruby - "$initializer" <<'RUBY'
# encoding: utf-8
source = File.read(ARGV.fetch(0), encoding: 'UTF-8')

abort 'restore_campaign_contact_identity is missing' unless source.include?('def restore_campaign_contact_identity')
abort 'the builder result is never repaired' unless source.match?(/\)\.perform\s*\n\s*return unless contact_inbox\s*\n\s*restore_campaign_contact_identity/)
abort 'placeholder pattern is missing' unless source.include?('CAMPAIGN_PLACEHOLDER_NAME = /\A[a-z]+-[a-z]+-\d+\z/')
abort 'repair must stand down when another contact owns the number' unless source.include?('return if owner_exists')
puts 'ok'
RUBY

  [ "$status" -eq 0 ]
  [[ "$output" == *ok* ]]
}
