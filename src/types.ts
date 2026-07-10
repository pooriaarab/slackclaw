export type ChannelType = "public" | "private" | "im" | "mpim";
export type MessageSource = "cache" | "self" | "bot";
export type AttachmentKind = "file" | "image" | "link";
export type MentionKind = "user" | "channel" | "here" | "everyone";

export interface Workspace {
  id?: number;
  teamId: string;
  name: string;
  domain: string | null;
  isDefault: boolean;
}

export interface Channel {
  id?: number;
  workspaceId: number;
  slackChannelId: string;
  name: string;
  type: ChannelType;
  isArchived: boolean;
}

export interface SlackUser {
  id?: number;
  workspaceId: number;
  slackUserId: string;
  name: string;
  displayName: string | null;
  isBot: boolean;
}

export interface Message {
  id?: number;
  channelId: number;
  slackTs: string;
  threadTs: string | null;
  userId: number | null;
  text: string;
  editedTs: string | null;
  source: MessageSource;
  capturedAt: string;
}
