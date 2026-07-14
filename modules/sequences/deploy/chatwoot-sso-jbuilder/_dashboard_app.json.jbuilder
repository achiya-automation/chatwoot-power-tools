#
# Drop-in replacement for Chatwoot's app/views/api/v1/models/_dashboard_app.json.jbuilder.
# Mounted read-only over the original (see docker-compose.override.yml). Upstream's version is
# four lines — id / title / content / created_at — and this reproduces them exactly, adding ONE
# thing: a signed sign-in ticket on the URL of our own panel.
#
# WHY THIS EXISTS
#
# Chatwoot's mobile app opens a dashboard app in a WebView whose cookie jar is EMPTY for the
# Chatwoot origin: the native app authenticates over the API with devise headers and never runs
# the web SPA, and `cw_d_session_info` is written by that SPA's JavaScript — Rails never
# Set-Cookie's it. So the phone reaches the panel with no session, and the panel can only refuse.
# Chatwoot has no auth contract for dashboard apps (chatwoot#8552, open since 2023) and the
# appContext it postMessages into the WebView is unsigned, so nothing on the client is worth
# trusting.
#
# But THIS request — GET /api/v1/accounts/:id/dashboard_apps — is authenticated. Rails knows
# exactly who is asking. So here, and only here, we can hand the app a URL that proves the agent's
# identity: a ticket signed with a secret shared with the panel's engine. The engine verifies the
# signature, spends the ticket (single use), and mints a real session cookie. Chatwoot remains the
# authority on identity — it is the one that signed.
#
# SAFETY RAILS
#
#   * The ticket is attached ONLY to URLs on DRIP_PANEL_ORIGIN — our own panel. A dashboard app
#     pointing anywhere else (a third-party tool an operator added) is emitted untouched. Leaking
#     an agent's identity to an arbitrary third-party URL is exactly the hazard chatwoot#8552 is
#     about, and this is the line that prevents it.
#   * No secret configured → this file is a no-op and behaves exactly like upstream's.
#   * The ticket names ONE user and ONE account, expires, and is single-use.
#   * Failure is never fatal: if anything here raises, the original content is emitted, so a
#     mistake degrades the mobile tab — it never takes down Chatwoot's API.
#
json.id resource.id
json.title resource.title

json.content(
  begin
    secret = ENV.fetch('DRIP_SSO_SECRET', nil)
    origin = ENV.fetch('DRIP_PANEL_ORIGIN', nil)
    user   = Current.user

    if secret.blank? || origin.blank? || user.blank?
      resource.content
    else
      resource.content.map do |item|
        url = item.is_a?(Hash) ? (item['url'] || item[:url]) : nil
        # Only our own panel is ever handed an identity. Everything else passes through untouched.
        next item unless url.is_a?(String) && url.start_with?(origin)

        account_id = begin
          Rack::Utils.parse_query(URI.parse(url).query)['account_id'].presence&.to_i
        rescue URI::InvalidURIError
          nil
        end
        account_id ||= Current.account&.id
        next item unless account_id

        claims = {
          u: user.id,
          a: account_id,
          exp: ((Time.current + 7.days).to_f * 1000).to_i, # ms — the app caches this URL until relaunch
          jti: SecureRandom.uuid                           # the single-use id the engine burns
        }
        payload = Base64.urlsafe_encode64(claims.to_json, padding: false)
        sig = Base64.urlsafe_encode64(
          OpenSSL::HMAC.digest('SHA256', secret, "t:#{payload}"), padding: false
        )

        sep = url.include?('?') ? '&' : '?'
        item.merge('url' => "#{url}#{sep}k=#{payload}.#{sig}")
      end
    end
  rescue StandardError => e
    Rails.logger.warn("[drip-sso] ticket minting skipped: #{e.class}: #{e.message}")
    resource.content
  end
)

json.created_at resource.created_at
