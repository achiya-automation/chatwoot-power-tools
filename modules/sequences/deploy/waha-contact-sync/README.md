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

- recent activity every three minutes (the ten-minute activity window keeps overlap);
- a full reconciliation nightly at 05:10.

The full run is idempotent. Logs contain only counts and account/inbox/session
metadata; contact names, numbers and identifiers are never logged.

`run.sh full --dry-run` exercises the live read path and scans Chatwoot without
writing contact fields. The wrapper validates the protected config before each
run and forwards the dry-run flag all the way to Rails. If one target becomes
stale, the runner records only safe target metadata, continues with every other
target, and then exits non-zero so systemd monitoring still reports the fault.

The config generator reads only active WAHA sessions with enabled Chatwoot
apps. Lines moved to the interactive engine are managed by that engine's own
Chatwoot bridge and must not remain in this WAHA-only target list.
