# frozen_string_literal: true

# Keep the native Chatwoot WhatsApp campaign feature enabled for existing and future
# accounts. Chatwoot 4.17.1 still ships the feature disabled by default, while the
# sequences addon deliberately builds on its native campaign pipeline.
Rails.application.config.after_initialize do
  begin
    enabled_accounts = 0

    Account.find_each do |account|
      next if account.feature_enabled?(:whatsapp_campaign)

      account.enable_features(:whatsapp_campaign)
      account.save(validate: false)
      enabled_accounts += 1
    end

    config = InstallationConfig.find_by(name: 'ACCOUNT_LEVEL_FEATURE_DEFAULTS')
    if config
      features = Array(config.value).map { |feature| feature.to_h.deep_dup }
      existing = features.find { |feature| feature['name'] == 'whatsapp_campaign' }

      if existing
        existing['enabled'] = true
      else
        features << { 'name' => 'whatsapp_campaign', 'enabled' => true }
      end

      config.update!(value: features)
    end

    Rails.logger.info("[CUSTOM] WhatsApp campaign feature ready (newly enabled accounts: #{enabled_accounts})")
  rescue StandardError => e
    # Exception messages may embed database or request details. The class is enough for
    # operations while keeping logs safe to retain and export.
    Rails.logger.error("[CUSTOM] WhatsApp campaign feature setup failed (#{e.class})")
  end
end
