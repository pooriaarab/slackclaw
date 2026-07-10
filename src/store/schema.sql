-- src/store/schema.sql
CREATE TABLE IF NOT EXISTS workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  domain TEXT,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  slack_channel_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('public','private','im','mpim')),
  is_archived INTEGER NOT NULL DEFAULT 0,
  UNIQUE(workspace_id, slack_channel_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  slack_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0,
  UNIQUE(workspace_id, slack_user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  slack_ts TEXT NOT NULL,
  thread_ts TEXT,
  user_id INTEGER REFERENCES users(id),
  text TEXT NOT NULL,
  edited_ts TEXT,
  source TEXT NOT NULL CHECK(source IN ('cache','self','bot')),
  captured_at TEXT NOT NULL,
  UNIQUE(channel_id, slack_ts)
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  kind TEXT NOT NULL CHECK(kind IN ('file','image','link')),
  local_path TEXT,
  url TEXT,
  text_extract TEXT
);

CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  mentioned_user_id INTEGER REFERENCES users(id),
  mentioned_channel_id INTEGER REFERENCES channels(id),
  kind TEXT NOT NULL CHECK(kind IN ('user','channel','here','everyone'))
);

CREATE TABLE IF NOT EXISTS saved_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  message_id INTEGER NOT NULL REFERENCES messages(id),
  saved_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS sync_state (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
  channel_id INTEGER NOT NULL REFERENCES channels(id),
  source TEXT NOT NULL CHECK(source IN ('cache','self','bot')),
  cursor TEXT,
  last_synced_at TEXT,
  PRIMARY KEY(workspace_id, channel_id, source)
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text, content='messages', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.id, old.text);
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.id, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
END;
