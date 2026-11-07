export function parseCsv(input) {
  const content = input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (quoted && ch === '"' && content[i + 1] === '"') { cell += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && content[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...records] = rows.filter(r => r.some(c => c !== ''));
  return records.map(r => Object.fromEntries(header.map((name, i) => [name, r[i] ?? ''])));
}

/**
 * Normalize a date string to ISO YYYY-MM-DD.
 * Handles the Spotify 4-column export format (DD-MM-YYYY) and
 * the full export format (already YYYY-MM-DD). Returns null for empty input.
 */
export function normalizeDate(raw) {
  if (!raw) return null;
  // Spotify 4-column export: DD-MM-YYYY  e.g. "10-12-2021"
  const ddmmyyyy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  // Full Spotify export: YYYY-MM-DD — pass through unchanged
  return raw;
}
