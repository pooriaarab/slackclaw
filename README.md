# slackclaw

<p align="center">Archive your Slack Desktop cache to local SQLite so you can search it without a bot token.</p>

<p align="center">
  <a href="https://github.com/pooriaarab/slackclaw"><img src="https://img.shields.io/badge/version-0.1.0-informational" alt="version 0.1.0"/></a>
  <a href="https://github.com/pooriaarab/slackclaw/actions"><img src="https://github.com/pooriaarab/slackclaw/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License MIT"/></a>
</p>

```text
$ npx tsx src/cli/index.ts sync --source cache
cache sync: 0 channels, 0 users, 0 messages, 0 saved items upserted, 3 records skipped
```

<p align="center"><em><code>sync --source cache</code> reading Slack Desktop IndexedDB blobs. Blobs that do not decode are skipped.</em></p>

## Install

```bash
git clone https://github.com/pooriaarab/slackclaw.git && cd slackclaw && npm install
npx tsx src/cli/index.ts doctor
```

Needs Node 22. Run the commands from the clone. The default cache source needs Slack Desktop installed and signed in, on macOS or Linux. The locator also has a Windows path; that path is untested.

There is no installable npm package for this repo. The `slackclaw` name on npm is a placeholder (0.0.2) and is not this code. `npm run build` does not copy `schema.sql` into `dist/`, so `node dist/cli/index.js search` fails. Use `npx tsx src/cli/index.ts` after `npm install`.

## Quick start

```bash
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts doctor
npx tsx src/cli/index.ts sync --source cache
npx tsx src/cli/index.ts search "launch checklist"
npx tsx src/cli/index.ts messages --channel general --hours 24
```

```
Found Slack Desktop cache at: ~/Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.blob
Config written.
cache dir found: yes -> ~/Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.blob
database: not yet created (~/Library/Application Support/slackclaw/slackclaw.db)
cache sync: 0 channels, 0 users, 0 messages, 0 saved items upserted, 3 records skipped
no matches
no messages in #general in the last 24h
```

`doctor` reports whether a local Slack Desktop cache was found and where the local database lives. `sync --source cache` is safe to re-run: it upserts by Slack's own message timestamps, so re-syncing never duplicates rows.

A zero upsert count means the parser did not find redux state in the current cache files. Coverage is whatever Slack Desktop has cached, not full workspace history.

## Why

For people who want their own Slack history in local SQLite they can query from a terminal or any tool that opens a database, and who cannot (or do not want to) install a workspace bot.

Slack search only covers what Slack's UI decides to show you. Most Slack archivers assume you are a workspace admin with a bot token. slackclaw's default source reads Slack Desktop's own local cache, the same on-disk data the app already keeps. No bot install, no admin approval, no token.

The alternative that does more of this job today is [slacrawl](https://github.com/openclaw/slacrawl) (Go, MIT), from the same org as [discrawl](https://github.com/openclaw/discrawl). slacrawl already has MCP sync, analytics, retention, and multi-workspace support. I did not know it existed when I started slackclaw. Use that if you want a more complete tool now.

Not for you if you need full history beyond the Desktop cache, live tailing, bot-token team archiving, git publish/subscribe, or an MCP server. Those are in the [design spec](docs/superpowers/specs/2026-07-09-slackclaw-v1-design.md) and [issues](https://github.com/pooriaarab/slackclaw/issues). They are not implemented.

What the cache source does implement:

- Cache-first sync (default): reads Slack Desktop's local cache and decodes it directly
- Local SQLite storage with full-text search (FTS5)
- Workspace, channel, user, and message sync, including thread replies
- Saved items sync: starred or saved messages, searchable locally
- Source-priority merging: cache, self-session, and bot-token rows share keys, with richer sources winning on conflict, so a later source does not drop what cache-only sync already found. Only `cache` writes today.

## init

Discover a local Slack Desktop cache and write a starter config.

```bash
npx tsx src/cli/index.ts init
```

```
Found Slack Desktop cache at: ~/Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.blob
Config written.
```

With no cache:

```
No local Slack Desktop cache found.
Config written.
```

## doctor

Check cache availability and local database state.

```bash
npx tsx src/cli/index.ts doctor
```

```
cache dir found: yes -> ~/Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.blob
database: not yet created (~/Library/Application Support/slackclaw/slackclaw.db)
```

`doctor --json` prints the same report as JSON.

## sync

Write the Desktop cache into the local database. `cache` is the only implemented source. `--source self` and `--source bot` exit with an error. `--source all` currently runs cache. `--full` is accepted and ignored for cache.

```bash
npx tsx src/cli/index.ts sync --source cache
```

```
cache sync: 0 channels, 0 users, 0 messages, 0 saved items upserted, 3 records skipped
```

## search

Full-text search across synced messages. The query is SQLite FTS5 `MATCH` syntax. A hyphen is an operator, not a letter.

```bash
npx tsx src/cli/index.ts search "launch checklist"
```

```
no matches
```

Each hit is one line: `[timestamp] (source) text`.

## messages

List a channel's recent history.

```bash
npx tsx src/cli/index.ts messages --channel general --hours 24
```

```
no messages in #general in the last 24h
```

Each hit is one line: `[timestamp] text`.

## How it works

Slack Desktop is an Electron app. Its local state (channels, members, message history, saved items) lives in IndexedDB. Chromium externalizes large values into standalone blob files rather than storing them inline. slackclaw reads those files, decompresses them (Snappy), and deserializes them with Node's built-in `v8.deserialize()`. No LevelDB library, no external decoder, no extra native decoder.

A blob that fails to decode is skipped and counted. One bad file does not abort the run.

On macOS the archive is `~/Library/Application Support/slackclaw/slackclaw.db`. On Linux it is `$XDG_DATA_HOME/slackclaw/slackclaw.db` or `~/.local/share/slackclaw/slackclaw.db`. Messages upsert on `(channel_id, slack_ts)`. Source rank is `bot > self > cache`.

## Prior art

slackclaw follows the architecture of [discrawl](https://github.com/openclaw/discrawl) (Discord to SQLite) applied to Slack. The V8-deserialization step needs no subprocess here, since Node's built-in `v8` module handles it directly when the host tool is already Node.

[slacrawl](https://github.com/openclaw/slacrawl) (MIT) is a Go CLI from the same org that does the same job for Slack, and does considerably more of it (MCP sync, analytics, retention, multi-workspace).

## Contributing

See [CONTRIBUTING.md](https://github.com/pooriaarab/.github/blob/main/CONTRIBUTING.md). Only the repo owner merges PRs. Anyone can open one.

## License

[MIT](LICENSE)
