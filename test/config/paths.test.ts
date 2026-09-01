// test/config/paths.test.ts
import { describe, it, expect } from "vitest";
import { getConfigDir, getDataDir } from "../../src/config/paths.js";

describe("paths", () => {
  it("returns a config dir under macOS Application Support when no XDG vars set", () => {
    const dir = getConfigDir({ platform: "darwin", env: {}, home: "/Users/test" });
    expect(dir).toBe("/Users/test/Library/Application Support/slackclaw");
  });

  it("respects XDG_CONFIG_HOME on linux", () => {
    const dir = getConfigDir({
      platform: "linux",
      env: { XDG_CONFIG_HOME: "/home/test/.config" },
      home: "/home/test",
    });
    expect(dir).toBe("/home/test/.config/slackclaw");
  });

  it("data dir defaults alongside config dir on macOS", () => {
    const dir = getDataDir({ platform: "darwin", env: {}, home: "/Users/test" });
    expect(dir).toBe("/Users/test/Library/Application Support/slackclaw");
  });
});
