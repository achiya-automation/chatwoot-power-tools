# frozen_string_literal: true
#
# WAHA's built-in Chatwoot app names contacts after their raw WhatsApp JID when
# no public pushName exists ("972501234567@c.us"). This initializer keeps names
# presentable, on create and on every later name write:
#   * a private-JID name becomes a readable international number
#     ("+972 50-123-4567"), and phone_number is filled when missing
#   * a real pushName arriving later still wins — it does not match the JID
#     pattern, so it is stored untouched
# Group subjects live only in WAHA, so group names are handled by the nightly
# waha-group-names sync, not here.

Rails.application.config.to_prepare do
  Contact.class_eval do
    before_save :normalize_waha_jid_name, if: :will_save_change_to_name?

    def self.readable_international_number(digits)
      if digits.start_with?('972') && digits.length >= 11
        rest = digits[3..]
        "+972 #{rest[0, 2]}-#{rest[2, 3]}-#{rest[5..]}"
      else
        "+#{digits}"
      end
    end

    private

    def normalize_waha_jid_name
      m = name.to_s.strip.match(/\A(\d{7,15})@c\.us\z/)
      return unless m

      digits = m[1]
      self.phone_number = "+#{digits}" if phone_number.blank?
      self.name = self.class.readable_international_number(digits)
    end
  end
end
