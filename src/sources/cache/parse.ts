import type { ChannelType } from "../../types.js";
import type { DecodedReduxState } from "./dump.js";

export interface ParsedChannel {
  slackChannelId: string;
  name: string;
  type: ChannelType;
  isArchived: boolean;
}

export interface ParsedUser {
  slackUserId: string;
  name: string;
  displayName: string | null;
  isBot: boolean;
}

export interface ParsedMessage {
  channelSlackId: string;
  slackTs: string;
  threadTs: string | null;
  userSlackId: string | null;
  text: string;
  editedTs: string | null;
}

export interface ParsedSavedItem {
  channelSlackId: string;
  slackTs: string;
  savedAt: string;
  note: string | null;
}

export interface ParseResult {
  workspaceTeamId: string | null;
  channels: ParsedChannel[];
  users: ParsedUser[];
  messages: ParsedMessage[];
  savedItems: ParsedSavedItem[];
  skipped: number;
}

function channelType(raw: any): ChannelType {
  if (raw.is_im) return "im";
  if (raw.is_mpim) return "mpim";
  if (raw.is_private || raw.is_group) return "private";
  return "public";
}

function looksLikeMessage(entry: any): boolean {
  if (!entry || typeof entry !== "object") return false;
  const hasTimestamp = typeof entry.ts === "string" || typeof entry.thread_ts === "string";
  if (!hasTimestamp) return false;
  return (
    entry.type === "message" ||
    typeof entry.text === "string" ||
    typeof entry.subtype === "string" ||
    typeof entry.reply_count === "number"
  );
}

function workspaceTeamId(value: any): string | null {
  return value.selfTeamIds?.defaultWorkspaceId || value.selfTeamIds?.teamId || value.bootData?.team_id || null;
}

/** Extracts channels, users, messages, and saved items from a decoded redux
 * state. A malformed/unexpected entry is skipped and counted, never thrown --
 * one bad record must not abort the sync. Native Slack IDs are carried
 * through (not DB row ids) so the caller can upsert via Repo's
 * natural-key-based upsert* methods and resolve real row ids itself. */
export function parseReduxStates(states: DecodedReduxState[]): ParseResult {
  const channels: ParsedChannel[] = [];
  const users: ParsedUser[] = [];
  const messages: ParsedMessage[] = [];
  const savedItems: ParsedSavedItem[] = [];
  let skipped = 0;
  let workspaceTeamIdResult: string | null = null;

  for (const { value } of states) {
    if (!workspaceTeamIdResult) workspaceTeamIdResult = workspaceTeamId(value);

    for (const raw of Object.values(value.channels ?? {}) as any[]) {
      if (!raw?.id) {
        skipped++;
        continue;
      }
      channels.push({
        slackChannelId: raw.id,
        name: raw.name || raw.id,
        type: channelType(raw),
        isArchived: Boolean(raw.is_archived),
      });
    }

    for (const raw of Object.values(value.members ?? {}) as any[]) {
      if (!raw?.id) {
        skipped++;
        continue;
      }
      users.push({
        slackUserId: raw.id,
        name: raw.name || raw.id,
        displayName: raw.profile?.display_name || raw.real_name || null,
        isBot: Boolean(raw.is_bot),
      });
    }

    for (const [channelId, byTs] of Object.entries(value.messages ?? {}) as [string, any][]) {
      for (const entry of Object.values(byTs ?? {}) as any[]) {
        if (!looksLikeMessage(entry)) {
          skipped++;
          continue;
        }
        messages.push({
          channelSlackId: channelId,
          slackTs: String(entry.ts ?? entry.thread_ts),
          threadTs: entry.thread_ts != null ? String(entry.thread_ts) : null,
          userSlackId: entry.user ?? null,
          text: entry.text ?? "",
          editedTs: entry.edited?.ts ? String(entry.edited.ts) : null,
        });
      }
    }

    for (const raw of (value.saved?.list ?? []) as any[]) {
      if (raw.itemType !== "message" || !raw.itemId || !raw.ts) {
        skipped++;
        continue;
      }
      savedItems.push({
        channelSlackId: raw.itemId,
        slackTs: String(raw.ts),
        savedAt: new Date(raw.dateCreated * 1000).toISOString(),
        note: raw.todoState ?? null,
      });
    }
  }

  return { workspaceTeamId: workspaceTeamIdResult, channels, users, messages, savedItems, skipped };
}
