/**
 * campaignCost.js — rough per-message cost estimate for a WhatsApp campaign.
 * WhatsApp (2025) prices per-message by template category. Israel rates, ILS.
 * ESTIMATE ONLY: excludes free-entry-point (CTWA 24h) discounts and volume tiers.
 */
// TODO(pricing): verify vs Meta IL rate card before shipping. Values in ILS per message.
export const PRICING = {
  MARKETING: 0.25,
  UTILITY: 0.05,
  AUTHENTICATION: 0.05,
};

export function estimateCost({ category, sent } = {}) {
  const perMessage = PRICING[String(category || '').toUpperCase()] || 0;
  const n = Number(sent) || 0;
  return { perMessage, total: Math.round(perMessage * n * 100) / 100, currency: 'ILS' };
}
