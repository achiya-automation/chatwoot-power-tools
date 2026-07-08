/**
 * meta.js — read a WhatsApp number's Meta messaging limit from the Graph API so the engine
 * sends EXACTLY up to what Meta allows: never past the tier (which returns 131049 "healthy
 * ecosystem engagement" blocks), never artificially throttled below it.
 *
 * The tier (250 → 1K → 10K → 100K → unlimited) is raised by Meta automatically as the
 * number's quality and volume grow, so we re-read it periodically and the daily cap follows
 * on its own — no per-account config, and it works for brand-new accounts too (the creds
 * come from the same Chatwoot WhatsApp channel the engine already sends through).
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

// Meta's published messaging tiers → max business-initiated conversations per rolling 24h.
const TIER_LIMITS = {
  TIER_50:        50,
  TIER_250:       250,
  TIER_1K:        1000,
  TIER_10K:       10000,
  TIER_100K:      100000,
  TIER_UNLIMITED: Infinity,
  UNLIMITED:      Infinity,
};

// Conservative fallback when the tier can't be read (Graph hiccup, missing creds): the
// lowest real tier, so a failure throttles DOWN (safe) rather than removing the cap (blocks).
export const DEFAULT_CAP = 250;

/** Map a Meta tier string to its numeric 24h cap (Infinity = unlimited, DEFAULT_CAP if unknown). */
export function tierToCap(tier) {
  if (tier == null) return DEFAULT_CAP;
  const cap = TIER_LIMITS[String(tier).toUpperCase()];
  return cap == null ? DEFAULT_CAP : cap;
}

/** Raw Graph read of messaging_limit_tier for a phone number id. Throws on non-2xx. */
export async function fetchTier(phoneId, token, fetchImpl = fetch) {
  const r = await fetchImpl(`${GRAPH}/${phoneId}?fields=messaging_limit_tier`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Graph messaging_limit_tier ${phoneId} → ${r.status}`);
  const j = await r.json();
  return j.messaging_limit_tier || null;
}

const _cache = new Map(); // accountId -> { cap, tier, at }

/**
 * Cached per-account 24h send cap, derived from Meta's live messaging_limit_tier.
 * Reads creds from Chatwoot (reads.getWhatsappCreds), fetches the tier, maps to a number.
 * NEVER throws — on any failure returns the last known cap, or DEFAULT_CAP — so a Graph
 * outage or a bad token can only throttle DOWN, never remove the cap and unleash a burst.
 *
 * @param {object} reads     - makeDbReads() result (needs getWhatsappCreds)
 * @param {number} accountId
 * @param {Date}   now
 * @param {object} deps      - { fetchTierFn, refreshMs } (injectable for tests)
 * @returns {Promise<number>} 24h conversation cap (Infinity for unlimited tier)
 */
export async function getDailyCap(reads, accountId, now = new Date(), deps = {}) {
  const { fetchTierFn = fetchTier, refreshMs = 6 * 3600 * 1000 } = deps;
  const cached = _cache.get(accountId);
  if (cached && (now.getTime() - cached.at) < refreshMs) return cached.cap;
  try {
    const creds = reads.getWhatsappCreds ? await reads.getWhatsappCreds(accountId) : null;
    if (!creds?.phoneId || !creds?.token) throw new Error('no WhatsApp channel creds');
    const tier = await fetchTierFn(creds.phoneId, creds.token);
    const cap = tierToCap(tier);
    _cache.set(accountId, { cap, tier, at: now.getTime() });
    return cap;
  } catch (e) {
    const fallback = cached?.cap ?? DEFAULT_CAP;
    console.error(`[drip] tier read failed acct ${accountId} (using ${fallback}):`, e.message);
    return fallback;
  }
}

/** Test helper — reset the module-level tier cache. */
export function _resetTierCache() { _cache.clear(); }
