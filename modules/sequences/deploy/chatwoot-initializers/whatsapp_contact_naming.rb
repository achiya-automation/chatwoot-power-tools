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
#
# It also fixes the other place a WhatsApp name reaches an agent's eye: the
# sender line WAHA prepends to every incoming group message. WAHA builds it as
# `Name (jid)` (apps/chatwoot/consumers/waha/base.js), so a raw technical id
# rides along on every group message:
#
#     👥 *dana (1000000000001@lid)*   ->   👥 *dana*
#
# The format is hard-coded in the WAHA image and cannot be configured off, so it
# is stripped here on the way into the database. The 75,355 messages that predate
# this were cleaned in place on 23.8.2026 (backup:
# /opt/chatwoot-backups/waha_group_headers_20260823_160411.csv).
#
# Agents type Israeli numbers the local way: with Israel picked in the country
# list, "050-123-4567" is saved as +9720501234567. WhatsApp forgives the extra
# zero and delivers the agent's message, but WAHA files every reply under the
# real +972501234567, a second contact with its own conversation, so the agent
# who wrote sees only outgoing messages. The trunk zero is dropped whenever a
# number is typed or changed, which also makes Chatwoot's uniqueness check stop
# the duplicate, and a search for 050-123-4567 finds the existing contact.

WAHA_GROUP_SENDER_JID = /\A(👥 \*[^\n]*?) \(\d{7,20}@(?:lid|c\.us)\)\*/.freeze

# ponytail: Israel only (every inbox here is Israeli); other countries with a trunk 0 get their own rule if one shows up
module IsraeliPhone
  TRUNK_ZERO = /\A\+9720(?=\d{8,9}\z)/.freeze
  LOCAL_NUMBER = /\A0\d{8,9}\z/.freeze

  # "+9720501234567" -> "+972501234567"
  def self.drop_trunk_zero(phone) = phone&.sub(TRUNK_ZERO, '+972')

  # "050-123-4567" -> "501234567", a substring of the stored +972501234567
  def self.search_term(query)
    digits = query.to_s.strip.delete(' -')
    digits.match?(LOCAL_NUMBER) ? digits[1..] : query
  end
end

Rails.application.config.to_prepare do
  Message.class_eval do
    before_save :strip_waha_group_sender_jid

    private

    def strip_waha_group_sender_jid
      # ponytail: start_with? keeps this off the hot path for every non-group message
      return unless content.to_s.start_with?('👥 *')

      self.content = content.sub(WAHA_GROUP_SENDER_JID, '\1*')
    end
  end

  Contact.class_eval do
    # before_validation, so the uniqueness check sees the corrected number
    before_validation :drop_israeli_trunk_zero, if: :will_save_change_to_phone_number?
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

    def drop_israeli_trunk_zero
      self.phone_number = IsraeliPhone.drop_trunk_zero(phone_number)
    end

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

  # Contacts page and the new-conversation contact picker
  Api::V1::Accounts::ContactsController.prepend(Module.new do
    def search
      params[:q] = IsraeliPhone.search_term(params[:q])
      super
    end
  end)

  # Global search (contacts, conversations, messages)
  SearchService.prepend(Module.new do
    private

    def search_query = IsraeliPhone.search_term(super)
  end)
end
