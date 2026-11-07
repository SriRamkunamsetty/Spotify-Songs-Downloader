import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { parseCsv, normalizeDate } from './csv.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, '.music-rights-mcp');
const dbFile = path.join(dataDir, 'library.json');
const downloadDir = path.join(root, 'downloads');
const entitlements = ['artist_permission', 'creative_commons', 'public_domain', 'purchased', 'personal_license'];

const blankDb = () => ({ tracks: [], sources: [] });
async function db() { try { return JSON.parse(await readFile(dbFile, 'utf8')); } catch { return blankDb(); } }
async function save(value) { await mkdir(dataDir, { recursive: true }); await writeFile(dbFile, JSON.stringify(value, null, 2)); }
const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

// Track ID: prefer ISRC (globally unique), then Spotify URI, then a composite key.
// The 4-column CSV export has none of the first two, so the composite key is used.
const keyFor = t => t.ISRC || t['Track URI'] || `${t['Track Name']}|${t['Artist Name(s)']}|${t['Album Name']}`;

// Map a raw CSV row to the normalised track shape.
// Handles both the full 10-column Spotify export and the minimal 4-column export.
function publicTrack(t) {
  return {
    id: keyFor(t),
    title: t['Track Name'] || '',
    artists: t['Artist Name(s)'] || null,
    album: t['Album Name'] || null,
    isrc: t.ISRC || null,
    spotifyUri: t['Track URI'] || null,
    durationMs: t['Duration (ms)'] ? Number(t['Duration (ms)']) : null,
    releaseDate: normalizeDate(t['Release Date']),
    label: t['Record Label'] || null,
    explicit: t.Explicit === 'true',
  };
}

function safeFilename(source, track) {
  const ext = path.extname(new URL(source.downloadUrl).pathname).replace(/[^.a-z0-9]/gi, '') || '.audio';
  return `${(track.title || source.trackId).replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}_${source.id.slice(0, 8)}${ext}`;
}

const server = new McpServer({ name: 'music-rights-mcp', version: '0.2.0' });

// ─── Tool: import_library ────────────────────────────────────────────────────
server.tool(
  'import_library',
  'Import a Spotify liked-songs CSV into this local, rights-aware catalogue. ' +
  'Supports both the full 10-column Spotify export AND the minimal 4-column export ' +
  '(Track Name, Album Name, Artist Name(s), Release Date). ' +
  'Dates in DD-MM-YYYY format are automatically normalised to ISO YYYY-MM-DD. ' +
  'Duplicate rows (same track liked twice) are detected and skipped. ' +
  'Re-importing replaces existing tracks but preserves recorded sources.',
  { csvPath: z.string().min(1) },
  async ({ csvPath }) => {
    const resolved = path.resolve(csvPath);
    if (path.extname(resolved).toLowerCase() !== '.csv') {
      throw new Error('Only .csv files are accepted.');
    }
    await access(resolved);

    const rawRows = parseCsv(await readFile(resolved, 'utf8'));
    if (!rawRows.length || !rawRows[0]['Track Name']) {
      throw new Error(
        'Could not find a "Track Name" column. ' +
        'Required columns: "Track Name". ' +
        'Optional columns: "Album Name", "Artist Name(s)", "Release Date", ' +
        '"ISRC", "Track URI", "Duration (ms)", "Record Label", "Explicit".'
      );
    }

    // Deduplicate: keep first occurrence of each id, collect skipped titles.
    const seen = new Set();
    const uniqueTracks = [];
    const skippedTitles = [];
    for (const raw of rawRows) {
      const t = publicTrack(raw);
      if (seen.has(t.id)) {
        skippedTitles.push(t.title);
      } else {
        seen.add(t.id);
        uniqueTracks.push(t);
      }
    }

    const data = await db();
    data.tracks = uniqueTracks;
    await save(data);

    const isrcCount = uniqueTracks.filter(t => t.isrc).length;
    const csvFormat = isrcCount === 0 ? '4-column (no ISRC/URI/duration/label)' : '10-column (full)';

    return text({
      imported: uniqueTracks.length,
      duplicatesSkipped: skippedTitles.length,
      csvFormat,
      isrcCoverage: `${isrcCount} / ${uniqueTracks.length}`,
      datesSample: uniqueTracks.slice(0, 3).map(t => t.releaseDate),
      next: 'Run library_summary for an overview, or create_review_batches to begin research.',
      ...(skippedTitles.length && { skippedTitles }),
    });
  }
);

