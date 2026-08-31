# frozen_string_literal: true

require 'minitest/autorun'

class LogPrivacyTest < Minitest::Test
  ROOT = File.expand_path('..', __dir__)

  FORBIDDEN_LOG_FRAGMENTS = {
    'whatsapp_campaign_conversations.rb' => [
      'template message to #{to}',
      'for #{handle_url}',
      '#{e.backtrace',
      'full_messages.join'
    ],
    'presence_humanizer.rb' => ['#{e.class}: #{e.message}', 'conv=#{conversation.id}: #{e.message}'],
    'smart_import_server.rb' => ['SmartImportJob #{job_id}: #{e.class} #{e.message}'],
    'unassign_removes_participant.rb' => ['#{e.class}: #{e.message}']
  }.freeze

  def test_production_initializers_do_not_log_known_sensitive_values
    FORBIDDEN_LOG_FRAGMENTS.each do |file, fragments|
      source = File.read(File.join(ROOT, file))
      fragments.each do |fragment|
        refute_includes source, fragment, "#{file} must not log #{fragment}"
      end
    end
  end
end
