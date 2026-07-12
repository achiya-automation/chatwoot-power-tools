# Meta compliance audit — drip engine vs. WhatsApp quality rules

Date: 2026-07-12
Scope: `modules/sequences/engine/src/` as deployed on `chatwoot` (account 7, Banana Book).

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

Meta's help page states three requirements for every business-initiated conversation:

1. **Expected** — the customer opted in to receive this information from this business on WhatsApp.
2. **Timely** — tied to a time-bound topic (a seasonal event, a recently browsed/purchased product).
3. **Relevant** — personalised from a prior signal, with a clear call to action.

Its improvement checklist adds: optimise the opt-in UX and **provide a clear way to opt out in the message**; be mindful of frequency ("avoid sending numerous messages in a short time period"); **monitor quality insights** (30-day history, low/medium quality reasons, template quality); check templates added in the last 7 days; follow the Business & Commerce policies.

Enforcement mechanisms behind those words:

| Mechanism | Behaviour |
|---|---|
| **Messaging limits** (changed 2026-05-21) | Portfolio-level, shared by all phone numbers. New portfolio starts at **250**; scaling path → **2,000** → 10,000 → 100,000 → Unlimited. `messaging_limit_tier` is **deprecated** — use `whatsapp_business_manager_messaging_limit`. |
| **Per-user marketing limits** | Adaptive, **cross-business** cap on how many marketing templates one user receives. A **user reply opens a 24h window; marketing sent inside it does not count**. Failure → `131049`. **Wait ≥24h before resending**; excessive retries block that user for up to 24h. |
| **Template pacing** | New / non-GREEN templates are held (`message_status: held_for_quality_assessment`). Bad signal → template `PAUSED`, held messages dropped with **`132015`**. Paced-paused templates need **manual** unpause. |
| **Portfolio pacing** | Portfolios under 500K templates / 365 days get batched. Suspicious signal → remaining messages dropped with **`135000`** + template creation blocked pending review. |
| **Template pausing** | RED quality → paused **3h**, then **6h**, then **disabled**. Meta: *"you should halt any automated messaging campaigns that rely on that template."* |
| **Phone quality** | 7-day rolling, from block reasons (Spam / Didn't sign up / Offensive / No longer needed). `Flagged` and `Restricted` states discontinued 2025-10-07. |

## What the engine already does right

| ✅ | Where |
|---|---|
| Dynamic 24h cap read live from Meta's tier; fails **safe downward** on any Graph error | `meta.js:60-76` |
| Burst smoothing — a full tier is spread over ~1h, never blasted in one tick | `reconcile.js:94-104` (`sendBudget`) |
| `131049` / `130472` classified transient with a **24h** backoff — exactly Meta's "wait at least 24 hours" | `reconcile.js:74`, `:688-707` |
| `MAX_DELIVERY_RETRIES=0` in production — no retry storms (Meta penalises excessive retries with a 24h block) | server env |
| Exact Shabbat / yom-tov windows from Hebcal (Jerusalem, earliest candle-lighting), **fail-closed** when stale | `calendar.js`, `schedule.js:35-57` |
| Quiet hours 21:00–08:00 configured in production | `drip.sequences` |
| One active enrollment per contact — a contact can't be in two sequences at once | `migrations/011:15` |
| Per-contact template variable substitution (`@first_name`, `@name`, `@phone`, `@email`) | `reconcile.js:33-40` |
| Real delivery reconciliation — reads `public.messages.status`, records the Meta error code | `reconcile.js:646-728` |

## Gaps

### 🔴 1. No opt-out detection, no suppression list

The engine has **no inbound handler at all** — `api.js` exposes four routes (`/drip-api/health`, `/media/*`, `POST /drip-api/media`, `POST /drip-api`) and nothing subscribes to Chatwoot's `message_created`. **No code anywhere reads the body of an incoming message**, so "הסר" / "stop" / "unsubscribe" is invisible.

The only substitute — `stop_on_reply`, which halts on *any* reply — is **`false` on all three production sequences** (and `DEFAULT false` in the schema, `migrations/001:6`).

`131050` (Meta's explicit "user is not accepting marketing" signal) is counted in the dashboard (`store.js:644`) but is **not** in `TRANSIENT_DELIVERY_CODES`, so it just marks that one enrollment `failed`. It does **not** clear the contact's `sequence` attribute and there is **no do-not-contact list** — the next `bulk_enroll` re-enrolls them.

Meta: *"provide a clear way to opt-out in the message."* Block reasons feed the 7-day quality rating; "Spam" and "Didn't sign up" are the two most damaging.

### 🔴 2. No opt-in record

Nothing in the schema (migrations 001–019) records consent. Enrollment = someone set a `sequence` custom attribute. Two bulk paths exist with zero consent checkpoint:

- `actionBulkEnroll` (`store.js:431-466`) — enroll every contact carrying a Chatwoot label.
- `modules/smart-import/` — CSV/XLSX contact import.

Full path **cold list → import → label → bulk enroll → template blast** with no gate. This is the root cause of the Banana Book `131049` saturation: a list with no genuine opt-in produces near-zero engagement, which is precisely the input to Meta's adaptive per-user cap.

### 🔴 3. Blind to quality rating

`meta.js:38` requests `fields=messaging_limit_tier` only. The engine never reads:

- the phone number's `quality_rating` (GREEN / YELLOW / RED),
- a template's `quality_score`,
- the `phone_number_quality_update` / `message_template_quality_update` webhooks (there is no webhook receiver).

Meta's checklist item *"Monitor quality-related insights"* has no implementation. A template degrading to RED keeps being sent at full tier pace until Meta pauses it. A tier downgrade is noticed up to **6h** late (the `getDailyCap` cache TTL).

### 🔴 4. `meta.js` reads a deprecated field and is missing the current tier

Two concrete bugs, both introduced by Meta's 2026-05-21 change:

```js
// meta.js:38 — deprecated as of 2026-05-21
`${GRAPH}/${phoneId}?fields=messaging_limit_tier`
// correct field: whatsapp_business_manager_messaging_limit
```

```js
// meta.js:15-23 — TIER_1K no longer exists; TIER_2K is missing
const TIER_LIMITS = { TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_10K: 10000, ... };
```

If Meta returns `TIER_2K`, `tierToCap()` → `undefined` → `DEFAULT_CAP` = **250**. So the moment the account completes the scaling path to 2,000, the engine keeps sending 250/day — **one eighth of what is allowed**. Both failures are safe (under-send, not over-send), but they cap growth.

Also: limits are now **portfolio-level and shared across all phone numbers in the portfolio**, while `used24h` is counted per Chatwoot account (`reconcile.js:288-299`). One portfolio spanning several numbers/accounts → each thinks it owns the whole cap → combined overrun.

### ⚠️ 5. Transient Meta codes treated as permanent

`TRANSIENT_DELIVERY_CODES = {131049, 130472}` (`reconcile.js:74`). Everything else permanently fails the lead. That misclassifies:

- **`132015`** — template paused by pacing/pausing. Transient by definition (3h → 6h). The engine marks the lead `failed` and drops it.
- **`135000`** — portfolio pacing drop. Transient.
- **`368`** — spam block for policy violation. Not handled, and triggers **no throttle and no alert** — the engine keeps sending at full pace.
- **`131047`** — re-engagement required.

There is also no **template-status gate**: nothing checks the template is `APPROVED` (not `PAUSED`) before sending, despite Meta's explicit *"halt any automated messaging campaigns that rely on that template."*

### ⚠️ 6. The 24h customer-service window is never used

Meta: *"If a WhatsApp user responds to a marketing message, it starts a 24-hour customer service window. Marketing messages sent within this window **do not count** towards the [per-user] limit."*

The engine tracks no `last_inbound_at` and has no session/free-form branch — every step is a template regardless. For Banana Book, where the per-user cap **is** the binding constraint, this is the most valuable unused lever: the people who replied are exactly the people you can keep messaging without spending cap.

### ⚠️ 7. No per-contact frequency floor

`delay_days` / `delay_hours` both `DEFAULT 0` with no minimum. A 5-step sequence authored with zero delays sends 5 templates to one contact in ~5 minutes. Meta: *"Avoid sending numerous messages to your customers in a short time period."*

### ⚠️ 8. Quiet-hours release is a synchronised burst

The quiet-hours gate (`reconcile.js:359-367`) `return`s without touching `next_send_at`, so every blocked enrollment stays due and they all fire together at 08:00, bounded only by `perTick`. At TIER_250 that's 5/min (fine); at a higher tier it's a burst that reads as spam.

### ⚠️ 9. Config defaults are unsafe even though production is configured correctly

- `stop_on_reply` — `DEFAULT false`.
- `quiet_start` / `quiet_end` — nullable, **no default** → a sequence saved without them has no quiet hours and can send at 03:00.
- `skip_shabbat` — column is `DEFAULT true`, but `save_sequence` coerces an absent value to **false** (`migrations/018:34`), so any save that omits the flag silently turns Shabbat protection off.

Production currently has all three set safely, but the next sequence created without ticking the boxes will not be.

## Recommended order of work

1. **Opt-out + suppression** — a Chatwoot `message_created` webhook that matches an opt-out keyword, stops the enrollment, clears the `sequence` attribute, and writes the contact to a `drip.suppressed` table that `bulk_enroll` and the reconciler both respect. Same table receives `131050` and `368`. Flip `stop_on_reply=true` on the three live sequences today (one SQL statement, zero code).
2. **Opt-in gate** — a required consent field/label checked before enrollment, plus an opt-out button on the marketing templates themselves.
3. **Fix `meta.js`** — switch to `whatsapp_business_manager_messaging_limit`, add `TIER_2K: 2000`, keep the old field as fallback.
4. **Quality awareness** — request `quality_rating` alongside the tier; read template `quality_score`; refuse to send a template that is not `APPROVED`/GREEN-or-YELLOW; throttle or stop on RED.
5. **Reclassify error codes** — `132015` / `135000` transient; `368` triggers a global stop + alert.
6. **Use the 24h window** — track `last_inbound_at`; prefer repliers; count cap spend only on out-of-window sends.
7. **Frequency floor** — minimum gap between steps; reschedule (not defer) at the quiet-hours edge.
