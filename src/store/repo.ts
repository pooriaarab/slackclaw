import type Database from "better-sqlite3";
import type { Channel, Message, SavedItem, SlackUser, Workspace } from "../types.js";

const SOURCE_RANK: Record<Message["source"], number> = { cache: 0, self: 1, bot: 2 };

interface IdRow {
  id: number;
}

interface MessageRow {
  id: number;
  channel_id: number;
  slack_ts: string;
  thread_ts: string | null;
  user_id: number | null;
  text: string;
  edited_ts: string | null;
  source: Message["source"];
  captured_at: string;
}

function requiredId(row: IdRow | undefined): number {
  if (!row) {
    throw new Error("expected row with id");
  }
  return row.id;
}

function messageFromRow(row: MessageRow): Message {
  return {
    id: row.id,
    channelId: row.channel_id,
    slackTs: row.slack_ts,
    threadTs: row.thread_ts,
    userId: row.user_id,
    text: row.text,
    editedTs: row.edited_ts,
    source: row.source,
    capturedAt: row.captured_at,
  };
}

export class Repo {
  constructor(private db: Database.Database) {}

  upsertWorkspace(w: Workspace): number {
    this.db
      .prepare(
        `INSERT INTO workspaces (team_id, name, domain, is_default) VALUES (@teamId, @name, @domain, @isDefault)
         ON CONFLICT(team_id) DO UPDATE SET name=excluded.name, domain=excluded.domain, is_default=excluded.is_default`,
      )
      .run({ ...w, isDefault: w.isDefault ? 1 : 0 });
    return requiredId(
      this.db.prepare("SELECT id FROM workspaces WHERE team_id = ?").get(w.teamId) as
        | IdRow
        | undefined,
    );
  }

  upsertChannel(c: Channel): number {
    this.db
      .prepare(
        `INSERT INTO channels (workspace_id, slack_channel_id, name, type, is_archived) VALUES (@workspaceId, @slackChannelId, @name, @type, @isArchived)
         ON CONFLICT(workspace_id, slack_channel_id) DO UPDATE SET name=excluded.name, type=excluded.type, is_archived=excluded.is_archived`,
      )
      .run({ ...c, isArchived: c.isArchived ? 1 : 0 });
    return requiredId(
      this.db
        .prepare("SELECT id FROM channels WHERE workspace_id = ? AND slack_channel_id = ?")
        .get(c.workspaceId, c.slackChannelId) as IdRow | undefined,
    );
  }

  upsertUser(u: SlackUser): number {
    this.db
      .prepare(
        `INSERT INTO users (workspace_id, slack_user_id, name, display_name, is_bot) VALUES (@workspaceId, @slackUserId, @name, @displayName, @isBot)
         ON CONFLICT(workspace_id, slack_user_id) DO UPDATE SET name=excluded.name, display_name=excluded.display_name, is_bot=excluded.is_bot`,
      )
      .run({ ...u, isBot: u.isBot ? 1 : 0 });
    return requiredId(
      this.db
        .prepare("SELECT id FROM users WHERE workspace_id = ? AND slack_user_id = ?")
        .get(u.workspaceId, u.slackUserId) as IdRow | undefined,
    );
  }

  findMessage(channelId: number, slackTs: string): Message | undefined {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE channel_id = ? AND slack_ts = ?")
      .get(channelId, slackTs) as MessageRow | undefined;
    if (!row) return undefined;
    return messageFromRow(row);
  }

  /** Upserts a message. Source priority bot > self > cache: an existing row from
   * a higher-ranked source is never overwritten by a lower-ranked resync. */
  upsertMessage(m: Message): void {
    const existing = this.findMessage(m.channelId, m.slackTs);
    if (existing && SOURCE_RANK[existing.source] > SOURCE_RANK[m.source]) {
      return;
    }
    this.db
      .prepare(
        `INSERT INTO messages (channel_id, slack_ts, thread_ts, user_id, text, edited_ts, source, captured_at)
         VALUES (@channelId, @slackTs, @threadTs, @userId, @text, @editedTs, @source, @capturedAt)
         ON CONFLICT(channel_id, slack_ts) DO UPDATE SET
           thread_ts=excluded.thread_ts, user_id=excluded.user_id, text=excluded.text,
           edited_ts=excluded.edited_ts, source=excluded.source, captured_at=excluded.captured_at`,
      )
      .run(m);
  }

  /** Upserts by message_id -- the schema has no UNIQUE constraint on
   * saved_items (a message is saved at most once in practice), so dedup is
   * done here rather than via ON CONFLICT. */
  upsertSavedItem(s: SavedItem): void {
    const existing = this.db
      .prepare("SELECT id FROM saved_items WHERE message_id = ?")
      .get(s.messageId) as IdRow | undefined;
    if (existing) {
      this.db
        .prepare("UPDATE saved_items SET saved_at = ?, note = ? WHERE id = ?")
        .run(s.savedAt, s.note, existing.id);
      return;
    }
    this.db
      .prepare(
        "INSERT INTO saved_items (workspace_id, message_id, saved_at, note) VALUES (?, ?, ?, ?)",
      )
      .run(s.workspaceId, s.messageId, s.savedAt, s.note);
  }

  searchMessages(query: string, limit = 50): Message[] {
    const rows = this.db
      .prepare(
        `SELECT m.* FROM messages_fts f JOIN messages m ON m.id = f.rowid
         WHERE f.text MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(query, limit) as MessageRow[];
    return rows.map(messageFromRow);
  }
}