// ─── Tool: library_summary ───────────────────────────────────────────────────
server.tool(
  'library_summary',
  'Summarize the imported catalogue: track count, artist count, year range, label coverage, and research progress.',
  {},
  async () => {
    const data = await db();
    if (!data.tracks.length) {
      return text({ status: 'Library is empty. Use import_library first.' });
    }

    const isrcCount = data.tracks.filter(t => t.isrc).length;
    const labels = [...new Set(data.tracks.map(t => t.label).filter(Boolean))];
    const artists = [
      ...new Set(
        data.tracks
          .flatMap(t => (t.artists || '').split(';').map(a => a.trim()))
          .filter(Boolean)
      ),
    ];
    const years = data.tracks.map(t => t.releaseDate?.slice(0, 4)).filter(Boolean).map(Number);
    const yearRange = years.length
      ? `${Math.min(...years)} – ${Math.max(...years)}`
      : 'unknown';

    const verifiedTrackIds = new Set(data.sources.map(s => s.trackId));

    return text({
      totalTracks: data.tracks.length,
      uniqueArtists: artists.length,
      releaseYearRange: yearRange,
      isrcCoverage: isrcCount
        ? `${isrcCount} / ${data.tracks.length}`
        : 'none — imported from 4-column CSV',
      uniqueLabels: labels.length || 'not available in this CSV format',
      verifiedSources: data.sources.length,
      tracksResearched: verifiedTrackIds.size,
      tracksStillPending: data.tracks.length - verifiedTrackIds.size,
    });
  }
);

// ─── Tool: search_library ────────────────────────────────────────────────────
server.tool(
  'search_library',
  'Search the imported catalogue by title, artist, album, or release year. All fields are case-insensitive substring matches. Returns up to 50 results.',
  {
    query: z.string().min(1).describe('Search term — matched against title, artists, and album'),
    year: z.string().regex(/^\d{4}$/).optional().describe('Filter to a specific release year, e.g. "2024"'),
    limit: z.number().int().min(1).max(50).default(20),
  },
  async ({ query, year, limit }) => {
    const data = await db();
    const q = query.toLowerCase();
    const results = data.tracks.filter(t => {
      const matchesQuery =
        t.title.toLowerCase().includes(q) ||
        (t.artists || '').toLowerCase().includes(q) ||
        (t.album || '').toLowerCase().includes(q);
      const matchesYear = !year || (t.releaseDate || '').startsWith(year);
      return matchesQuery && matchesYear;
    });
    return text({
      total: results.length,
      showing: Math.min(results.length, limit),
      results: results.slice(0, limit),
    });
  }
);

// ─── Tool: create_review_batches ─────────────────────────────────────────────
server.tool(
  'create_review_batches',
  'Split unverified tracks into independent research batches for discovery agents; no downloads occur.',
  { batches: z.number().int().min(1).max(50).default(8) },
  async ({ batches }) => {
    const data = await db();
    const verified = new Set(data.sources.map(s => s.trackId));
    const pending = data.tracks.filter(t => !verified.has(t.id));
    if (!pending.length) return text({ status: 'All tracks already have a verified source recorded.' });
    const groups = Array.from({ length: Math.min(batches, pending.length) }, () => []);
    pending.forEach((track, i) => groups[i % groups.length].push(track));
    return text(
      groups.map((tracks, index) => ({
        batch: index + 1,
        trackCount: tracks.length,
        tracks,
        verifierRule:
          'Accept only an artist/rights-holder page or a store/archival page that explicitly ' +
          'grants a downloadable copy under the declared entitlement. ' +
          'Reject stream-only pages and pages with unclear rights.',
      }))
    );
  }
);

