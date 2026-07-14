/*
 * summarizeEnrollments — מאגד את רשימת ה-enrollments לתמונת-על לפי סדרה.
 * פונקציה טהורה (בלי React/DOM) כדי שתהיה ניתנת לבדיקה ב-node --test.
 *
 * @param {Array} enrollments - [{ sequence_key, sequence_name, status, total_steps }]
 * @param {Array} sequences   - [{ key, name, enabled, steps:[...] }] (כדי להציג גם סדרות ריקות)
 * @returns {{ totals:{total,active,completed,stopped},
 *             perSequence:[{ key,name,enabled,steps,total,active,completed,stopped,completionPct }] }}
 */
export function summarizeEnrollments(enrollments = [], sequences = []) {
  const totals = { total: 0, active: 0, completed: 0, stopped: 0, failed: 0 };
  const bySeq = new Map();

  // seed מכל הסדרות כדי שגם סדרה בלי משויכים תופיע
  for (const s of sequences) {
    if (!s || !s.key) continue;
    bySeq.set(s.key, {
      key: s.key,
      name: s.name || s.key,
      enabled: !!s.enabled,
      // המנוע אוכף לפי שני המתגים האלה בלבד; `enabled` הוא נגזרת שאיש לא מתחזק,
      // ורצף ששולח בפועל יכול לשבת עליה כ-false. הכרטיס מציג את מה שקובע.
      sendEnabled: s.sendEnabled !== false,
      enrollEnabled: s.enrollEnabled !== false,
      steps: Array.isArray(s.steps) ? s.steps.length : 0,
      total: 0, active: 0, completed: 0, stopped: 0, failed: 0,
    });
  }

  for (const e of enrollments) {
    const key = e.sequence_key || '(לא ידוע)';
    if (!bySeq.has(key)) {
      bySeq.set(key, {
        key,
        name: e.sequence_name || key,
        enabled: false,
        sendEnabled: false,
        enrollEnabled: false,
        steps: Number(e.total_steps) || 0,
        total: 0, active: 0, completed: 0, stopped: 0, failed: 0,
      });
    }
    const row = bySeq.get(key);
    row.total += 1;
    totals.total += 1;
    if (row[e.status] != null) row[e.status] += 1;
    if (totals[e.status] != null) totals[e.status] += 1;
  }

  const perSequence = [...bySeq.values()]
    .map((r) => ({
      ...r,
      completionPct: r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name)));

  return { totals, perSequence };
}
