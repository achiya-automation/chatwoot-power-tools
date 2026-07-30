// Normalizes a phone string to E.164. Israel-first heuristics; foreign
// numbers that already carry a country code (+ / 00) are preserved.
export function normalizePhone(raw) {
  if (raw == null) return null;
  let d = String(raw).trim().replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.length >= 11 ? d : null;
  if (d.startsWith('00')) { d = d.slice(2); return d.length >= 9 ? '+' + d : null; }
  if (d.startsWith('972')) return d.length >= 11 ? '+' + d : null;
  if (d.startsWith('0')) { d = d.slice(1); return (d.length === 9 || d.length === 8) ? '+972' + d : null; }
  if (d.length === 9) return '+972' + d; // 5XXXXXXXX with no leading zero
  // A bare 10-digit number starting with 5 is an Israeli mobile typed with one digit
  // too many, never a foreign number — every 5X country code needs ≥11 digits total.
  // Restoring '+' here fabricated +5252446876 (Mexico-shaped) out of a typo once;
  // null instead, so the raw value surfaces in the preview as a fixable mistake.
  if (d.length === 10 && d.startsWith('5')) return null;
  // Excel numeric cells silently drop '+': a bare 10-15 digit number that matched no
  // Israeli pattern is a foreign number whose prefix was stripped — restore it.
  if (d.length >= 10 && d.length <= 15) return '+' + d;
  return null;
}
