export function duplicateSequence(sequence, copySuffix) {
  return {
    ...structuredClone(sequence),
    id: null,
    // The API upserts by key. An empty key takes the editor's new-key path on save.
    key: '',
    name: `${sequence.name} ${copySuffix}`,
    enabled: false,
    enrollEnabled: false,
    sendEnabled: false,
  };
}
export function templateParamCount(template) {
  if (!template) return 0;
  if (Number.isInteger(template.params_count) && template.params_count >= 0) return template.params_count;
  const slots = [...String(template.body || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]));
  return Math.max(0, ...slots);
}
