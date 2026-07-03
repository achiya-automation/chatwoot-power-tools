const STATUSES = ['created', 'updated', 'skipped', 'failed'];

function csvCell(v) {
  const s = v == null ? '' : String(v);
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

  toCsv() {
    const head = 'row,name,status,contact_id,reason';
    const body = this.rows.map((r) =>
      [r.rowNum, r.name, r.status, r.contactId, r.reason].map(csvCell).join(','));
    return [head, ...body].join('\n') + '\n';
  }
}
