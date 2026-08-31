require 'base64'
require 'json'
require 'logger'
require 'minitest/autorun'
require 'openssl'
require 'securerandom'
require 'stringio'
require 'uri'

class Object
  def blank?
    respond_to?(:empty?) ? !!empty? : !self
  end
end

class Integer
  def minutes
    self * 60
  end
end

class Time
  def self.current
    now
  end
end

module Current
  class << self
    attr_accessor :user, :account
  end
end

module Rails
  class << self
    attr_writer :logger

    def logger
      @logger ||= Logger.new(File::NULL)
    end
  end
end

class JsonOutput
  attr_reader :data

  def initialize
    @data = {}
  end

  %i[id title content created_at].each do |field|
    define_method(field) { |value| @data[field] = value }
  end
end

class SsoJbuilderSecurityTest < Minitest::Test
  TEMPLATE = File.expand_path(
    '../modules/sequences/deploy/chatwoot-sso-jbuilder/_dashboard_app.json.jbuilder',
    __dir__
  )

  FakeResource = Struct.new(:id, :title, :content, :created_at, keyword_init: true)
  FakeIdentity = Struct.new(:id, keyword_init: true)

  def setup
    ENV['DRIP_SSO_SECRET'] = 'test-only-secret'
    ENV['DRIP_PANEL_ORIGIN'] = 'https://panel.example/drip'
    Current.user = FakeIdentity.new(id: 42)
    Current.account = FakeIdentity.new(id: 7)
    @log_output = StringIO.new
    Rails.logger = Logger.new(@log_output)
  end

  def teardown
    ENV.delete('DRIP_SSO_SECRET')
    ENV.delete('DRIP_PANEL_ORIGIN')
    Current.user = nil
    Current.account = nil
    Rails.logger = Logger.new(File::NULL)
  end

  def render(*urls)
    json = JsonOutput.new
    resource = FakeResource.new(
      id: 1,
      title: 'Panel',
      content: urls.map { |url| { 'url' => url } },
      created_at: Time.now
    )
    eval(File.read(TEMPLATE), binding, TEMPLATE)
    json.data.fetch(:content)
  end

  def claims_from(url)
    ticket = URI.decode_www_form(URI.parse(url).query.to_s).to_h.fetch('k')
    encoded_payload = ticket.split('.', 2).first
    padding = '=' * ((4 - encoded_payload.length % 4) % 4)
    JSON.parse(Base64.urlsafe_decode64(encoded_payload + padding))
  end

  def test_claim_always_uses_current_account_not_url_account_id
    rendered = render('https://panel.example/drip?account_id=999').first.fetch('url')

    assert_equal 7, claims_from(rendered).fetch('a')
    assert_includes rendered, 'account_id=999'
  end

  def test_lookalike_host_never_receives_a_ticket
    original = 'https://panel.example.evil/drip?account_id=7'

    assert_equal original, render(original).first.fetch('url')
  end

  def test_sibling_path_never_receives_a_ticket
    original = 'https://panel.example/drip-evil?account_id=7'

    assert_equal original, render(original).first.fetch('url')
  end

  def test_real_child_path_receives_short_lived_ticket
    before = (Time.now.to_f * 1000).to_i
    rendered = render('https://panel.example/drip/dashboard?account_id=7').first.fetch('url')
    claims = claims_from(rendered)

    assert_operator claims.fetch('exp'), :>, before
    assert_operator claims.fetch('exp'), :<=, before + (16 * 60 * 1000)
  end

  def test_parse_error_does_not_log_url_or_query_values
    original = 'https://panel.example/drip/%ZZ?access_token=fake-secret-marker'

    assert_equal original, render(original).first.fetch('url')

    log = @log_output.string
    assert_includes log, '[drip-sso] ticket minting skipped: URI::InvalidURIError'
    refute_includes log, 'access_token'
    refute_includes log, 'fake-secret-marker'
  end
end
