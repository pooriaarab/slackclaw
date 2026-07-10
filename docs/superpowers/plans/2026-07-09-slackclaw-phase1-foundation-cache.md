# slackclaw Phase 1: Foundation + Cache Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up slackclaw's project skeleton, SQLite+FTS5 schema, and the zero-credential `cache` sync source (parses Slack Desktop's local IndexedDB), wired into a working `slackclaw sync --source cache` + `slackclaw search` CLI.

**Architecture:** TypeScript/Node CLI (`commander`), `better-sqlite3` for storage with an FTS5 virtual table, `classic-level` to open Slack Desktop's Chromium IndexedDB LevelDB directory for raw key/value iteration. Chromium's IndexedDB value encoding is V8 ValueSerializer format with no mature JS decoder — rather than reimplement V8 deserialization from scratch in TS, this plan shells out to the established Python forensics library `ccl_chromium_reader` (MIT-licensed, purpose-built for exactly this format) via a small bundled script, and Node consumes its JSON output. This is the pragmatic choice: writing a correct V8 deserializer from scratch is a multi-week research effort on its own, and a maintained tool for this exact problem already exists.

**Tech Stack:** TypeScript, Node 20+, `commander`, `better-sqlite3`, `classic-level`, Python 3 + `ccl_chromium_reader` (subprocess, cache-decode path only), `vitest` for tests.

**Scope note:** This plan covers Phase 1 only (schema + cache source + `init`/`doctor`/`sync --source cache`/`search`/`messages`). Self-mode (xoxc/xoxd), bot-mode + `tail`, and git snapshot publish/subscribe are independent subsystems per the design spec's own source-priority split and get their own follow-up plans once Phase 1 ships and is testable on its own.

**Delegation:** Per user direction, minimize Claude-token spend on bulk implementation. Each task below is written with a complete, concrete spec (files, code, tests) so it can be handed to `gemini-personal` or GLM 5.2 (via `pi`) as the executing worker; Claude's job is to review the returned diff against this plan's acceptance criteria, not to hand-write the bulk implementation itself. Reference: `glm-delegate` skill (personal-repo only — slackclaw is public/personal, cleared).

---

## File Structure

```
slackclaw/
  package.json
  tsconfig.json
  .gitignore
  src/
    types.ts                   # shared domain types
    config/
      paths.ts                 # slackclaw's own config/data dirs (XDG + macOS)
      config.ts                # load/write config.json
    store/
      schema.sql                # DDL (tables + FTS5 + triggers)
      db.ts                     # open db, run migrations
      repo.ts                   # typed upsert/query helpers
    sources/
      cache/
        locate.ts               # find Slack Desktop's IndexedDB dir per-OS
        pyhelper/
          dump_indexeddb.py     # shells to ccl_chromium_reader, emits JSON lines
        dump.ts                 # spawn python helper, parse JSON lines
        parse.ts                # map decoded IndexedDB records -> domain Message/Channel/User
        sync.ts                 # orchestrate: dump -> parse -> repo.upsert*
    cli/
      index.ts                  # commander entrypoint
      init.ts
      doctor.ts
      sync.ts
      search.ts
      messages.ts
  test/
    store/schema.test.ts
    sources/cache/parse.test.ts
    fixtures/
      sample-indexeddb-records.json   # sanitized real records, captured in Task 6
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "slackclaw",
  "version": "0.1.0",
  "description": "Slack DMs and saved-items scraper. Local archive of your Slack messages claw-able for agents.",
  "type": "module",
  "bin": { "slackclaw": "./dist/cli/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "dev": "tsx src/cli/index.ts"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "classic-level": "^1.4.1",
    "commander": "^12.1.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write .gitignore**

```
node_modules/
dist/
*.db
*.db-journal
.slackclaw/
```

- [ ] **Step 4: Install deps**

Run: `npm install`
Expected: `node_modules/` populated, no error.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore
git commit -m "chore: project scaffold (TS, better-sqlite3, classic-level, commander)"
```

---

### Task 2: Config + paths

**Files:**
- Create: `src/config/paths.ts`
- Create: `src/config/config.ts`
- Test: `test/config/paths.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/config/paths.test.ts
import { describe, it, expect } from "vitest";
import { getConfigDir, getDataDir } from "../../src/config/paths.js";

describe("paths", () => {
  it("returns a config dir under macOS Application Support when no XDG vars set", () => {
    const dir = getConfigDir({ platform: "darwin", env: {}, home: "/Users/test" });
    expect(dir).toBe("/Users/test/Library/Application Support/slackclaw");
  });

  it("respects XDG_CONFIG_HOME on linux", () => {
    const dir = getConfigDir({ platform: "linux", env: { XDG_CONFIG_HOME: "/home/test/.config" }, home: "/home/test" });
    expect(dir).toBe("/home/test/.config/slackclaw");
  });

  it("data dir defaults alongside config dir on macOS", () => {
    const dir = getDataDir({ platform: "darwin", env: {}, home: "/Users/test" });
    expect(dir).toBe("/Users/test/Library/Application Support/slackclaw");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config/paths.test.ts`
Expected: FAIL — `paths.js` not found.

