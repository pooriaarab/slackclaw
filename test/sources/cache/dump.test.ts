import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import v8 from "node:v8";
import { dumpCache } from "../../../src/sources/cache/dump.js";
import { locateSlackCacheDir } from "../../../src/sources/cache/locate.js";

const V8_HEADER = Buffer.from([0xff, 0x0f]);

describe("dumpCache (synthetic)", () => {
  let blobDir: string;

  beforeEach(() => {
    blobDir = fs.mkdtempSync(path.join(os.tmpdir(), "slackclaw-blob-"));
  });

  afterEach(() => {
    fs.rmSync(blobDir, { recursive: true, force: true });
  });

  it("decodes an uncompressed V8-serialized blob with a message-shaped key", () => {
    const state = { channels: { C1: { id: "C1", name: "general" } }, messages: {} };
    const serialized = v8.serialize(state);
    // no snappy header -> dump.ts treats the whole file as the V8 payload
    fs.writeFileSync(path.join(blobDir, "1"), serialized);

    const result = dumpCache(blobDir);
    expect(result.states.length).toBe(1);
    expect(result.states[0].value.channels.C1.name).toBe("general");
    expect(result.skipped).toBe(0);
  });

  it("skips a blob with no channels/members/messages keys", () => {
    const serialized = v8.serialize({ unrelated: true });
    fs.writeFileSync(path.join(blobDir, "1"), serialized);

    const result = dumpCache(blobDir);
    expect(result.states.length).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("skips a corrupt file instead of throwing", () => {
    fs.writeFileSync(path.join(blobDir, "1"), Buffer.from([0x01, 0x02, 0x03]));
    const result = dumpCache(blobDir);
    expect(result.states.length).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("finds the V8 header even with leading envelope bytes", () => {
    const state = { members: { U1: { id: "U1" } } };
    const payload = v8.serialize(state);
    const withEnvelope = Buffer.concat([Buffer.from([0x00, 0x01, 0x02]), payload]);
    fs.writeFileSync(path.join(blobDir, "1"), withEnvelope);

    const result = dumpCache(blobDir);
    expect(result.states.length).toBe(1);
    expect(result.states[0].value.members.U1.id).toBe("U1");
  });
});

describe("dumpCache (integration, real machine)", () => {
  const blobDir = locateSlackCacheDir();

  it.skipIf(!blobDir)(
    "decodes at least one real state with messages/channels/members from the local Slack Desktop cache",
    () => {
      const result = dumpCache(blobDir!);
      expect(result.states.length).toBeGreaterThan(0);
      const hasRealContent = result.states.some(
        (s) => s.value.channels || s.value.messages || s.value.members,
      );
      expect(hasRealContent).toBe(true);
    },
  );
});
