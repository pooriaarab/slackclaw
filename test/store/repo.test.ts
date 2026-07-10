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
