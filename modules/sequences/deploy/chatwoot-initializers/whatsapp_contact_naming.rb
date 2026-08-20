# frozen_string_literal: true
#
# WAHA's built-in Chatwoot app keeps the stable WhatsApp identities in contact
# custom attributes. The public Chatwoot contact identifier is usually a UUID,
# so looking at `identifier` alone misses most WAHA contacts. Keep the normal
# Chatwoot fields correct whenever WAHA creates or later enriches a contact:
#   * copy the E.164 number from waha_whatsapp_jid into phone_number
#   * replace a raw private JID name with a readable international number
#   * never overwrite a real profile name
#
# Public WhatsApp profile names and group subjects are refreshed by the
# server-side waha_contact_sync job. This initializer is the synchronous safety
# net that makes the phone field correct as soon as WAHA learns a JID.

Rails.application.config.to_prepare do
  Contact.class_eval do
    before_save :normalize_waha_identity_fields

    def self.readable_international_number(digits)
      if digits.start_with?('972') && digits.length >= 11
        rest = digits[3..]
        "+972 #{rest[0, 2]}-#{rest[2, 3]}-#{rest[5..]}"
      else
        "+#{digits}"
      end
    end

    private

    def normalize_waha_identity_fields
      jid = custom_attributes.to_h['waha_whatsapp_jid'].presence || identifier
      m = jid.to_s.strip.match(/\A(\d{7,15})@(?:c\.us|s\.whatsapp\.net)\z/)
      return unless m

      digits = m[1]
      self.phone_number = "+#{digits}" if phone_number.blank?

      raw_jid_name = name.to_s.strip.match?(/\A\d{7,15}@(c\.us|s\.whatsapp\.net)\z/)
      self.name = self.class.readable_international_number(digits) if name.blank? || raw_jid_name
    end
  end
end
