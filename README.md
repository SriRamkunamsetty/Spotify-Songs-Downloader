# Spotify Songs Downloader

## About

A local, rights-aware MCP server for turning a Spotify liked-songs export into a searchable catalogue and lawful acquisition plan. It is designed for ChatGPT, Claude, and other MCP clients, with parallel research agents and an independent verifier gate before a file can be downloaded.

> This project does not locate or download unauthorized copies of commercial music. It only saves sources with explicit permission, a valid open licence, a purchase entitlement, or a personal licence.

This local MCP server turns a Spotify liked-songs CSV into a searchable catalogue and a **lawful acquisition plan**.

## What it does

- imports a Spotify CSV and reports duplicates, ISRC coverage, and labels;
- produces a review queue, designed for parallel discovery workers plus an independent rights verifier;
- stores only verified, permitted sources; and
- downloads only a source you have recorded with an explicit entitlement: `artist_permission`, `creative_commons`, `public_domain`, `purchased`, or `personal_license`.

This is deliberate: a URL by itself is not proof that a track may be copied. Streaming links are not treated as download sources.

## Install and connect

```powershell
npm install
npm start
```

Add this to a desktop MCP client's configuration (update the path if you move this folder):

```json
{
  "mcpServers": {
    "music-rights": {
      "command": "node",
      "args": ["D:\\Projects\\my songs\\src\\index.js"]
    }
  }
}
```

## Suggested multi-agent workflow

1. Call `import_library` once.
2. Split `create_review_batches` across discovery agents. Each agent may search artist sites, Bandcamp, label stores, the Internet Archive, or other sources that state a download license.
3. A separate verifier agent calls `record_verified_source` only after checking the page and its license/receipt. The verifier should reject stream-only pages and unclear rights.
4. The lead agent calls `list_verified_sources`, reviews the results, then calls `download_verified_files`.

`download_verified_files` saves files under `downloads/`, checks the recorded SHA-256 when provided, and refuses entries without one of the approved entitlements.

## Contributors

- [@SriRamkunamsetty](https://github.com/SriRamkunamsetty)

## Example prompts

- “Import `C:\\Users\\moksh\\Downloads\\Liked_Songs.csv` and summarize my library.”
- “Make 12 review batches for rights-research agents.”
- “For track `<id>`, record this artist-approved download URL and the page that states permission.”
- “Show verified sources needing my review; download only the approved ones.”
