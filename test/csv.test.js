import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, normalizeDate } from '../src/csv.js';

// ─── parseCsv ────────────────────────────────────────────────────────────────

test('parseCsv: parses quoted commas and escaped quotes', () => {
  assert.deepEqual(parseCsv('Name,Artist\n"Hello, World","A ""Singer"""\n'), [
    { Name: 'Hello, World', Artist: 'A "Singer"' }
  ]);
});

test('parseCsv: strips leading UTF-8 BOM', () => {
  assert.deepEqual(parseCsv('\uFEFFTrack URI,ISRC\nspotify:track:123,US123\n'), [
    { 'Track URI': 'spotify:track:123', ISRC: 'US123' }
  ]);
});

test('parseCsv: handles 4-column Spotify export format', () => {
  const csv = 'Track Name,Album Name,Artist Name(s),Release Date\nKalale Kalale,Vishwanath & Sons,G. V. Prakash,13-08-2026\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Track Name'], 'Kalale Kalale');
  assert.equal(rows[0]['Artist Name(s)'], 'G. V. Prakash');
  assert.equal(rows[0]['Release Date'], '13-08-2026');
});

test('parseCsv: handles CRLF line endings', () => {
  const rows = parseCsv('A,B\r\n1,2\r\n');
  assert.deepEqual(rows, [{ A: '1', B: '2' }]);
});

test('parseCsv: skips blank rows', () => {
  const rows = parseCsv('A,B\n1,2\n\n3,4\n');
  assert.equal(rows.length, 2);
});

// ─── normalizeDate ───────────────────────────────────────────────────────────

test('normalizeDate: converts DD-MM-YYYY to YYYY-MM-DD', () => {
  assert.equal(normalizeDate('10-12-2021'), '2021-12-10');
  assert.equal(normalizeDate('13-08-2026'), '2026-08-13');
  assert.equal(normalizeDate('04-07-2026'), '2026-07-04');
});

test('normalizeDate: passes through already-ISO dates unchanged', () => {
  assert.equal(normalizeDate('2021-12-10'), '2021-12-10');
  assert.equal(normalizeDate('2026-08-13'), '2026-08-13');
});

test('normalizeDate: returns null for empty or missing input', () => {
  assert.equal(normalizeDate(''), null);
  assert.equal(normalizeDate(null), null);
  assert.equal(normalizeDate(undefined), null);
});
