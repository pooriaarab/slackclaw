// src/cli/search.ts
import { openDb } from "../store/db.js";
import { Repo } from "../store/repo.js";
import { getDbPath } from "../config/paths.js";

export function runSearch(query: string): void {
  const repo = new Repo(openDb(getDbPath()));
  const results = repo.searchMessages(query);
  if (results.length === 0) {
    console.log("no matches");
    return;
  }
  for (const m of results) {
    console.log(`[${m.capturedAt}] (${m.source}) ${m.text}`);
  }
}
