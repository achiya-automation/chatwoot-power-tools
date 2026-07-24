# Maintenance scripts

One-off repair scripts for data problems that predate (or sit outside) the import tool.
They run through `rails runner` inside the Chatwoot Rails container and **default to a dry
run** — nothing is written until you pass `APPLY=1`.

## fix-hidden-phones.rb

**Symptom.** Contacts named `muddy-pine-495` or `972501234567@c.us` that show no phone
number, often alongside a properly named duplicate of the same person. Imports keep
creating duplicates no matter how clean the file is.

**Cause.** When a WhatsApp message arrives for an unknown number, Chatwoot creates a
contact whose number is stored only in `contact_inboxes.source_id`; `contacts.phone_number`
stays `NULL`. Dedup — the tool's and Chatwoot's own — matches on `phone_number`, so that
contact is invisible to it and the next import adds a second record for the same person.

**Fix.** Promotes the hidden number to `phone_number`; when another contact already owns
that number, merges the pair via `ContactMergeAction` (the human-named record wins, so
conversations and messages are preserved). Contacts identified only by a WhatsApp LID
(16-17 digits — an opaque id, not a phone number) are left alone.

```bash
RAILS=$(docker ps --format '{{.Names}}' | grep rails | head -1)
docker cp fix-hidden-phones.rb "$RAILS":/tmp/

# 1. see the plan
docker exec "$RAILS" bundle exec rails runner /tmp/fix-hidden-phones.rb

# 2. back up, then apply
PG=$(docker ps --format '{{.Names}}' | grep postgres | head -1)
docker exec "$PG" pg_dump -U chatwoot -d chatwoot \
  -t contacts -t contact_inboxes -t conversations -t messages --data-only \
  | gzip > contacts-backup.sql.gz
docker exec -e APPLY=1 "$RAILS" bundle exec rails runner /tmp/fix-hidden-phones.rb
```

Runs across every account on the installation. Safe to re-run — it is idempotent.
