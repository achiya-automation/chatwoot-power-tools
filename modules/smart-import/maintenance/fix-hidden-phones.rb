# fix-hidden-phones.rb — promote hidden WhatsApp numbers to contacts.phone_number.
#
# WHY
# When a WhatsApp message arrives for someone who isn't a contact yet, Chatwoot creates
# a contact whose number lives ONLY in contact_inboxes.source_id — contacts.phone_number
# stays NULL and the display name is a placeholder ("muddy-pine-495" or "9725...@c.us").
# Such a contact is invisible to phone lookups AND to import dedup, so the next contact
# import creates a SECOND record for the same person. One production account accumulated
# 413 duplicate pairs this way before anyone noticed.
#
# WHAT IT DOES
#   * contact has a hidden number and nobody owns it  → write it to phone_number
#   * another contact already owns that number        → merge the two (ContactMergeAction),
#                                                       keeping the human-named one as base
#                                                       so conversations and messages survive
# Contacts are never deleted outside of a merge, and a contact whose only identifier is a
# WhatsApp LID (16-17 digits — an opaque id, not a phone number) is left untouched.
#
# USAGE — dry run first, it is the default:
#   docker exec <rails> bundle exec rails runner /path/fix-hidden-phones.rb
#   docker exec -e APPLY=1 <rails> bundle exec rails runner /path/fix-hidden-phones.rb
#
# Take a backup before APPLY=1:
#   docker exec <postgres> pg_dump -U <user> -d <db> -t contacts -t contact_inboxes \
#     -t conversations -t messages --data-only | gzip > backup.sql.gz
APPLY = ENV['APPLY'] == '1'
PLACEHOLDER_NAME = /\A[a-z]+-[a-z]+-\d+\z/
JID_NAME = /@(c\.us|s\.whatsapp\.net|lid)\z/
# E.164 tops out at 15 digits; WhatsApp LIDs are longer and are not phone numbers.
PHONE_SOURCE_ID = /\A\d{9,15}\z/

def human_name?(contact)
  n = contact.name.to_s.strip
  n.present? && !n.match?(PLACEHOLDER_NAME) && !n.match?(JID_NAME)
end

stats = Hash.new(0)
problems = []

Account.find_each do |account|
  targets = account.contacts.where(phone_number: nil)
                   .joins(:contact_inboxes).where("contact_inboxes.source_id ~ '^[0-9]{9,15}$'")
                   .distinct.to_a
  next if targets.empty?

  puts "account #{account.id} (#{account.name}): #{targets.size} contact(s) with a hidden number"

  targets.each do |contact|
    source = contact.contact_inboxes.map(&:source_id).find { |s| s.to_s.match?(PHONE_SOURCE_ID) }
    next unless source

    phone = "+#{source}"
    owner = account.contacts.find_by(phone_number: phone)

    if owner && owner.id != contact.id
      # Same person, two records. Keep whichever carries a real name.
      base, mergee = human_name?(owner) || !human_name?(contact) ? [owner, contact] : [contact, owner]
      if APPLY
        begin
          base.update!(phone_number: phone) if base.phone_number.blank?
          ContactMergeAction.new(account: account, base_contact: base, mergee_contact: mergee).perform
        rescue StandardError => e
          problems << [contact.id, "merge failed: #{e.message}"]
          next
        end
      end
      stats[:merged] += 1
      next
    end

    if APPLY
      contact.phone_number = phone
      unless contact.save
        problems << [contact.id, contact.errors.full_messages.join('; ')]
        next
      end
    end
    stats[:phone_filled] += 1
  end
end

puts(APPLY ? '--- APPLIED ---' : '--- DRY RUN (set APPLY=1 to write) ---')
stats.sort.each { |key, value| puts "#{key}: #{value}" }
puts "problems: #{problems.size}"
problems.first(20).each { |id, why| puts "  contact #{id}: #{why}" }