- [ ] **Step 3: Implement**

```typescript
// src/config/paths.ts
import path from "node:path";

export interface PathEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
}

function currentEnv(): PathEnv {
  return { platform: process.platform, env: process.env, home: process.env.HOME ?? "" };
}

export function getConfigDir(e: PathEnv = currentEnv()): string {
  if (e.platform === "darwin") {
    return path.join(e.home, "Library", "Application Support", "slackclaw");
  }
  const xdgConfig = e.env.XDG_CONFIG_HOME ?? path.join(e.home, ".config");
  return path.join(xdgConfig, "slackclaw");
}

export function getDataDir(e: PathEnv = currentEnv()): string {
  if (e.platform === "darwin") {
    return path.join(e.home, "Library", "Application Support", "slackclaw");
  }
  const xdgData = e.env.XDG_DATA_HOME ?? path.join(e.home, ".local", "share");
  return path.join(xdgData, "slackclaw");
}

export function getDbPath(e: PathEnv = currentEnv()): string {
  return path.join(getDataDir(e), "slackclaw.db");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config/paths.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Implement config load/write**

```typescript
// src/config/config.ts
import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "./paths.js";

export interface SlackclawConfig {
  workspaces: { teamId: string; name: string; isDefault: boolean }[];
}

const DEFAULT_CONFIG: SlackclawConfig = { workspaces: [] };

export function loadConfig(): SlackclawConfig {
  const file = path.join(getConfigDir(), "config.json");
  if (!fs.existsSync(file)) return structuredClone(DEFAULT_CONFIG);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveConfig(cfg: SlackclawConfig): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2));
}
```

- [ ] **Step 6: Commit**

```bash
git add src/config test/config
git commit -m "feat: config + XDG/macOS path resolution"
```

---

### Task 3: SQLite schema + db module

**Files:**
- Create: `src/store/schema.sql`
- Create: `src/store/db.ts`
- Create: `src/types.ts`
- Test: `test/store/schema.test.ts`

- [ ] **Step 1: Write shared types**

```typescript
// src/types.ts
export type ChannelType = "public" | "private" | "im" | "mpim";
export type MessageSource = "cache" | "self" | "bot";
export type AttachmentKind = "file" | "image" | "link";
export type MentionKind = "user" | "channel" | "here" | "everyone";

export interface Workspace {
  id?: number;
  teamId: string;
  name: string;
  domain: string | null;
  isDefault: boolean;
}

export interface Channel {
  id?: number;
  workspaceId: number;
  slackChannelId: string;
  name: string;
  type: ChannelType;
  isArchived: boolean;
}

export interface SlackUser {
  id?: number;
  workspaceId: number;
  slackUserId: string;
  name: string;
  displayName: string | null;
  isBot: boolean;
}

export interface Message {
  id?: number;
  channelId: number;
  slackTs: string;
  threadTs: string | null;
  userId: number | null;
  text: string;
  editedTs: string | null;
  source: MessageSource;
  capturedAt: string;
}
```

- [ ] **Step 2: Write schema.sql**

```sql
-- src/store/schema.sql
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  domain TEXT,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  slack_channel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('public','private','im','mpim')),
  is_archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE(workspace_id, slack_channel_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  slack_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  UNIQUE(workspace_id, slack_user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  slack_ts TEXT NOT NULL,
  thread_ts TEXT,
  user_id INTEGER REFERENCES users(id),
  text TEXT NOT NULL,
  edited_ts TEXT,
  source TEXT NOT NULL CHECK(source IN ('cache','self','bot')),
  captured_at TEXT NOT NULL,
  UNIQUE(channel_id, slack_ts)
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  kind TEXT NOT NULL CHECK(kind IN ('file','image','link')),
  local_path TEXT,
  url TEXT,
  text_extract TEXT
);

CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  mentioned_user_id INTEGER REFERENCES users(id),
  mentioned_channel_id INTEGER REFERENCES channels(id),
  kind TEXT NOT NULL CHECK(kind IN ('user','channel','here','everyone'))
);

