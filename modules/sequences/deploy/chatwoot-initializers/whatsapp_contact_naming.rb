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
#
# Every other contact detail is put in its own field the same way (ContactFields).
# Every write path (the agent's form, the API, Chatwoot's own CSV import, WAHA,
# the bridges) ends in Contact validation, so that is where they converge:
#   * any Israeli spelling of a number is stored as +972…: "050-123-4567", and
#     "+0501234567", which Chatwoot's import makes of a local number (it only
#     prefixes a plus) and then rejects the whole row as invalid
#   * a Hebrew CSV header ("טלפון", "שם פרטי", "אימייל", "חברה", "עיר") lands in
#     the matching field instead of a custom attribute, so the import also finds
#     the existing contact instead of adding a phoneless twin
#   * a phone, email, name, company or city that did land in a custom attribute
#     fills the empty field it belongs in (the attribute itself stays)
#   * a name that is only a phone number fills an empty phone field
#   * WhatsApp: the profile name replaces a name that is only a number or a
#     random placeholder. Chatwoot did that only for the "+972…" spellings, so a
#     contact first created by an outgoing message as "050-123-4567" kept the
#     number as its name forever.

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

module ContactFields
  # a CSV header or custom-attribute key, compared lower case without spaces, dashes,
  # underscores, dots or quotes, and without a "customer" word ("שם פרטי לקוח" = "שם פרטי")
  FIELD_BY_KEY = {
    phone_number: %w[phonenumber טלפון נייד סלולרי סלולארי פלאפון טלפוןנייד מספרטלפון מספרנייד phone mobile
                     mobilephone cell cellphone tel telephone whatsapp],
    email: %w[email אימייל מייל דואל דוארלקטרוני emailaddress mail],
    name: %w[name שם שםמלא fullname],
    first_name: %w[שםפרטי firstname],
    last_name: %w[שםמשפחה lastname surname],
    company_name: %w[companyname חברה שםהחברה עסק שםהעסק company business businessname],
    city: %w[city עיר ישוב יישוב town]
  }.flat_map { |field, keys| keys.map { |k| [k, field] } }.to_h.freeze
  FILLER = /לקוחה|לקוח|customer|client/.freeze
  EMAIL = /\A[^@\s]+@[^@\s]+\.[^@\s]+\z/.freeze
  # empty, only phone characters, Chatwoot's random "muddy-pine-495", or a raw WhatsApp id
  PLACEHOLDER_NAME = /\A(?:[+\d\s().-]*|[a-z]+-[a-z]+-\d+|\d{7,20}@(?:c\.us|s\.whatsapp\.net|lid))\z/.freeze

  def self.field(key) = FIELD_BY_KEY[key.to_s.downcase.gsub(FILLER, '').gsub(/[\s_\-."'״׳]/, '')]
  def self.text(value) = value.to_s.strip
  def self.placeholder_name?(name) = text(name).match?(PLACEHOLDER_NAME)

  # ponytail: Israel only, like IsraeliPhone; a number without a plus and without 0/972 is not guessed
  # "050-123-4567", "+0501234567", "972-50-1234567", "+9720501234567" -> "+972501234567"; nil when not a number
  def self.phone(raw)
    s = text(raw)
    digits = s.delete('^0-9')
    return "+972#{digits[1..]}" if digits.match?(/\A0[2-9]\d{7,8}\z/)
    return "+#{digits}" if digits.match?(/\A972[2-9]\d{7,8}\z/)
    return IsraeliPhone.drop_trunk_zero("+#{digits}") if digits.match?(/\A9720[2-9]\d{7,8}\z/)

    "+#{digits}" if s.start_with?('+') && digits.match?(/\A[1-9]\d{6,14}\z/)
  end

  # recognised keys -> field => first non-empty value
  def self.gather(hash)
    hash.to_h.each_with_object({}) do |(key, value), found|
      f = field(key)
      found[f] ||= text(value) if f && !text(value).empty?
    end
  end

  # "שם" + "שם משפחה" (a first name and a family name) as well as "שם פרטי" + "שם משפחה"
  def self.full_name(found)
    first = found[:first_name] || found[:name]
    last = found[:last_name]
    return first if last.nil? || first.to_s.include?(last)

    [first, last].compact.join(' ')
  end

  # The row Chatwoot's CSV import hands its ContactManager, with every recognised
  # header moved to the key that manager reads; the other columns stay custom attributes.
  def self.import_params(params)
    found = gather(params)
    out = params.to_h.reject { |key, _| field(key) }
    out[:phone_number] = phone(found[:phone_number]) || found[:phone_number] if found[:phone_number]
    out[:email] = found[:email].downcase if found[:email]
    out[:name] = full_name(found) if found[:name] || found[:first_name] || found[:last_name]
    out[:company_name] = found[:company_name] if found[:company_name]
    out[:city] = found[:city] if found[:city]
    out
  end

  # What belongs in an empty field of this contact: found in its custom attributes, or
  # for the phone in a name that is only a number. Empty fields only, nothing overwritten.
  def self.missing(name:, phone_number:, email:, custom_attributes:, additional_attributes:)
    found = gather(custom_attributes)
    extra = additional_attributes.to_h.transform_keys(&:to_s)
    out = {}
    if text(phone_number).empty?
      number = phone(found[:phone_number]) || (phone(name) if placeholder_name?(name))
      out[:phone_number] = number if number
    end
    out[:email] = found[:email].downcase if text(email).empty? && found[:email].to_s.match?(EMAIL)
    named = full_name(found)
    out[:name] = named if named && placeholder_name?(name)
    %i[company_name city].each { |f| out[f] = found[f] if found[f] && text(extra[f.to_s]).empty? }
    out
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
    before_validation :put_details_in_their_fields
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
      self.phone_number = ContactFields.phone(phone_number) || phone_number
    end

    def put_details_in_their_fields
      found = ContactFields.missing(name: name, phone_number: phone_number, email: email,
                                    custom_attributes: custom_attributes, additional_attributes: additional_attributes)
      return if found.empty?

      # a number or address another contact holds stays where it is: filling it would fail
      # Chatwoot's uniqueness check and lose the save (a WAHA message, an import row)
      others = Contact.where(account_id: account_id).where.not(id: id)
      found.delete(:phone_number) if found[:phone_number] && others.exists?(phone_number: found[:phone_number])
      found.delete(:email) if found[:email] && others.exists?(['lower(email) = ?', found[:email]])
      extra = found.extract!(:company_name, :city).transform_keys(&:to_s)
      assign_attributes(found)
      self.additional_attributes = additional_attributes.to_h.merge(extra) if extra.any?
    end

    def normalize_waha_identity_fields
      jid = custom_attributes.to_h['waha_whatsapp_jid'].presence || identifier
      m = jid.to_s.strip.match(/\A(\d{7,15})@(?:c\.us|s\.whatsapp\.net)\z/)
      return unless m

      digits = m[1]
      # before_save runs after validation: a number another contact holds would save an
      # invalid twin that every later WAHA update fails on (422), so it stays empty here
      # and waha_contact_sync reports the pair as a phone conflict
      if phone_number.blank? &&
         !Contact.where(account_id: account_id, phone_number: "+#{digits}").where.not(id: id).exists?
        self.phone_number = "+#{digits}"
      end

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

  # Chatwoot's own CSV import (Contacts > Import)
  DataImport::ContactManager.prepend(Module.new do
    def build_contact(params) = super(ContactFields.import_params(params).with_indifferent_access)

    def format_phone_number(phone_number) = ContactFields.phone(phone_number) || super
  end)

  Whatsapp::IncomingMessageBaseService.prepend(Module.new do
    private

    def contact_name_matches_phone_number? = super || ContactFields.placeholder_name?(@contact.name)
  end)
end