// ─── Tool: record_verified_source ────────────────────────────────────────────
server.tool(
  'record_verified_source',
  'Record a lawful source after independent rights verification. Does not download it.',
  {
    trackId: z.string().min(1),
    downloadUrl: z.string().url(),
    evidenceUrl: z.string().url(),
    entitlement: z.enum(entitlements),
    format: z.string().min(1).max(20),
    sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
    reviewerNote: z.string().min(10).max(1000),
  },
  async input => {
    if (new URL(input.downloadUrl).protocol !== 'https:') {
      throw new Error('Only HTTPS download URLs are accepted.');
    }
    const data = await db();
    if (!data.tracks.some(t => t.id === input.trackId)) {
      throw new Error('Unknown trackId. Import the library first and use the id values from its tracks.');
    }
    const source = { id: randomUUID(), ...input, recordedAt: new Date().toISOString() };
    data.sources.push(source);
    await save(data);
    return text({
      recorded: source.id,
      status: 'awaiting download approval',
      policy: 'Rights were asserted by a verifier; review evidence before downloading.',
    });
  }
);

// ─── Tool: list_verified_sources ─────────────────────────────────────────────
server.tool(
  'list_verified_sources',
  'List recorded legal sources and their evidence for lead-agent or human review.',
  { trackId: z.string().optional() },
  async ({ trackId }) => {
    const data = await db();
    const filtered = data.sources.filter(s => !trackId || s.trackId === trackId);
    return text({ count: filtered.length, sources: filtered });
  }
);

// ─── Tool: remove_source ─────────────────────────────────────────────────────
server.tool(
  'remove_source',
  'Remove a wrongly recorded source by its UUID. Does not affect any downloaded files.',
  { sourceId: z.string().uuid() },
  async ({ sourceId }) => {
    const data = await db();
    const before = data.sources.length;
    data.sources = data.sources.filter(s => s.id !== sourceId);
    if (data.sources.length === before) throw new Error('Source not found.');
    await save(data);
    return text({ removed: sourceId, remaining: data.sources.length });
  }
);

// ─── Tool: download_verified_files ───────────────────────────────────────────
server.tool(
  'download_verified_files',
  'Download only explicitly verified lawful sources to the local downloads/ directory. ' +
  'Each file is streamed, SHA-256 verified (if a hash was recorded), and written atomically.',
  {
    sourceIds: z.array(z.string().uuid()).min(1),
    approvedByUser: z.literal(true),
  },
  async ({ sourceIds }) => {
    const data = await db();
    await mkdir(downloadDir, { recursive: true });
    const outcomes = [];

    for (const id of sourceIds) {
      const source = data.sources.find(s => s.id === id);
      if (!source) { outcomes.push({ id, error: 'Source not found' }); continue; }

      const track = data.tracks.find(t => t.id === source.trackId);
      const target = path.join(downloadDir, safeFilename(source, track));

      try {
        const response = await fetch(source.downloadUrl, { redirect: 'follow' });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

        const temp = `${target}.part`;
        const hash = createHash('sha256');

        await pipeline(
          response.body,
          async function* (chunks) {
            for await (const chunk of chunks) { hash.update(chunk); yield chunk; }
          },
          createWriteStream(temp)
        );

        const digest = hash.digest('hex');
        if (source.sha256 && digest !== source.sha256.toLowerCase()) {
          throw new Error('SHA-256 mismatch — file does not match the recorded source');
        }

        await rename(temp, target);
        outcomes.push({ id, file: target, sha256: digest });
      } catch (error) {
        outcomes.push({ id, error: error.message });
      }
    }

    return text(outcomes);
  }
);

await server.connect(new StdioServerTransport());
