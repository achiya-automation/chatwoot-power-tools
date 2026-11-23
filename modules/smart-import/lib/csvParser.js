// Parses CSV/TSV text into headers + rows. State machine handles quoted
// fields (RFC-4180 style: "" escapes a quote, quotes may contain delimiters
// and newlines). Auto-detects the delimiter from the first line.
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const delim = detectDelimiter(text.slice(0, (text.indexOf('\n') + 1) || text.length));
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  let fresh = true; // nothing read yet for this field
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === delim) { record.push(field); field = ''; fresh = true; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field); field = ''; fresh = true;
      if (record.length > 1 || record[0] !== '') records.push(record);
      record = [];
      continue;
    }
    // A quote opens a quoted field only as its first character. Inside a field it is text:
    // Hebrew writes דוא"ל and בע"מ with a plain quote, and Excel reads them that way.
    if (ch === '"' && fresh) inQuotes = true;
    else field += ch;
    fresh = false;
  }
  if (field !== '' || record.length) { record.push(field); records.push(record); }
  return { headers: records[0] || [], rows: records.slice(1) };
}

function detectDelimiter(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) { if (ch === '"') { if (line[i + 1] === '"') i++; else inQuotes = false; } }
    else if (ch === '"') inQuotes = i === 0 || line[i - 1] in counts; // same rule as parseCsv
    else if (ch in counts) counts[ch]++;
  }
  return Object.keys(counts).reduce((a, b) => (counts[b] > counts[a] ? b : a), ',');
}
