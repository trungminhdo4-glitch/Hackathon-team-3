// Minimal RFC-4180 CSV reader (quoted fields, embedded commas/newlines/quotes).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  const s = String(text).replace(/^﻿/, '');
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.some(v => v !== ''));
  return body.map(r => Object.fromEntries(header.map((h, j) => [h.trim(), r[j] ?? ''])));
}
