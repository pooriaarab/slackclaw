// src/sources/cache/locate.ts
import fs from "node:fs";
import path from "node:path";

export interface LocateEnv {
  platform: NodeJS.Platform;
  home: string;
}

// Slack's message/channel/member state lives in the IndexedDB *blob* dir, not
// the leveldb itself -- Chromium externalizes large IndexedDB values (Slack's
// redux-persist state is several MB) to standalone blob files on disk, so no
// leveldb parsing is needed to reach them.
const CANDIDATE_SUBPATHS: Record<string, string[]> = {
  darwin: ["Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.blob"],
  linux: [".config/Slack/IndexedDB/https_app.slack.com_0.indexeddb.blob"],
  win32: ["AppData/Roaming/Slack/IndexedDB/https_app.slack.com_0.indexeddb.blob"],
};

export function locateSlackCacheDir(
  e: LocateEnv = { platform: process.platform, home: process.env.HOME ?? "" },
): string | null {
  const candidates = CANDIDATE_SUBPATHS[e.platform] ?? [];
  for (const sub of candidates) {
    const full = path.join(e.home, sub);
    if (fs.existsSync(full)) return full;
  }
  return null;
}
