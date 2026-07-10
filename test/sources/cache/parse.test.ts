import { describe, it, expect } from "vitest";
import { parseReduxStates } from "../../../src/sources/cache/parse.js";
import { dumpCache } from "../../../src/sources/cache/dump.js";
import { locateSlackCacheDir } from "../../../src/sources/cache/locate.js";

const SYNTHETIC_STATE = {
  selfTeamIds: { defaultWorkspaceId: "T0FAKE1", teamId: "T0FAKE1" },
  channels: {
    C1: { id: "C1", name: "general", is_channel: true, is_archived: false },
    D1: { id: "D1", is_im: true, is_archived: false },
  },
  members: {
    U1: { id: "U1", name: "alice", real_name: "Alice", profile: { display_name: "Alice" }, is_bot: false },
  },
  messages: {
    C1: {
      "1.1": { ts: "1.1", type: "message", text: "hello from fixture", user: "U1" },
      "1.2": { ts: "1.2", thread_ts: "1.1", type: "message", text: "a reply", user: "U1" },
      "1.3": { not_a_message: true },
    },
  },
  saved: {
    list: [{ itemType: "message", ts: "1.1", itemId: "C1", dateCreated: 1735689600, todoState: "saved" }],
  },
};

describe("parseReduxStates (synthetic fixture)", () => {
  it("extracts channels, users, messages, and saved items", () => {
    const result = parseReduxStates([{ blobPath: "fixture", value: SYNTHETIC_STATE }]);

    expect(result.workspaceTeamId).toBe("T0FAKE1");
    expect(result.channels.map((c) => c.slackChannelId).sort()).toEqual(["C1", "D1"]);
    expect(result.channels.find((c) => c.slackChannelId === "D1")?.type).toBe("im");
    expect(result.users.length).toBe(1);
    expect(result.users[0].displayName).toBe("Alice");

    expect(result.messages.length).toBe(2);
    const reply = result.messages.find((m) => m.slackTs === "1.2");
    expect(reply?.threadTs).toBe("1.1");
    expect(reply?.text).toBe("a reply");

    expect(result.savedItems.length).toBe(1);
    expect(result.savedItems[0].channelSlackId).toBe("C1");

    // "1.3" has no ts/text/type/subtype shape -> not a message, counted as skipped
    expect(result.skipped).toBe(1);
  });
});

describe("parseReduxStates (integration, real machine)", () => {
  const blobDir = locateSlackCacheDir();

  it.skipIf(!blobDir)("extracts a non-trivial amount of real data", () => {
    const { states } = dumpCache(blobDir!);
    const result = parseReduxStates(states);
    expect(result.channels.length).toBeGreaterThan(0);
    expect(result.messages.length).toBeGreaterThan(0);
  });
});
