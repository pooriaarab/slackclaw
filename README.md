<h1 align="center">💬 slackclaw</h1>

<p align="center">
  <strong>Mirror your Slack workspace into local SQLite for search, querying, and offline inspection.<br>Starts working with zero Slack credentials.</strong>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/pooriaarab/slackclaw" alt="License"></a>
  <img src="https://img.shields.io/badge/node-22%2B-339933" alt="Node 22+">
  <img src="https://img.shields.io/badge/storage-SQLite-003B57" alt="SQLite">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="Platform">
</p>

## Why slackclaw?

Slack search only covers what Slack's UI decides to show you. `slackclaw` pulls your workspace's channels, DMs, threads, and saved items into a local SQLite database with full-text search, so you can query your own message history however you want, including from other tools and agents.

Most Slack archivers assume you're a workspace admin with a bot token to hand out. `slackclaw` doesn't. Its default sync source reads Slack Desktop's own local cache directly, decoding the same data the Slack app already keeps on your disk. No bot install, no admin approval, no token. It works before you've configured anything.

## What it does

- Cache-first sync (default): reads Slack Desktop's local cache, the same on-disk data the app itself uses, and decodes it directly. No bot token, no OAuth, no admin approval needed to get started.
- Local SQLite storage with full-text search backed by SQLite FTS5.
- Workspace, channel, user, and message sync, including thread replies.
- Saved items sync: the messages you've starred or saved in Slack, searchable locally.
- Source-priority merging: cache, self-session, and bot-token data all land in the same rows, with richer sources winning on conflict, so a later higher-fidelity source never loses what cache-only sync already found.

## Not yet included

Actively being built. See the [design spec](./docs/superpowers/specs/2026-07-09-slackclaw-v1-design.md) and [issues](https://github.com/pooriaarab/slackclaw/issues) for what's next:

- Self-session (browser-token) sync, for full history beyond what's locally cached
- Bot-token sync and live tailing, for team/shared-workspace archiving
- Git-backed archive publish/subscribe, for read-only sharing without Slack credentials
- MCP server mode, so agents can query your local archive as a tool
- Scheduled/watch-mode sync

If one of those gaps matters to your workflow, open an issue.

## Requirements

- Node 22+
- Slack Desktop installed and signed in, for the default cache source (macOS and Linux)

## Install

```bash
git clone https://github.com/pooriaarab/slackclaw.git
cd slackclaw
npm install
```

## Quick start

```bash
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts doctor
npx tsx src/cli/index.ts sync --source cache
npx tsx src/cli/index.ts search "launch checklist"
npx tsx src/cli/index.ts messages --channel general --hours 24
```

`doctor` reports whether a local Slack Desktop cache was found and where the local database lives. `sync --source cache` is safe to re-run: it upserts by Slack's own message timestamps, so re-syncing never duplicates rows.

## Commands

- `init`: discover a local Slack Desktop cache and write a starter config
- `doctor [--json]`: check cache availability and local database state
- `sync [--source cache] [--full]`: sync into the local database (cache is the only source implemented so far)
- `search <query>`: full-text search across synced messages
- `messages --channel <name> --hours <n>`: list a channel's recent history

## How it works

Slack Desktop is an Electron app, and its local state (channels, members, message history, saved items) is persisted into IndexedDB. Large values get externalized by Chromium into standalone blob files rather than stored inline. `slackclaw` reads those files directly, decompresses them (Snappy), and deserializes them with Node's own built-in `v8.deserialize()`. No LevelDB library, no external decoder, no native dependencies.

## Prior art and credit

`slackclaw` follows the architecture of [`discrawl`](https://github.com/openclaw/discrawl) (Discord to SQLite) applied to Slack. The Slack Desktop cache-decoding technique above was adapted from [`openclaw/slacrawl`](https://github.com/openclaw/slacrawl) (MIT), which solved the same problem in Go. `slackclaw` reimplements the technique in TypeScript rather than depending on it, since Node's built-in `v8` module means the V8-deserialization step needs no subprocess at all when the host tool is already Node.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Only the repo owner merges PRs. Anyone can open one.

## License

[MIT](./LICENSE)
