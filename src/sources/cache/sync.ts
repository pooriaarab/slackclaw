import type { Repo } from "../../store/repo.js";
import type { ParseResult } from "./parse.js";

export interface SyncSummary {
  channels: number;
  users: number;
  messages: number;
  savedItems: number;
  skipped: number;
}

/** Upserts parsed cache data into the real workspace/channel/user rows it
 * describes (resolved from Slack's own IDs), not a synthetic placeholder --
 * the same (channel_id, slack_ts) unique key this writes under is what lets
 * a later self/bot sync merge into these same rows via Repo's source-priority
 * upsert. */
export function syncFromParsedCache(repo: Repo, parsed: ParseResult): SyncSummary {
  const teamId = parsed.workspaceTeamId ?? "unknown-workspace";
  const workspaceId = repo.upsertWorkspace({ teamId, name: teamId, domain: null, isDefault: true });

  const channelIdBySlackId = new Map<string, number>();
  for (const c of parsed.channels) {
    const id = repo.upsertChannel({
      workspaceId,
      slackChannelId: c.slackChannelId,
      name: c.name,
      type: c.type,
      isArchived: c.isArchived,
    });
    channelIdBySlackId.set(c.slackChannelId, id);
  }

  const userIdBySlackId = new Map<string, number>();
  for (const u of parsed.users) {
    const id = repo.upsertUser({
      workspaceId,
      slackUserId: u.slackUserId,
      name: u.name,
      displayName: u.displayName,
      isBot: u.isBot,
    });
    userIdBySlackId.set(u.slackUserId, id);
  }

  const capturedAt = new Date().toISOString();
  let messagesUpserted = 0;
  for (const m of parsed.messages) {
    let channelId = channelIdBySlackId.get(m.channelSlackId);
    if (channelId === undefined) {
      // A message can reference a channel/DM the cache didn't also give us
      // metadata for (e.g. its `channels` entry wasn't cached). Create a
      // minimal stub so the foreign key holds; a later sync can enrich it.
      channelId = repo.upsertChannel({
        workspaceId,
        slackChannelId: m.channelSlackId,
        name: m.channelSlackId,
        type: "public",
        isArchived: false,
      });
      channelIdBySlackId.set(m.channelSlackId, channelId);
    }
    const userId = m.userSlackId ? userIdBySlackId.get(m.userSlackId) ?? null : null;
    repo.upsertMessage({
      channelId,
      userId,
      slackTs: m.slackTs,
      threadTs: m.threadTs,
      text: m.text,
      editedTs: m.editedTs,
      source: "cache",
      capturedAt,
    });
    messagesUpserted++;
  }

  let savedItemsUpserted = 0;
  for (const s of parsed.savedItems) {
    const channelId = channelIdBySlackId.get(s.channelSlackId);
    if (channelId === undefined) continue;
    const message = repo.findMessage(channelId, s.slackTs);
    if (message?.id === undefined) continue;
    repo.upsertSavedItem({ workspaceId, messageId: message.id, savedAt: s.savedAt, note: s.note });
    savedItemsUpserted++;
  }

  return {
    channels: parsed.channels.length,
    users: parsed.users.length,
    messages: messagesUpserted,
    savedItems: savedItemsUpserted,
    skipped: parsed.skipped,
  };
}
