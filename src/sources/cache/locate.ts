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
