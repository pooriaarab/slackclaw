# slackclaw v1 — Design Spec

Slack analogue of [discrawl](https://github.com/openclaw/discrawl) (Discord mirror-to-SQLite tool). Ports discrawl's architecture — not its source — onto Slack's API/data model. Cache-first: prioritize zero-credential local capture over bot/token setup.

## Goal

Mirror Slack workspace data (channels, DMs, threads, saved items) into local SQLite with full-text search, without requiring a workspace-admin-approved bot install as the default path.

## Language/runtime

TypeScript/Node. Rationale: Slack's own SDK ecosystem (`@slack/bolt`, `@slack/web-api`, Socket Mode) is Node-first; `better-sqlite3` covers FTS5; matches the user's other stacks for easier future maintenance; cheap-tier delegate models (GLM/Gemini) produce more reliable TS than Go. This is architecture/feature parity with discrawl, not a line-for-line Go port.

## Data sources (priority order)

Three independent sync sources, same target schema, distinguished by a `source` column for conflict resolution.

1. **`cache` (default, highest priority to build first)** — parses Slack Desktop's local Electron cache directly, offline, zero credentials, zero network calls:
   - macOS: `~/Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.leveldb` (per-origin IndexedDB) and `~/Library/Application Support/Slack/Local Storage/leveldb`.
   - Confirmed present and actively written on the dev machine — real fixture, no synthetic data needed.
   - Coverage is limited to whatever the desktop client has rendered/cached recently — not full history.
   - One-shot snapshot parse per run (no cursor/pagination concept — it reads whatever's on disk now).
2. **`self`** — Slack session replay via `xoxc` (token) + `xoxd` (cookie), using Slack's internal web-client endpoints as the logged-in user; Enterprise Grid workspaces may require `CUSTOM_TLS` for the same browser-session replay path. Provides full DM history, saved items (`stars.list`/saved API), and private channels already joined. No bot install or workspace-admin approval needed — only requires extracting an already-valid browser/desktop session.
3. **`bot`** — standard Slack app with `xoxb` bot token (`@slack/web-api`): `conversations.list`, `conversations.history`, `conversations.replies`, `users.list`. Only sees channels the bot is invited to. Needed for shared/team archiving and for `tail` (Socket Mode requires a bot app). Lowest priority for v1 since the explicit goal is avoiding bot-token setup where possible.

`sync --source cache|self|bot|all` (default `cache`).

## Schema (SQLite)

```sql
workspaces(id, team_id, name, domain, is_default BOOL)
channels(id, workspace_id, slack_channel_id, name, type CHECK(type IN ('public','private','im','mpim')), is_archived BOOL)
users(id, workspace_id, slack_user_id, name, display_name, is_bot BOOL)
messages(id, channel_id, slack_ts, thread_ts NULL, user_id, text, edited_ts NULL, source CHECK(source IN ('cache','self','bot')), captured_at,
  UNIQUE(channel_id, slack_ts))
attachments(id, message_id, kind CHECK(kind IN ('file','image','link')), local_path NULL, url NULL, text_extract NULL)
mentions(id, message_id, mentioned_user_id NULL, mentioned_channel_id NULL, kind CHECK(kind IN ('user','channel','here','everyone')))
saved_items(id, workspace_id, message_id, saved_at, note NULL)
sync_state(workspace_id, channel_id, source, cursor, last_synced_at)
messages_fts  -- FTS5 virtual table over messages.text, trigger-synced
```

Notes:
- No `threads` table — Slack threads are messages with `thread_ts` pointing at the parent; simpler than Discord's separate thread-channel object.
- `type IN ('im','mpim')` is where DM/group-DM data lands — this is the "DM scraper" surface from the existing README.
- Schema is multi-workspace-ready from day one (cheap now, expensive to retrofit), even though default UX assumes one workspace.
- Merge rule on `(channel_id, slack_ts)` conflict: source priority `bot > self > cache` (richer metadata wins). A cache-only row is never deleted just because a later sync from another source didn't re-surface it — the cache may have captured something outside the API's retrieval window.

## CLI commands

```
slackclaw init                    # discover workspaces (scan local cache dir + configured self/bot creds), write config
slackclaw doctor [--json]         # per-source health: cache-dir-found/leveldb-opened/records-parsed/records-skipped; token present/valid for self+bot
slackclaw sync [--source cache|self|bot|all] [--full]
slackclaw tail                    # live updates via bot Socket Mode; errors clearly if no bot configured (no silent no-op)
slackclaw search "<query>"        # FTS5, defaults to all workspaces
slackclaw messages --channel <name> --hours <n>
slackclaw saved                   # list saved items
slackclaw publish                 # export archive to a private git repo (see below)
slackclaw subscribe <git-url>     # read-only git-snapshot import, no Slack credentials
slackclaw status --json / diagnostics --json / coverage --json / failures --json / metadata --json
slackclaw check-update
```

Sync engine: `cache` does a one-shot diff-and-upsert against current on-disk state each run. `self`/`bot` are cursor-based incremental via `sync_state` (Slack pagination cursor per channel per source); `--full` ignores the cursor and re-walks from oldest.

## Git snapshot publish/subscribe

- `publish` exports to plain files, not the raw `.db` (binary diffs badly in git): `data/<workspace>/<channel>.jsonl` + `manifest.json` (schema version, per-channel cursors, workspace list). Commits + pushes to a private repo.
- `subscribe <git-url>` clones/pulls and rebuilds local SQLite from JSONL on read — pure git, no Slack credentials.
- Auto-refresh: read commands (`search`, `messages`) `git pull` when the local snapshot is older than a configurable threshold (default 15m, matching discrawl).
- **Default redaction**: `publish` excludes `im`/`mpim` channels and `saved_items` unless `--include-dms` is passed explicitly. Public/private channel archives are safe to push to a shared repo by default; DMs stay local unless opted in.

## Error handling

- Cache parser fails per-record, never aborts the whole sync run on one bad IndexedDB value — log + skip + count.
- `doctor` distinguishes "source not configured" / "credential present but rejected" / "valid" per source (cache has no credential concept, so it reports parser health instead).
- Self/bot token expiry is expected and routine; surfaced via `doctor`, not a crash mid-sync.

## Testing

- Cache-record parsing and merge-priority logic: unit tests against sanitized fixtures captured once from the developer's real local leveldb.
- Bot/self API paths: mocked in unit tests, never hit real Slack API in CI.
- Integration smoke test: `sync --source cache` against the developer's real local Slack Desktop install, assert row counts > 0 and FTS5 search returns results. No synthetic data needed for this path since a live cache is available on the dev machine.

## Out of scope for v1

- Terminal archive UI (browsing) — deferred; CLI `search`/`messages` cover read access for now.
- AI-written backup field notes (discrawl feature) — deferred.
- Homebrew tap / Docker distribution — deferred until CLI is stable; `npm`/local build is enough for v1.
- Enterprise Grid multi-team nuances beyond what `self`-mode session replay already handles.

## Delegation plan

Per user direction: minimize Claude/Codex token spend. Design + review stays in Claude; bulk implementation delegated to Gemini (`gemini-personal`) first, GLM 5.2 (`pi`, personal-repo only) second, Codex only if both stall on something correctness-critical.
