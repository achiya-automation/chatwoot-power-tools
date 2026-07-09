/**
 * campaignCost.js — rough per-message cost estimate for a WhatsApp campaign.
 * WhatsApp prices per-message by template category. Rates below are for ISRAEL, in USD
 * (Meta bills in USD). ESTIMATE ONLY: excludes the free 24h customer-service window,
 * free-entry-point (CTWA) windows, and volume-tier discounts — the real invoice is lower.
 *
 * Source: Meta WhatsApp rate card, Israel, effective 2025-07-01 (per-message model);
 * Israel was not among the markets changed in the 2026-01 update. Values verified 2026-07-09.
 * If Meta revises the Israel rate card, update PRICING and PRICING_UPDATED together.
 */
export const PRICING = {
  MARKETING: 0.0353,
  UTILITY: 0.0053,
  AUTHENTICATION: 0.0053,
};
export const PRICING_CURRENCY = 'USD';
export const PRICING_UPDATED = '2026-07-09'; // when these rates were last set/verified

export function estimateCost({ category, sent } = {}) {
  const perMessage = PRICING[String(category || '').toUpperCase()] || 0;
  const n = Number(sent) || 0;
  return {
    perMessage,
    total: Math.round(perMessage * n * 100) / 100,
    currency: PRICING_CURRENCY,
    updated: PRICING_UPDATED,
  };
}
