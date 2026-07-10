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
