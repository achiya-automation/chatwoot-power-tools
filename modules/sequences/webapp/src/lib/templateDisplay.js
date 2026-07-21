/**
 * templateDisplay.js — pure display-mapping helpers for the Template Studio list screen
 * (TemplatesView). No React, no DOM: plain functions, trivial to unit test.
 */

// `cls` is a Badge.jsx color key (slate/blue/teal/amber/ruby) — pass straight into
// <Badge color={cls}>. Colors follow the approved design spec (section 3.2: APPROVED
// green/PENDING amber/REJECTED red/IN_APPEAL grey) plus the precedent already shipped
// in ComplianceView.jsx's own template-status map, which treats PAUSED/DISABLED the
// same as REJECTED — ruby + "won't send" — since the spec left those two uncolored.
const STATUS_MAP = {
  APPROVED: { cls: 'teal', he: 'מאושרת', en: 'Approved' },
  PENDING: { cls: 'amber', he: 'ממתינה לאישור', en: 'Pending review' },
  REJECTED: { cls: 'ruby', he: 'נדחתה', en: 'Rejected' },
  PAUSED: { cls: 'ruby', he: 'מושהית', en: 'Paused' },
  DISABLED: { cls: 'ruby', he: 'מושבתת', en: 'Disabled' },
  IN_APPEAL: { cls: 'slate', he: 'בערעור', en: 'In appeal' },
};

// Meta has a few rarer statuses this screen doesn't special-case (PENDING_DELETION,
// LOCKED, LIMIT_EXCEEDED, ARCHIVED, DELETED) — show the raw value rather than hiding it.
export function statusChip(status) {
  return STATUS_MAP[status] || { cls: 'slate', he: status || 'לא ידוע', en: status || 'Unknown' };
}

// `color` is a ready-to-use Tailwind bg-* class for a small dot, e.g. bg-n-teal-9.
const QUALITY_MAP = {
  GREEN: { color: 'bg-n-teal-9', he: 'איכות גבוהה', en: 'High quality' },
  YELLOW: { color: 'bg-n-amber-9', he: 'איכות בינונית', en: 'Medium quality' },
  RED: { color: 'bg-n-ruby-9', he: 'איכות נמוכה', en: 'Low quality' },
  // Meta's own UNKNOWN: not enough delivered volume yet to compute a score.
  UNKNOWN: { color: 'bg-n-slate-8', he: 'איכות לא ידועה (נפח נמוך מדי)', en: 'Unknown quality (too little volume)' },
};
// No quality_score field at all (e.g. brand-new template) — distinct copy from Meta's
// explicit UNKNOWN, same neutral color.
const NO_QUALITY_DATA = { color: 'bg-n-slate-8', he: 'אין נתוני איכות', en: 'No quality data' };

// quality_score arrives from Meta as {score:'GREEN'}, but cached/older copies may carry
// a bare string — accept both defensively. Any unrecognized non-empty value (score name
// Meta doesn't send today) falls back to the UNKNOWN copy rather than looking broken.
export function qualityDot(quality_score) {
  const score = typeof quality_score === 'string' ? quality_score : quality_score && quality_score.score;
  if (!score) return NO_QUALITY_DATA;
  return QUALITY_MAP[score] || QUALITY_MAP.UNKNOWN;
}

const EDITABLE_STATUSES = new Set(['APPROVED', 'REJECTED', 'PAUSED']);

export function canEdit(status) {
  return EDITABLE_STATUSES.has(status);
}

// "name1, name2 · +9725…" — every distinct inbox name on this WABA (deduped), then the
// first inbox's phone (array order, independent of which names survived dedup).
export function groupLabel(waba) {
  const inboxes = (waba && waba.inboxes) || [];
  const names = [...new Set(inboxes.map((i) => (i && i.name) || '').filter(Boolean))];
  const phone = (inboxes[0] && inboxes[0].phone) || '';
  const namePart = names.join(', ');
  if (namePart && phone) return `${namePart} · ${phone}`;
  return namePart || phone || '';
}
