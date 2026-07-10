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
