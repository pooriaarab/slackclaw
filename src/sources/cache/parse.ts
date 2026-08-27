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

interface RawChannel {
  id?: string;
  name?: string;
  is_im?: unknown;
  is_mpim?: unknown;
  is_private?: unknown;
  is_group?: unknown;
  is_archived?: unknown;
}

interface RawMember {
  id?: string;
  name?: string;
  real_name?: string | null;
  is_bot?: unknown;
  profile?: { display_name?: string | null };
}

interface RawMessage {
  ts?: unknown;
  thread_ts?: unknown;
  type?: unknown;
  text?: string;
  subtype?: unknown;
  reply_count?: unknown;
  user?: string | null;
  edited?: { ts?: unknown };
}

interface RawSavedItem {
  itemType?: unknown;
  itemId?: string;
  ts?: unknown;
  dateCreated: number;
  todoState?: string | null;
}

interface RawReduxState {
  channels?: Record<string, RawChannel>;
  members?: Record<string, RawMember>;
  messages?: Record<string, Record<string, RawMessage> | undefined>;
  saved?: { list?: RawSavedItem[] };
  selfTeamIds?: { defaultWorkspaceId?: string; teamId?: string };
  bootData?: { team_id?: string };
}

interface ParseAcc {
  channels: ParsedChannel[];
  users: ParsedUser[];
  messages: ParsedMessage[];
  savedItems: ParsedSavedItem[];
  skipped: number;
}

function asReduxState(value: Record<string, unknown>): RawReduxState {
  return value as RawReduxState;
}

function channelType(raw: RawChannel): ChannelType {
  if (raw.is_im) return "im";
  if (raw.is_mpim) return "mpim";
  if (raw.is_private || raw.is_group) return "private";
  return "public";
}

function looksLikeMessage(entry: RawMessage | null | undefined): boolean {
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

function workspaceTeamId(value: RawReduxState): string | null {
  return value.selfTeamIds?.defaultWorkspaceId || value.selfTeamIds?.teamId || value.bootData?.team_id || null;
}

function parseChannels(value: RawReduxState, acc: ParseAcc): void {
  for (const raw of Object.values(value.channels ?? {})) {
    if (!raw?.id) {
      acc.skipped++;
      continue;
    }
    acc.channels.push({
      slackChannelId: raw.id,
      name: raw.name || raw.id,
      type: channelType(raw),
      isArchived: Boolean(raw.is_archived),
    });
  }
}

function parseMembers(value: RawReduxState, acc: ParseAcc): void {
  for (const raw of Object.values(value.members ?? {})) {
    if (!raw?.id) {
      acc.skipped++;
      continue;
    }
    acc.users.push({
      slackUserId: raw.id,
      name: raw.name || raw.id,
      displayName: raw.profile?.display_name || raw.real_name || null,
      isBot: Boolean(raw.is_bot),
    });
  }
}

function threadTsOf(entry: RawMessage): string | null {
  if (entry.thread_ts !== null && entry.thread_ts !== undefined) {
    return String(entry.thread_ts);
  }
  return null;
}

function editedTsOf(entry: RawMessage): string | null {
  if (entry.edited?.ts) {
    return String(entry.edited.ts);
  }
  return null;
}

function toParsedMessage(channelId: string, entry: RawMessage): ParsedMessage {
  return {
    channelSlackId: channelId,
    slackTs: String(entry.ts ?? entry.thread_ts),
    threadTs: threadTsOf(entry),
    userSlackId: entry.user ?? null,
    text: entry.text ?? "",
    editedTs: editedTsOf(entry),
  };
}

function parseChannelMessages(channelId: string, byTs: Record<string, RawMessage> | undefined, acc: ParseAcc): void {
  for (const entry of Object.values(byTs ?? {})) {
    if (!looksLikeMessage(entry)) {
      acc.skipped++;
      continue;
    }
    acc.messages.push(toParsedMessage(channelId, entry));
  }
}

function parseMessages(value: RawReduxState, acc: ParseAcc): void {
  for (const [channelId, byTs] of Object.entries(value.messages ?? {})) {
    parseChannelMessages(channelId, byTs, acc);
  }
}

function parseSavedItems(value: RawReduxState, acc: ParseAcc): void {
  for (const raw of value.saved?.list ?? []) {
    if (raw.itemType !== "message" || !raw.itemId || !raw.ts) {
      acc.skipped++;
      continue;
    }
    acc.savedItems.push({
      channelSlackId: raw.itemId,
      slackTs: String(raw.ts),
      savedAt: new Date(raw.dateCreated * 1000).toISOString(),
      note: raw.todoState ?? null,
    });
  }
}

/** Extracts channels, users, messages, and saved items from a decoded redux
 * state. A malformed/unexpected entry is skipped and counted, never thrown --
 * one bad record must not abort the sync. Native Slack IDs are carried
 * through (not DB row ids) so the caller can upsert via Repo's
 * natural-key-based upsert* methods and resolve real row ids itself. */
export function parseReduxStates(states: DecodedReduxState[]): ParseResult {
  const acc: ParseAcc = { channels: [], users: [], messages: [], savedItems: [], skipped: 0 };
  let workspaceTeamIdResult: string | null = null;

  for (const { value } of states) {
    const state = asReduxState(value);
    if (!workspaceTeamIdResult) workspaceTeamIdResult = workspaceTeamId(state);
    parseChannels(state, acc);
    parseMembers(state, acc);
    parseMessages(state, acc);
    parseSavedItems(state, acc);
  }

  return {
    workspaceTeamId: workspaceTeamIdResult,
    channels: acc.channels,
    users: acc.users,
    messages: acc.messages,
    savedItems: acc.savedItems,
    skipped: acc.skipped,
  };
}
