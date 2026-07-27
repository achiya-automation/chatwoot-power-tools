# Meta compliance — how the sequences engine protects your WhatsApp number

Sending template messages on a schedule is the fastest way to lose a WhatsApp number. Meta
does not warn you first: quality drops, templates get paused, and the number is throttled or
disabled. This document states the rules the engine is built against, what it does about
each one, and where that lives in the code.

Last reviewed against Meta's documentation: **2026-07-27**.

> **Compliance is a shared responsibility.** The engine enforces what software can enforce —
> rate, timing, consent records, opt-out, quality reaction. It cannot make a cold list warm.
> If you enroll people who never opted in, no amount of throttling will save the number.

## Sources (Meta, official)

- [Tips for Driving High-quality Conversations and Improving Quality Rating on WhatsApp](https://www.facebook.com/business/help/687938765816627)
- [Messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits) — updated 2026-05-21
- [Per-user marketing template message limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits/) — updated 2026-06-17
- [Template pacing](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pacing/)
- [Business portfolio pacing](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/portfolio-pacing/)
- [Template pausing](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pausing/)
- [Template quality rating](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-quality/)
- [About your WhatsApp Business phone number's quality rating](https://www.facebook.com/business/help/896873687365001)

## The rules, condensed

Meta states three requirements for every business-initiated conversation:

1. **Expected** — the customer opted in to receive this information from this business on WhatsApp.
2. **Timely** — tied to a time-bound topic.
3. **Relevant** — personalised from a prior signal, with a clear call to action.

Its improvement checklist adds: optimise the opt-in UX and **provide a clear way to opt out**;
be mindful of frequency ("avoid sending numerous messages in a short time period"); **monitor
quality insights**; follow the Business & Commerce policies.

The enforcement mechanisms behind those words:

| Mechanism | Behaviour |
|---|---|
| **Messaging limits** (changed 2026-05-21) | Portfolio-level, shared by all phone numbers. New portfolio starts at **250**; scaling path → **2,000** → 10,000 → 100,000 → Unlimited. `messaging_limit_tier` is **deprecated** — use `whatsapp_business_manager_messaging_limit`. |
| **Per-user marketing limits** | Adaptive, **cross-business** cap on how many marketing templates one user receives. A **user reply opens a 24h window; marketing sent inside it does not count**. Failure → `131049`. **Wait ≥24h before resending**. |
| **Template pacing** | New / non-GREEN templates are held. Bad signal → template `PAUSED`, held messages dropped with **`132015`**. |
| **Portfolio pacing** | Suspicious signal → remaining messages dropped with **`135000`** + template creation blocked pending review. |
| **Template pausing** | RED quality → paused **3h**, then **6h**, then **disabled**. Meta: *"you should halt any automated messaging campaigns that rely on that template."* |
| **Phone quality** | 7-day rolling, from block reasons (Spam / Didn't sign up / Offensive / No longer needed). |

## What the engine does about each

### Consent is recorded, and required by default

`require_consent` defaults to **true** (`compliance.js`, `DEFAULT_SETTINGS`). Every contact
carries `consent_source` and `consent_at` on `drip.contact_state`; consent older than
`consent_max_age_days` (default **30**) no longer counts. Consent is recorded explicitly —
per contact (`drip.record_consent`) or in bulk from a Chatwoot label (`drip.consent_by_label`).

Enrollment without a consent record is refused, which closes the
**cold list → import → label → bulk enroll → blast** path that produces near-zero engagement
— precisely the input Meta's adaptive per-user cap punishes.

### Opt-out is detected in the customer's own words

`scanInbound` runs every tick (`index.js`) and reads inbound message bodies. `isOptOut`
matches Hebrew and English refusals at **whole-word** level, so "הסרטון" is not read as "הסר".
Matching is deliberately biased toward detection: a missed opt-out costs a block and damages
the number's quality rating for 7 days, while a false positive costs one lead and is
reversible from the dashboard in a click.

A match — or Meta's own `131050` — writes the contact to the suppression list. Suppressed
contacts cannot be re-enrolled, individually or in bulk (`store.js`).

Suppression distinguishes **refusal** from **saturation**: a contact who hit Meta's adaptive
cap (`131049`) is deferred, not removed, because that cap relaxes over time and is waived
inside an open service window. Only a genuine opt-out or an invalid number is permanent.

### Quality is read from Meta, and acted on

`meta.js` requests `whatsapp_business_manager_messaging_limit,messaging_limit_tier,quality_rating`
— the current field with the deprecated one as fallback — and reads per-template
`quality_score` and `status`. `TIER_2K` is mapped (its absence would translate a real
2,000/day allowance into the 250 default).

- A template whose status is not `APPROVED` is **deferred, not failed** — the lead keeps its
  place through Meta's 3h/6h pause. Templates with no known status are sent (fail-open):
  refusing to send on missing information would freeze an account on any Graph hiccup.
- `halt_on_red` stops marketing when Meta reports RED.
- **A delivery floor backs that up.** At low volumes Meta's `quality_rating` returns `UNKNOWN`
  indefinitely and never fires. `checkDeliveryFloor` measures what actually arrives on clean
  templates and halts below `min_delivery_rate` (default 70%, judged on a sample of at least
  20). This catches a burned WABA, broken media, or a Meta policy action that leaves the
  account looking "healthy" while nothing lands.

### Error codes are classified by what they mean, not lumped together

`classifyError` maps each Meta code to an action: `cap` (wait ≥24h, as Meta instructs),
`template_paused`, `pacing`, `transient`, `optout`, `invalid`, `policy` (emergency halt +
alert), `permanent`.

**Unknown codes default to `transient`, not `permanent`.** An unrecognised code is a gap in
our knowledge, not evidence the recipient is unreachable — so the lead cools off and a human
is alerted, instead of being deleted. Permanent removal is reserved for codes that are
certainly final.

### The 24h service window is used

`inSession` detects a contact who replied within 24 hours. Meta does not count marketing sent
inside that window against the per-user limit — so repliers are exempted from the account
halt, the daily cap, and saturation blocks. Answering an open conversation also *improves*
the quality rating that triggered the halt.

### Rate and timing

| Guard | Default |
|---|---|
| Per-contact marketing frequency | `max_marketing_per_day: 1` |
| Portfolio 24h cap | read live from Meta's tier; **fails safe downward** on any Graph error |
| Burst smoothing | a full tier is spread over ~1h, never sent in one tick |
| Quiet hours | **21:00–08:00** by default when a sequence does not specify them |
| Shabbat / yom tov | skipped by default, exact windows from Hebcal (earliest candle-lighting), **fail-closed** when stale |

Blocked sends are **rescheduled to the moment the window opens**, not left due — otherwise
every deferred enrollment fires simultaneously at 08:00, which reads as spam.

### Sends that are certain to fail are never attempted

- **US numbers.** Meta does not deliver marketing templates to US numbers — a rule, not a
  quota. `isUsNumber` recognises them (including the Canadian area codes that share +1) and
  blocks the send rather than burning error budget on a guaranteed failure.
- **Duplicate copy.** Step numbers shift when a step is inserted mid-sequence, which points
  a mid-sequence lead at copy she already received. `templateFamily` resolves a template to
  its content identity (`promo_08`, `promo_08_v2`, `promo_08_v3` → one message in three
  envelopes) so the send path can refuse a repeat.

### Template rotation is bounded on purpose

A template accumulates delivery history; past a point Meta down-ranks it and a fresh copy
delivers better. `max_template_failures` (default **40**) triggers that rotation.

The number is deliberately not lower. Measured over 4,998 sends, controlling for the
recipient's own block history:

| Failures on the template | Delivery |
|---|---|
| 0–9 | 83–86% |
| 10–49 | 67–73% |
| 50+ | **18%** |

A threshold of 10 would rotate every ~32 sends — roughly 15 new templates a month. Mass
creation of near-identical templates is exactly the pattern Meta flags as a spam farm, so an
aggressive threshold would manufacture the problem it was meant to avoid.

## Configuration

All of the above is per-account and editable from the **Compliance** tab. The defaults are
the safe ones; `DEFAULT_SETTINGS` in `modules/sequences/engine/src/compliance.js` is the
single source of truth.

## History

An earlier revision of this document (2026-07-12) audited the engine against these rules and
recorded nine gaps — no opt-out detection, no consent record, no quality awareness, a
deprecated Graph field, over-broad error classification, an unused service window, no
frequency floor, a synchronised quiet-hours burst, and unsafe defaults. All nine were closed;
this document describes the result. The audit is preserved in the git history.
