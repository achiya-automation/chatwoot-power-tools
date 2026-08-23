# WAHA contact profile sync

This production helper keeps Chatwoot's standard contact fields aligned with
the WhatsApp data held by WAHA:

- saved address-book `name` first, public WhatsApp `pushname` only as a fallback;
- WAHA contacts not linked to any managed inbox are swept by their account's first target;
- exact WhatsApp group subject for groups;
- E.164 phone number in Chatwoot's `phone_number` field;
- the three WAHA custom identity attributes remain intact because WAHA uses
  them for JID/LID lookup, routing and duplicate prevention.

It runs on the Chatwoot host, outside the application image. `run.sh` copies the
Ruby runner into the current Rails container for each execution, so Chatwoot
image replacement does not remove it. Session-scoped read-only WAHA keys are
stored only in `/opt/chatwoot/waha-contact-sync/config.json` with mode `0600`.

Two timers are installed:

- recent activity every minute;
- a full reconciliation nightly at 05:10.

The full run is idempotent. Logs contain only counts and account/inbox/session
metadata; contact names, numbers and identifiers are never logged.
