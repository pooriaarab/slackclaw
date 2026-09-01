import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb } from "../../../src/store/db.js";
import { Repo } from "../../../src/store/repo.js";
import { syncFromParsedCache } from "../../../src/sources/cache/sync.js";
import type { ParseResult } from "../../../src/sources/cache/parse.js";

describe("syncFromParsedCache", () => {
  let dbPath: string;
  let repo: Repo;

  beforeEach(() => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "slackclaw-")), "test.db");
    repo = new Repo(openDb(dbPath));
  });

  afterEach(() => {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  const parsed: ParseResult = {
    workspaceTeamId: "T0FAKE1",
    channels: [{ slackChannelId: "C1", name: "general", type: "public", isArchived: false }],
    users: [{ slackUserId: "U1", name: "alice", displayName: "Alice", isBot: false }],
    messages: [
      {
        channelSlackId: "C1",
        slackTs: "1.1",
        threadTs: null,
        userSlackId: "U1",
        text: "hello",
        editedTs: null,
      },
    ],
    savedItems: [
      { channelSlackId: "C1", slackTs: "1.1", savedAt: "2026-01-01T00:00:00.000Z", note: "saved" },
    ],
    skipped: 2,
  };

  it("upserts real workspace/channel/user/message/saved-item rows and surfaces them via search", () => {
    const summary = syncFromParsedCache(repo, parsed);
    expect(summary).toEqual({ channels: 1, users: 1, messages: 1, savedItems: 1, skipped: 2 });

    const results = repo.searchMessages("hello");
    expect(results.length).toBe(1);
    expect(results[0].source).toBe("cache");
  });

  it("stubs a channel for a message whose channel metadata wasn't cached", () => {
    const summary = syncFromParsedCache(repo, {
      ...parsed,
      channels: [],
      messages: [
        {
          channelSlackId: "D9",
          slackTs: "2.1",
          threadTs: null,
          userSlackId: null,
          text: "dm",
          editedTs: null,
        },
      ],
      savedItems: [],
    });
    expect(summary.messages).toBe(1);
    expect(repo.searchMessages("dm").length).toBe(1);
  });
});
