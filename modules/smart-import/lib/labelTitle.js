// Chatwoot accepts label titles that start with a Unicode letter/number and
// then contain only letters, numbers, underscores, or hyphens.
const VALID_LABEL_TITLE = /^[\p{L}\p{N}][\p{L}\p{N}_-]+$/u;

export function normalizeLabelTitle(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+/, '')
    .replace(/[_-]+$/, '');
}

export function isValidLabelTitle(value) {
  return VALID_LABEL_TITLE.test(String(value ?? ''));
}
