import { openDb } from "../store/db.js";
import { Repo } from "../store/repo.js";
import { getDbPath } from "../config/paths.js";
import { locateSlackCacheDir } from "../sources/cache/locate.js";
import { dumpCache } from "../sources/cache/dump.js";
import { parseReduxStates } from "../sources/cache/parse.js";
import { syncFromParsedCache } from "../sources/cache/sync.js";

export async function runSync(opts: { source: string; full?: boolean }): Promise<void> {
  if (opts.source !== "cache" && opts.source !== "all") {
    console.error(`--source ${opts.source} is not implemented yet (Phase 1 covers cache only)`);
    process.exitCode = 1;
    return;
  }

  const blobDir = locateSlackCacheDir();
  if (!blobDir) {
    console.error("No local Slack Desktop cache found.");
    process.exitCode = 1;
    return;
  }

  const repo = new Repo(openDb(getDbPath()));
  const dump = dumpCache(blobDir);
  const parsed = parseReduxStates(dump.states);
  const summary = syncFromParsedCache(repo, parsed);

  console.log(
    `cache sync: ${summary.channels} channels, ${summary.users} users, ${summary.messages} messages, ` +
      `${summary.savedItems} saved items upserted, ${summary.skipped + dump.skipped} records skipped`
  );
}
