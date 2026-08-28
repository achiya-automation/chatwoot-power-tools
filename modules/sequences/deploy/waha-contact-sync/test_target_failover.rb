#!/usr/bin/env ruby
# frozen_string_literal: true

ENV['WAHA_CONTACT_SYNC_LIB_ONLY'] = '1'

require 'json'
require 'stringio'
require 'tmpdir'

directory = Dir.mktmpdir
config_path = File.join(directory, 'config.json')
File.write(
  config_path,
  JSON.generate(
    'waha_base_url' => 'http://localhost',
    'targets' => [
      { 'session' => 'stale-source', 'account_id' => 1, 'inbox_id' => 10, 'key' => 'test-key' },
      { 'session' => 'healthy-source', 'account_id' => 2, 'inbox_id' => 20, 'key' => 'test-key' }
    ]
  )
)
ENV['WAHA_CONTACT_SYNC_CONFIG'] = config_path

require_relative 'waha_contact_sync'

sync = WahaContactSync.new(mode: 'full', dry_run: true)
visited = []
sync.define_singleton_method(:sync_target) do |target, _include_unlinked|
  visited << target.fetch('session')
  raise WahaContactSync::SyncError, 'simulated source failure' if target.fetch('session') == 'stale-source'

  Hash.new(0).merge(
    session: target.fetch('session'),
    account_id: target.fetch('account_id'),
    inbox_id: target.fetch('inbox_id'),
    mode: 'full',
    scanned: 2,
    unchanged: 2
  )
end

original_stdout = $stdout
captured = StringIO.new
$stdout = captured
raised = begin
  sync.run
  nil
rescue WahaContactSync::SyncError => e
  e
ensure
  $stdout = original_stdout
end

raise 'runner did not visit every target' unless visited == %w[stale-source healthy-source]
raise 'runner did not fail after partial completion' unless raised&.message == '1 target(s) failed'

events = captured.string.lines.map { |line| JSON.parse(line) }
failure = events.find { |event| event['event'] == 'target_failed' }
success = events.find { |event| event['event'] == 'target_complete' }
complete = events.find { |event| event['event'] == 'sync_complete' }

raise 'safe failure event missing' unless failure == {
  'session' => 'stale-source',
  'account_id' => 1,
  'inbox_id' => 10,
  'mode' => 'full',
  'event' => 'target_failed',
  'error_class' => 'WahaContactSync::SyncError',
  'dry_run' => true
}
raise 'healthy target was not completed' unless success&.dig('session') == 'healthy-source'
raise 'aggregate counters are wrong' unless complete&.dig('target_failures') == 1 && complete&.dig('scanned') == 2
raise 'dry-run marker missing' unless complete&.dig('dry_run') == true

puts 'ok — a failed target does not starve later targets and the unit still fails safely'
