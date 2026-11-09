# Read-only HTTP check of the campaign stats endpoints inside the running app. Prints statuses only.
s = ActionDispatch::Integration::Session.new(Rails.application)
s.host = URI(ENV.fetch('FRONTEND_URL', 'http://localhost')).host
s.https! if ENV.fetch('FRONTEND_URL', '').start_with?('https')
camp = Campaign.joins(:inbox).where(inboxes: { channel_type: 'Channel::Whatsapp' }).order(id: :desc).first
abort 'NO_CAMPAIGN' unless camp
acc = camp.account_id
admin = AccountUser.where(account_id: acc, role: :administrator).map(&:user).find(&:access_token)
agent = AccountUser.where(account_id: acc, role: :agent).map(&:user).find(&:access_token)
other = Account.where.not(id: acc).first
base = ->(a) { "/api/v1/accounts/#{a}/campaigns/#{camp.display_id}/analytics" }
get = lambda do |path, user|
  h = user ? { 'api_access_token' => user.access_token.token } : {}
  s.get(path, headers: h)
  s.response.status
end
ok = true
check = ->(name, got, want) { ok &&= want.include?(got); puts "#{want.include?(got) ? 'PASS' : 'FAIL'} #{name}: #{got}" }
check.('admin metrics', get.(base.(acc) + '/metrics', admin), [200])
puts "  body=#{s.response.body.to_s[0,120]}" unless s.response.status == 200
puts "  metrics=#{s.response.parsed_body.slice('audience', 'sent', 'delivered', 'read', 'failed', 'skipped').to_json}" if s.response.status == 200
check.('admin contacts', get.(base.(acc) + '/contacts?page=1', admin), [200])
puts "  total=#{s.response.parsed_body.dig('meta', 'total_count')}" if s.response.status == 200
check.('no token', get.(base.(acc) + '/metrics', nil), [401])
check.('agent', get.(base.(acc) + '/contacts', agent), [401, 403]) if agent
check.('wrong account', get.(base.(other.id) + '/metrics', admin), [401, 403, 404]) if other
puts ok ? 'ALL_PASS' : 'SOME_FAIL'
