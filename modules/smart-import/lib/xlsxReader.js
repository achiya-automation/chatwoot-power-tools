import { parseCsv } from './csvParser.js';

// Normalizes SheetJS's sheet_to_json(header:1) output (array-of-arrays, mixed
// types) into string headers + string rows, padded to header width.
export function parseXlsxAoA(aoa) {
  const headers = (aoa[0] || []).map((h) => String(h ?? '').trim());
  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const cells = headers.map((_, j) => (r[j] == null ? '' : String(r[j])));
    if (cells.some((c) => c.trim() !== '')) rows.push(cells);
  }
  return { headers, rows };
}

// Browser entry: picks parser by extension. loadXlsx() must resolve to the
// global XLSX object (script injected lazily, same-origin).
export async function readFileToTable(file, { loadXlsx } = {}) {
  const isXlsx = /\.xlsx?$/i.test(file.name);
  if (!isXlsx) return parseCsv(await file.text());
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return parseXlsxAoA(aoa);
}
