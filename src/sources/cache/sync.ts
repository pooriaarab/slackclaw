import type { Repo } from "../../store/repo.js";
import type { ParseResult, ParsedChannel, ParsedMessage, ParsedSavedItem, ParsedUser } from "./parse.js";

export interface SyncSummary {
  channels: number;
  users: number;
  messages: number;
  savedItems: number;
  skipped: number;
}

interface SyncIds {
  repo: Repo;
  workspaceId: number;
  channels: Map<string, number>;
  users: Map<string, number>;
}

function syncChannels(repo: Repo, workspaceId: number, channels: ParsedChannel[]): Map<string, number> {
  const channelIdBySlackId = new Map<string, number>();
  for (const c of channels) {
    const id = repo.upsertChannel({
      workspaceId,
      slackChannelId: c.slackChannelId,
      name: c.name,
      type: c.type,
      isArchived: c.isArchived,
    });
    channelIdBySlackId.set(c.slackChannelId, id);
  }
  return channelIdBySlackId;
}

function syncUsers(repo: Repo, workspaceId: number, users: ParsedUser[]): Map<string, number> {
  const userIdBySlackId = new Map<string, number>();
  for (const u of users) {
    const id = repo.upsertUser({
      workspaceId,
      slackUserId: u.slackUserId,
      name: u.name,
      displayName: u.displayName,
      isBot: u.isBot,
    });
    userIdBySlackId.set(u.slackUserId, id);
  }
  return userIdBySlackId;
}

function syncMessages(ids: SyncIds, messages: ParsedMessage[]): number {
  const capturedAt = new Date().toISOString();
  let messagesUpserted = 0;
  for (const m of messages) {
    let channelId = ids.channels.get(m.channelSlackId);
    if (channelId === undefined) {
      // A message can reference a channel/DM the cache didn't also give us
      // metadata for (e.g. its `channels` entry wasn't cached). Create a
      // minimal stub so the foreign key holds; a later sync can enrich it.
      channelId = ids.repo.upsertChannel({
        workspaceId: ids.workspaceId,
        slackChannelId: m.channelSlackId,
        name: m.channelSlackId,
        type: "public",
        isArchived: false,
      });
      ids.channels.set(m.channelSlackId, channelId);
    }
    const userId = m.userSlackId ? ids.users.get(m.userSlackId) ?? null : null;
    ids.repo.upsertMessage({
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
  return messagesUpserted;
}

function syncSavedItems(ids: SyncIds, savedItems: ParsedSavedItem[]): number {
  let savedItemsUpserted = 0;
  for (const s of savedItems) {
    const channelId = ids.channels.get(s.channelSlackId);
    if (channelId === undefined) continue;
    const message = ids.repo.findMessage(channelId, s.slackTs);
    if (message?.id === undefined) continue;
    ids.repo.upsertSavedItem({ workspaceId: ids.workspaceId, messageId: message.id, savedAt: s.savedAt, note: s.note });
    savedItemsUpserted++;
  }
  return savedItemsUpserted;
}

/** Upserts parsed cache data into the real workspace/channel/user rows it
 * describes (resolved from Slack's own IDs), not a synthetic placeholder --
 * the same (channel_id, slack_ts) unique key this writes under is what lets
 * a later self/bot sync merge into these same rows via Repo's source-priority
 * upsert. */
export function syncFromParsedCache(repo: Repo, parsed: ParseResult): SyncSummary {
  const teamId = parsed.workspaceTeamId ?? "unknown-workspace";
  const workspaceId = repo.upsertWorkspace({ teamId, name: teamId, domain: null, isDefault: true });

  const ids: SyncIds = {
    repo,
    workspaceId,
    channels: syncChannels(repo, workspaceId, parsed.channels),
    users: syncUsers(repo, workspaceId, parsed.users),
  };

  return {
    channels: parsed.channels.length,
    users: parsed.users.length,
    messages: syncMessages(ids, parsed.messages),
    savedItems: syncSavedItems(ids, parsed.savedItems),
    skipped: parsed.skipped,
  };
}
