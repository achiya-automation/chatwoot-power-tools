const STATUSES = ['created', 'updated', 'skipped', 'failed'];

function csvCell(v) {
  let s = v == null ? '' : String(v);
  // ⚠️ שמות מגיעים מהקובץ שהלקוח העלה. ערך שמתחיל ב-‎= + - @ (או טאב/CR) מתפרש
  // באקסל וב-Sheets כנוסחה ורץ בפתיחת הדוח — גם זה שיורד וגם זה שנשלח במייל.
  // גרש מוביל מנטרל בלי לשנות את מה שהקורא רואה.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export class ImportLog {
  constructor() { this.rows = []; }

  add(rowNum, name, status, contactId, reason) {
    this.rows.push({ rowNum, name: name || '', status, contactId: contactId || '', reason: reason || '' });
  }

  summary() {
    const s = { created: 0, updated: 0, skipped: 0, failed: 0, total: this.rows.length };
    for (const r of this.rows) if (STATUSES.includes(r.status)) s[r.status]++;
    return s;
  }

  // Most frequent failure reason — lets the UI explain a mass failure instead of
  // showing a bare count. Returns { reason, count } or null when nothing failed.
  topError() {
    const counts = new Map();
    for (const r of this.rows) {
      if (r.status !== 'failed' || !r.reason) continue;
      counts.set(r.reason, (counts.get(r.reason) || 0) + 1);
    }
    let top = null;
    for (const [reason, count] of counts) {
      if (!top || count > top.count) top = { reason, count };
    }
    return top;
  }

  toCsv() {
    const head = 'row,name,status,contact_id,reason';
    const body = this.rows.map((r) =>
      [r.rowNum, r.name, r.status, r.contactId, r.reason].map(csvCell).join(','));
    return [head, ...body].join('\n') + '\n';
  }
}