CREATE TABLE IF NOT EXISTS saved_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  message_id INTEGER NOT NULL REFERENCES messages(id),
  saved_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS sync_state (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  source TEXT NOT NULL CHECK(source IN ('cache','self','bot')),
  cursor TEXT,
  last_synced_at TEXT,
  PRIMARY KEY(workspace_id, channel_id, source)
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text, content='messages', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
```

- [ ] **Step 3: Write db.ts**

```typescript
// src/store/db.ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}
```

- [ ] **Step 4: Write failing test**

```typescript
// test/store/schema.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../src/store/db.js";

describe("schema", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slackclaw-")), "test.db");
  });

  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("creates all core tables", () => {
    const db = openDb(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);
    for (const t of ["workspaces", "channels", "users", "messages", "attachments", "mentions", "saved_items", "sync_state"]) {
      expect(tables).toContain(t);
    }
    db.close();
  });

  it("enforces unique (channel_id, slack_ts) on messages", () => {
    const db = openDb(dbPath);
    db.prepare("INSERT INTO workspaces (team_id, name) VALUES ('T1','Test')").run();
    db.prepare("INSERT INTO channels (workspace_id, slack_channel_id, name, type) VALUES (1,'C1','general','public')").run();
    db.prepare("INSERT INTO messages (channel_id, slack_ts, text, source, captured_at) VALUES (1,'123.456','hi','cache','2026-01-01')").run();
    expect(() =>
      db.prepare("INSERT INTO messages (channel_id, slack_ts, text, source, captured_at) VALUES (1,'123.456','dup','cache','2026-01-01')").run()
    ).toThrow();
    db.close();
  });

  it("keeps messages_fts in sync via triggers", () => {
    const db = openDb(dbPath);
    db.prepare("INSERT INTO workspaces (team_id, name) VALUES ('T1','Test')").run();
    db.prepare("INSERT INTO channels (workspace_id, slack_channel_id, name, type) VALUES (1,'C1','general','public')").run();
    db.prepare("INSERT INTO messages (channel_id, slack_ts, text, source, captured_at) VALUES (1,'1','panic: nil pointer','cache','2026-01-01')").run();
    const rows = db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'panic'").all();
    expect(rows.length).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/store/schema.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/store src/types.ts test/store
git commit -m "feat: SQLite schema with FTS5 search + trigger sync"
```

---

### Task 4: Repo layer (typed upsert/query helpers)

**Files:**
- Create: `src/store/repo.ts`
- Test: `test/store/repo.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/store/repo.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../src/store/db.js";
import { Repo } from "../../src/store/repo.js";

describe("Repo", () => {
  let dbPath: string;
  let repo: Repo;

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slackclaw-")), "test.db");
    repo = new Repo(openDb(dbPath));
  });

  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("upserts a workspace idempotently", () => {
    const id1 = repo.upsertWorkspace({ teamId: "T1", name: "Test", domain: null, isDefault: true });
    const id2 = repo.upsertWorkspace({ teamId: "T1", name: "Test Renamed", domain: null, isDefault: true });
    expect(id1).toBe(id2);
  });

  it("upsertMessage respects source priority: bot > self > cache", () => {
    const wsId = repo.upsertWorkspace({ teamId: "T1", name: "Test", domain: null, isDefault: true });
    const chId = repo.upsertChannel({ workspaceId: wsId, slackChannelId: "C1", name: "general", type: "public", isArchived: false });

    repo.upsertMessage({ channelId: chId, slackTs: "100.1", threadTs: null, userId: null, text: "from cache", editedTs: null, source: "cache", capturedAt: "2026-01-01" });
    repo.upsertMessage({ channelId: chId, slackTs: "100.1", threadTs: null, userId: null, text: "from bot, richer", editedTs: null, source: "bot", capturedAt: "2026-01-02" });

    const msg = repo.findMessage(chId, "100.1");
    expect(msg?.text).toBe("from bot, richer");
    expect(msg?.source).toBe("bot");

    // a later cache-only sync must not clobber the bot row
    repo.upsertMessage({ channelId: chId, slackTs: "100.1", threadTs: null, userId: null, text: "stale cache replay", editedTs: null, source: "cache", capturedAt: "2026-01-03" });
    const after = repo.findMessage(chId, "100.1");
    expect(after?.source).toBe("bot");
    expect(after?.text).toBe("from bot, richer");
  });

  it("searchMessages finds text via FTS5", () => {
    const wsId = repo.upsertWorkspace({ teamId: "T1", name: "Test", domain: null, isDefault: true });
    const chId = repo.upsertChannel({ workspaceId: wsId, slackChannelId: "C1", name: "general", type: "public", isArchived: false });
    repo.upsertMessage({ channelId: chId, slackTs: "1", threadTs: null, userId: null, text: "the launch checklist is done", editedTs: null, source: "cache", capturedAt: "2026-01-01" });
    const results = repo.searchMessages("checklist");
    expect(results.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/store/repo.test.ts`
Expected: FAIL — `repo.js` not found.

- [ ] **Step 3: Implement**

```typescript
// src/store/repo.ts
import type Database from "better-sqlite3";
import type { Channel, Message, SlackUser, Workspace } from "../types.js";

const SOURCE_RANK: Record<Message["source"], number> = { cache: 0, self: 1, bot: 2 };

export class Repo {
  constructor(private db: Database.Database) {}

  upsertWorkspace(w: Workspace): number {
    this.db
      .prepare(
        `INSERT INTO workspaces (team_id, name, domain, is_default) VALUES (@teamId, @name, @domain, @isDefault)
         ON CONFLICT(team_id) DO UPDATE SET name=excluded.name, domain=excluded.domain, is_default=excluded.is_default`
      )
      .run({ ...w, isDefault: w.isDefault ? 1 : 0 });
    return (this.db.prepare("SELECT id FROM workspaces WHERE team_id = ?").get(w.teamId) as any).id;
  }

  upsertChannel(c: Channel): number {
    this.db
      .prepare(
        `INSERT INTO channels (workspace_id, slack_channel_id, name, type, is_archived) VALUES (@workspaceId, @slackChannelId, @name, @type, @isArchived)
         ON CONFLICT(workspace_id, slack_channel_id) DO UPDATE SET name=excluded.name, type=excluded.type, is_archived=excluded.is_archived`
      )
      .run({ ...c, isArchived: c.isArchived ? 1 : 0 });
    return (this.db
      .prepare("SELECT id FROM channels WHERE workspace_id = ? AND slack_channel_id = ?")
      .get(c.workspaceId, c.slackChannelId) as any).id;
  }

  upsertUser(u: SlackUser): number {
    this.db
      .prepare(
        `INSERT INTO users (workspace_id, slack_user_id, name, display_name, is_bot) VALUES (@workspaceId, @slackUserId, @name, @displayName, @isBot)
         ON CONFLICT(workspace_id, slack_user_id) DO UPDATE SET name=excluded.name, display_name=excluded.display_name, is_bot=excluded.is_bot`
      )
      .run({ ...u, isBot: u.isBot ? 1 : 0 });
    return (this.db
      .prepare("SELECT id FROM users WHERE workspace_id = ? AND slack_user_id = ?")
      .get(u.workspaceId, u.slackUserId) as any).id;
  }

  findMessage(channelId: number, slackTs: string): Message | undefined {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE channel_id = ? AND slack_ts = ?")
      .get(channelId, slackTs) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      channelId: row.channel_id,
      slackTs: row.slack_ts,
      threadTs: row.thread_ts,
      userId: row.user_id,
      text: row.text,
      editedTs: row.edited_ts,
      source: row.source,
      capturedAt: row.captured_at,
    };
  }

  /** Upserts a message. Source priority bot > self > cache: an existing row from
   * a higher-ranked source is never overwritten by a lower-ranked resync. */
  upsertMessage(m: Message): void {
    const existing = this.findMessage(m.channelId, m.slackTs);
    if (existing && SOURCE_RANK[existing.source] > SOURCE_RANK[m.source]) {
      return;
    }
    this.db
      .prepare(
        `INSERT INTO messages (channel_id, slack_ts, thread_ts, user_id, text, edited_ts, source, captured_at)
         VALUES (@channelId, @slackTs, @threadTs, @userId, @text, @editedTs, @source, @capturedAt)
         ON CONFLICT(channel_id, slack_ts) DO UPDATE SET
           thread_ts=excluded.thread_ts, user_id=excluded.user_id, text=excluded.text,
           edited_ts=excluded.edited_ts, source=excluded.source, captured_at=excluded.captured_at`
      )
      .run(m);
  }

  searchMessages(query: string, limit = 50): Message[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM messages_fts f JOIN messages m ON m.id = f.rowid
         WHERE f.text MATCH ? ORDER BY rank LIMIT ?`
      )
      .all(query, limit) as any[];
    return rows.map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      slackTs: row.slack_ts,
      threadTs: row.thread_ts,
      userId: row.user_id,
      text: row.text,
      editedTs: row.edited_ts,
      source: row.source,
      capturedAt: row.captured_at,
    }));
  }
}
```

`upsertWorkspace`/`upsertChannel`/`upsertUser` all follow the same write-then-read-back-by-natural-key pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/store/repo.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/store/repo.ts test/store/repo.test.ts
git commit -m "feat: repo layer with source-priority upsert + FTS5 search"
```

---

### Task 5: CLI scaffold — `init` and `doctor`

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/init.ts`
- Create: `src/cli/doctor.ts`

- [ ] **Step 1: Implement init command**

```typescript
// src/cli/init.ts
import { saveConfig, loadConfig } from "../config/config.js";
import { locateSlackCacheDir } from "../sources/cache/locate.js";

export async function runInit(): Promise<void> {
  const cacheDir = locateSlackCacheDir();
  const cfg = loadConfig();
  console.log(cacheDir ? `Found Slack Desktop cache at: ${cacheDir}` : "No local Slack Desktop cache found.");
  saveConfig(cfg);
  console.log("Config written.");
}
```

- [ ] **Step 2: Implement doctor command**

```typescript
// src/cli/doctor.ts
import { locateSlackCacheDir } from "../sources/cache/locate.js";
import { getDbPath } from "../config/paths.js";
import fs from "node:fs";

export interface DoctorReport {
  cacheDirFound: boolean;
  cacheDirPath: string | null;
  dbExists: boolean;
  dbPath: string;
}

export function runDoctor(): DoctorReport {
  const cacheDir = locateSlackCacheDir();
  const dbPath = getDbPath();
  return {
    cacheDirFound: cacheDir !== null,
    cacheDirPath: cacheDir,
    dbExists: fs.existsSync(dbPath),
    dbPath,
  };
}

export function printDoctorReport(r: DoctorReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.log(`cache dir found: ${r.cacheDirFound ? "yes -> " + r.cacheDirPath : "no"}`);
  console.log(`database: ${r.dbExists ? "exists at " + r.dbPath : "not yet created (" + r.dbPath + ")"}`);
}
```

- [ ] **Step 3: Implement CLI entrypoint**

```typescript
// src/cli/index.ts
#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./init.js";
import { runDoctor, printDoctorReport } from "./doctor.js";
import { runSync } from "./sync.js";
import { runSearch } from "./search.js";
import { runMessages } from "./messages.js";

const program = new Command();
program.name("slackclaw").description("Slack DMs and saved-items scraper. Local archive of your Slack messages claw-able for agents.");

program.command("init").action(runInit);

program
  .command("doctor")
  .option("--json", "output JSON")
  .action((opts) => printDoctorReport(runDoctor(), Boolean(opts.json)));

program
  .command("sync")
  .option("--source <source>", "cache|self|bot|all", "cache")
  .option("--full", "ignore incremental cursor")
  .action((opts) => runSync(opts));

program
  .command("search <query>")
  .action((query) => runSearch(query));

program
  .command("messages")
  .requiredOption("--channel <name>")
  .option("--hours <n>", "look back N hours", "24")
  .action((opts) => runMessages(opts));

program.parseAsync(process.argv);
```

- [ ] **Step 4: Manual smoke check**

Run: `npx tsx src/cli/index.ts doctor --json`
Expected: JSON with `cacheDirFound`, `dbExists` fields (sync/search/messages not implemented yet — Task 5 is CLI wiring only, those land in Tasks 6-9).

- [ ] **Step 5: Commit**

```bash
git add src/cli
git commit -m "feat: CLI scaffold (init, doctor, command wiring)"
```

---

### Task 6: Locate Slack Desktop cache dir + inspect real records

**Files:**
- Create: `src/sources/cache/locate.ts`
- Test: `test/sources/cache/locate.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/sources/cache/locate.test.ts
import { describe, it, expect } from "vitest";
import { locateSlackCacheDir } from "../../../src/sources/cache/locate.js";

describe("locateSlackCacheDir", () => {
  it("returns null when no candidate path exists", () => {
    const result = locateSlackCacheDir({
      platform: "darwin",
      home: "/tmp/definitely-does-not-exist-slackclaw-test",
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sources/cache/locate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/sources/cache/locate.ts
import fs from "node:fs";
import path from "node:path";

export interface LocateEnv {
  platform: NodeJS.Platform;
  home: string;
}

const CANDIDATE_SUBPATHS: Record<string, string[]> = {
  darwin: ["Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.leveldb"],
  linux: [".config/Slack/IndexedDB/https_app.slack.com_0.indexeddb.leveldb"],
  win32: ["AppData/Roaming/Slack/IndexedDB/https_app.slack.com_0.indexeddb.leveldb"],
};

export function locateSlackCacheDir(e: LocateEnv = { platform: process.platform, home: process.env.HOME ?? "" }): string | null {
  const candidates = CANDIDATE_SUBPATHS[e.platform] ?? [];
  for (const sub of candidates) {
    const full = path.join(e.home, sub);
    if (fs.existsSync(full)) return full;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sources/cache/locate.test.ts`
Expected: PASS

- [ ] **Step 5: Verify against the real machine**

Run: `npx tsx -e "import('./src/sources/cache/locate.js').then(m => console.log(m.locateSlackCacheDir()))"`
Expected: prints the real path confirmed earlier during design (`~/Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.leveldb`).

- [ ] **Step 6: Commit**

```bash
git add src/sources/cache/locate.ts test/sources/cache/locate.test.ts
git commit -m "feat: locate Slack Desktop IndexedDB cache dir per-OS"
```

---

### Task 7: Python helper — decode IndexedDB records via ccl_chromium_reader

**Files:**
- Create: `src/sources/cache/pyhelper/dump_indexeddb.py`
- Create: `src/sources/cache/pyhelper/requirements.txt`
- Create: `src/sources/cache/dump.ts`
- Test: `test/sources/cache/dump.test.ts`

- [ ] **Step 1: Write requirements.txt**

```
ccl_chromium_reader>=0.11
```

- [ ] **Step 2: Write dump_indexeddb.py**

```python
#!/usr/bin/env python3
"""Reads Slack Desktop's IndexedDB LevelDB dir and emits one decoded record
per line as JSON to stdout. Uses ccl_chromium_reader because Chromium's
IndexedDB values are V8 ValueSerializer-encoded on top of a custom LevelDB
key scheme -- there is no mature from-scratch decoder for this in the JS
ecosystem, and reimplementing V8 deserialization is out of scope for a
cache-parsing task.
"""
import json
import sys

from ccl_chromium_indexeddb import ccl_chromium_indexeddb


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: dump_indexeddb.py <path-to-indexeddb-leveldb-dir>", file=sys.stderr)
        return 2

    leveldb_dir = sys.argv[1]
    wrapper = ccl_chromium_indexeddb.WrappedIndexDB(leveldb_dir)

    count = 0
    skipped = 0
    for db_info in wrapper.database_ids:
        try:
            db = wrapper[db_info.dbid_no]
        except Exception as e:
            print(json.dumps({"__error__": f"open db {db_info.dbid_no} failed: {e}"}), file=sys.stderr)
            continue

        for obj_store_name in db.object_store_names:
            try:
                obj_store = db[obj_store_name]
            except Exception as e:
                print(json.dumps({"__error__": f"open object store {obj_store_name} failed: {e}"}), file=sys.stderr)
                continue

            for record in obj_store.iterate_records():
                try:
                    print(json.dumps({
                        "objectStore": obj_store_name,
                        "key": repr(record.key),
                        "value": record.value,
                    }, default=str))
                    count += 1
                except Exception as e:
                    skipped += 1
                    print(json.dumps({"__error__": f"record decode failed: {e}"}), file=sys.stderr)

    print(json.dumps({"__summary__": True, "decoded": count, "skipped": skipped}), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 3: Implement Node wrapper**

```typescript
// src/sources/cache/dump.ts
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "pyhelper", "dump_indexeddb.py");

export interface RawCacheRecord {
  objectStore: string;
  key: string;
  value: unknown;
}

export interface DumpResult {
  records: RawCacheRecord[];
  skipped: number;
}

/** Spawns the bundled Python helper against a Slack IndexedDB leveldb dir.
 * Fails per-record inside the Python script (logged to stderr, counted);
 * this wrapper never aborts on a single bad record. */
export async function dumpCache(leveldbDir: string): Promise<DumpResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [SCRIPT_PATH, leveldbDir]);
    const records: RawCacheRecord[] = [];
    let skipped = 0;

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on("line", (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.objectStore) records.push(parsed as RawCacheRecord);
      } catch {
        skipped++;
      }
    });

    proc.stderr.on("data", (chunk) => {
      // per-record decode errors and the final summary line land here; not fatal.
      process.stderr.write(chunk);
    });

    proc.on("error", (err) => reject(new Error(`failed to spawn python3: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`dump_indexeddb.py exited with code ${code}`));
        return;
      }
      resolve({ records, skipped });
    });
  });
}
```

- [ ] **Step 4: Write integration test (skips cleanly if python deps missing)**

```typescript
// test/sources/cache/dump.test.ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { locateSlackCacheDir } from "../../../src/sources/cache/locate.js";
import { dumpCache } from "../../../src/sources/cache/dump.js";

function pyDepsAvailable(): boolean {
  try {
    execSync("python3 -c 'import ccl_chromium_indexeddb'", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("dumpCache (integration, real machine)", () => {
  const cacheDir = locateSlackCacheDir();
  const depsOk = pyDepsAvailable();

  it.skipIf(!cacheDir || !depsOk)("dumps at least one record from the real local Slack cache", async () => {
    const result = await dumpCache(cacheDir!);
    expect(result.records.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5: Install python deps and run**

Run:
```bash
pip install -r src/sources/cache/pyhelper/requirements.txt
npx vitest run test/sources/cache/dump.test.ts
```
Expected: PASS with `records.length > 0` against the real cache found in Task 6 Step 5. If `ccl_chromium_indexeddb` import fails, the test skips cleanly rather than failing CI on machines without the python dep — but for this dev machine, install it and confirm the real pass.

- [ ] **Step 6: Manually inspect a handful of decoded records**

Run: `npx tsx -e "
import('./src/sources/cache/locate.js').then(async (loc) => {
  const { dumpCache } = await import('./src/sources/cache/dump.js');
  const dir = loc.locateSlackCacheDir();
  const { records } = await dumpCache(dir);
  console.log(JSON.stringify(records.slice(0, 5), null, 2));
});
"`

This step is manual/exploratory — its output determines the exact field mapping written in Task 8. Slack's Redux-persisted IndexedDB object store names and value shapes are not publicly documented and vary by client version, so Task 8's parser is written against what this step actually observes on this machine, not assumed in advance.

- [ ] **Step 7: Commit**

```bash
git add src/sources/cache/pyhelper src/sources/cache/dump.ts test/sources/cache/dump.test.ts
git commit -m "feat: cache dump via bundled ccl_chromium_reader python helper"
```

---

### Task 8: Cache parser — map decoded records to domain Message/Channel/User

**Files:**
- Create: `src/sources/cache/parse.ts`
- Create: `test/fixtures/sample-indexeddb-records.json` (sanitized output captured from Task 7 Step 6 — replace real workspace/user/message content with synthetic placeholders before committing, keep the real object-store names and value *shape*)
- Test: `test/sources/cache/parse.test.ts`

**This task's exact field-mapping code depends on Task 7 Step 6's findings and cannot be written in advance without guessing at an undocumented format.** Do not skip Task 7 Step 6 to save time — implementing this task from assumption instead of the observed record shape is exactly the kind of unverified guess that produces a parser silently importing zero real messages.

- [ ] **Step 1: Capture sanitized fixture**

From Task 7 Step 6's output, hand-pick 3-5 representative records covering at minimum: one plain channel message, one threaded reply (has `thread_ts`), one DM. Replace real names/text/IDs with clearly-fake placeholders (`"U0FAKE1"`, `"hello from fixture"`) while preserving the exact JSON structure/keys Slack's client actually uses. Save as `test/fixtures/sample-indexeddb-records.json`.

- [ ] **Step 2: Write failing test against the fixture**

```typescript
// test/sources/cache/parse.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { parseCacheRecords } from "../../../src/sources/cache/parse.js";

describe("parseCacheRecords", () => {
  it("maps sanitized fixture records into domain messages", () => {
    const raw = JSON.parse(fs.readFileSync("test/fixtures/sample-indexeddb-records.json", "utf8"));
    const { messages, skipped } = parseCacheRecords(raw);
    expect(messages.length).toBeGreaterThan(0);
    expect(skipped).toBe(0);
    for (const m of messages) {
      expect(m.slackTs).toBeTruthy();
      expect(m.source).toBe("cache");
    }
  });

  it("skips a record it cannot decode instead of throwing", () => {
    const { messages, skipped } = parseCacheRecords([{ objectStore: "unknown-store", key: "x", value: { garbage: true } }]);
    expect(messages.length).toBe(0);
    expect(skipped).toBe(1);
  });
});
```

- [ ] **Step 3: Implement based on the observed shape**

Skeleton to fill in against the real fixture shape (this is the one place in Phase 1 where the implementer must adapt the field names to what Task 7 Step 6 actually printed — the shape below is illustrative, not final):

```typescript
// src/sources/cache/parse.ts
import type { Message } from "../../types.js";
import type { RawCacheRecord } from "./dump.js";

export interface ParseResult {
  messages: Omit<Message, "id" | "channelId" | "userId">[];
  skipped: number;
}

/** Maps raw decoded IndexedDB records to domain messages. Only records from
 * the object store(s) Task 7 Step 6 identified as holding message data are
 * handled; everything else is counted as skipped, never thrown. */
export function parseCacheRecords(records: RawCacheRecord[]): ParseResult {
  const messages: Omit<Message, "id" | "channelId" | "userId">[] = [];
  let skipped = 0;

  for (const rec of records) {
    const parsed = tryParseMessageRecord(rec);
    if (parsed) {
      messages.push(parsed);
    } else {
      skipped++;
    }
  }

  return { messages, skipped };
}

function tryParseMessageRecord(rec: RawCacheRecord): Omit<Message, "id" | "channelId" | "userId"> | null {
  // Fill in against the real object store name(s) and value shape observed
  // in Task 7 Step 6, e.g.:
  // if (rec.objectStore !== "messages") return null;
  // const v = rec.value as any;
  // if (!v?.ts || typeof v.text !== "string") return null;
  // return {
  //   slackTs: v.ts,
  //   threadTs: v.thread_ts ?? null,
  //   text: v.text,
  //   editedTs: v.edited?.ts ?? null,
  //   source: "cache",
  //   capturedAt: new Date().toISOString(),
  // };
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sources/cache/parse.test.ts`
Expected: PASS once `tryParseMessageRecord` is filled in against the real fixture shape.

- [ ] **Step 5: Commit**

```bash
git add src/sources/cache/parse.ts test/fixtures/sample-indexeddb-records.json test/sources/cache/parse.test.ts
git commit -m "feat: parse cache-decoded IndexedDB records into domain messages"
```

---

### Task 9: Wire cache sync into `sync --source cache`

**Files:**
- Create: `src/sources/cache/sync.ts`
- Create: `src/cli/sync.ts`
- Test: `test/sources/cache/sync.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/sources/cache/sync.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../../src/store/db.js";
import { Repo } from "../../../src/store/repo.js";
import { syncFromCacheRecords } from "../../../src/sources/cache/sync.js";

describe("syncFromCacheRecords", () => {
  let dbPath: string;
  let repo: Repo;

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slackclaw-")), "test.db");
    repo = new Repo(openDb(dbPath));
  });

  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("upserts parsed messages under a default workspace/channel", () => {
    const summary = syncFromCacheRecords(repo, {
      messages: [
        { slackTs: "1.1", threadTs: null, text: "hello", editedTs: null, source: "cache", capturedAt: "2026-01-01" },
      ],
      skipped: 0,
    });
    expect(summary.inserted).toBe(1);
    const found = repo.searchMessages("hello");
    expect(found.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sources/cache/sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// src/sources/cache/sync.ts
import type { Repo } from "../../store/repo.js";
import type { ParseResult } from "./parse.js";

export interface SyncSummary {
  inserted: number;
  skipped: number;
}

const CACHE_WORKSPACE = { teamId: "local-cache", name: "Local Slack Cache", domain: null, isDefault: true };
const CACHE_CHANNEL = { slackChannelId: "cache-import", name: "cache-import", type: "im" as const, isArchived: false };

/** Upserts cache-parsed messages into a synthetic workspace/channel until
 * Phase 2 (self-mode) resolves real workspace/channel identity for cache
 * records. Cache-sourced rows still merge correctly against self/bot rows
 * later via the (channel_id, slack_ts) unique key once channel resolution
 * lands, since slack_ts is the real Slack timestamp either way. */
export function syncFromCacheRecords(repo: Repo, parsed: ParseResult): SyncSummary {
  const workspaceId = repo.upsertWorkspace(CACHE_WORKSPACE);
  const channelId = repo.upsertChannel({ workspaceId, ...CACHE_CHANNEL });

  for (const m of parsed.messages) {
    repo.upsertMessage({ channelId, userId: null, ...m });
  }

  return { inserted: parsed.messages.length, skipped: parsed.skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sources/cache/sync.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into CLI**

```typescript
// src/cli/sync.ts
import { openDb } from "../store/db.js";
import { Repo } from "../store/repo.js";
import { getDbPath } from "../config/paths.js";
import { locateSlackCacheDir } from "../sources/cache/locate.js";
import { dumpCache } from "../sources/cache/dump.js";
import { parseCacheRecords } from "../sources/cache/parse.js";
import { syncFromCacheRecords } from "../sources/cache/sync.js";

export async function runSync(opts: { source: string; full?: boolean }): Promise<void> {
  if (opts.source !== "cache" && opts.source !== "all") {
    console.error(`--source ${opts.source} is not implemented yet (Phase 1 covers cache only)`);
    process.exitCode = 1;
    return;
  }

  const cacheDir = locateSlackCacheDir();
  if (!cacheDir) {
    console.error("No local Slack Desktop cache found.");
    process.exitCode = 1;
    return;
  }

  const repo = new Repo(openDb(getDbPath()));
  const dump = await dumpCache(cacheDir);
  const parsed = parseCacheRecords(dump.records);
  const summary = syncFromCacheRecords(repo, parsed);

  console.log(`cache sync: ${summary.inserted} messages upserted, ${summary.skipped} records skipped`);
}
```

- [ ] **Step 6: Real smoke run against this machine**

Run: `npx tsx src/cli/index.ts sync --source cache`
Expected: prints `cache sync: N messages upserted, M records skipped` with N > 0.

- [ ] **Step 7: Commit**

```bash
git add src/sources/cache/sync.ts src/cli/sync.ts test/sources/cache/sync.test.ts
git commit -m "feat: wire cache source into sync --source cache CLI command"
```

---

### Task 10: `search` and `messages` commands

**Files:**
- Create: `src/cli/search.ts`
- Create: `src/cli/messages.ts`

- [ ] **Step 1: Implement search**

```typescript
// src/cli/search.ts
import { openDb } from "../store/db.js";
import { Repo } from "../store/repo.js";
import { getDbPath } from "../config/paths.js";

export function runSearch(query: string): void {
  const repo = new Repo(openDb(getDbPath()));
  const results = repo.searchMessages(query);
  if (results.length === 0) {
    console.log("no matches");
    return;
  }
  for (const m of results) {
    console.log(`[${m.capturedAt}] (${m.source}) ${m.text}`);
  }
}
```

- [ ] **Step 2: Implement messages**

```typescript
// src/cli/messages.ts
import { openDb } from "../store/db.js";
import { getDbPath } from "../config/paths.js";

export function runMessages(opts: { channel: string; hours: string }): void {
  const db = openDb(getDbPath());
  const hoursAgo = new Date(Date.now() - Number(opts.hours) * 3600_000).toISOString();
  const rows = db
    .prepare(
      `SELECT m.captured_at, m.text FROM messages m
       JOIN channels c ON c.id = m.channel_id
       WHERE c.name = ? AND m.captured_at >= ?
       ORDER BY m.captured_at ASC`
    )
    .all(opts.channel, hoursAgo) as any[];
  if (rows.length === 0) {
    console.log(`no messages in #${opts.channel} in the last ${opts.hours}h`);
    return;
  }
  for (const r of rows) {
    console.log(`[${r.captured_at}] ${r.text}`);
  }
}
```

- [ ] **Step 3: Manual smoke run**

Run:
```bash
npx tsx src/cli/index.ts search "the"
npx tsx src/cli/index.ts messages --channel cache-import --hours 24
```
Expected: both print rows from the Task 9 sync run (or "no matches" / "no messages" if the query/channel doesn't hit — not an error either way).

- [ ] **Step 4: Commit**

```bash
git add src/cli/search.ts src/cli/messages.ts
git commit -m "feat: search and messages CLI commands"
```

---

## Deferred to follow-up plans (not this plan)

- **Phase 2 — self-mode sync** (xoxc/xoxd session replay): real workspace/channel identity resolution replaces Task 9's synthetic `local-cache` workspace; full DM + saved-items history.
- **Phase 3 — bot-mode sync + `tail`**: `@slack/web-api` + Socket Mode.
- **Phase 4 — git snapshot `publish`/`subscribe`**: JSONL export, DM redaction default, auto-refresh-on-stale.

Each gets its own spec-reviewed plan once Phase 1 is merged and `sync --source cache` + `search` work end-to-end against this machine's real Slack Desktop install.

---

## Self-Review Notes

- **Spec coverage:** cache source (highest priority per spec), schema (all 8 tables + FTS5), `init`/`doctor`/`sync --source cache`/`search`/`messages` all covered. Self/bot/tail/git-snapshot correctly deferred as their own plans per the spec's own source-priority ordering — not a coverage gap, a scope boundary.
- **Placeholder scan:** Task 8's parser body is intentionally unresolved pending Task 7 Step 6's real-data inspection — this is flagged explicitly as the one unavoidable exception (undocumented binary format, cannot be known without inspecting the real machine first) rather than a lazy TBD; every other task has complete, runnable code.
- **Type consistency:** `Message`/`Channel`/`Workspace`/`SlackUser` field names match across `types.ts`, `schema.sql`, `repo.ts`, `parse.ts`, `sync.ts`, `search.ts`, `messages.ts`.
