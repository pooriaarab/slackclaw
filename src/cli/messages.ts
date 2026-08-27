// src/cli/messages.ts
import { openDb } from "../store/db.js";
import { getDbPath } from "../config/paths.js";

interface MessageListRow {
  captured_at: string;
  text: string;
}

export function runMessages(opts: { channel: string; hours: string }): void {
  const db = openDb(getDbPath());
  const hoursAgo = new Date(Date.now() - Number(opts.hours) * 3600_000).toISOString();
  const rows = db
    .prepare(
      `SELECT m.captured_at, m.text FROM messages m
       JOIN channels c ON c.id = m.channel_id
       WHERE c.name = ? AND m.captured_at >= ?
       ORDER BY m.captured_at ASC`
    )
    .all(opts.channel, hoursAgo) as MessageListRow[];
  if (rows.length === 0) {
    console.log(`no messages in #${opts.channel} in the last ${opts.hours}h`);
    return;
  }
  for (const r of rows) {
    console.log(`[${r.captured_at}] ${r.text}`);
  }
}
