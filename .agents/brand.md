# slackclaw brand

Use this file for identity and language decisions. Use `.agents/design.md` for
terminal output rules.

## Identity

slackclaw mirrors Slack Desktop data into a local SQLite archive for search and
offline inspection. It is a command-line tool for a user's own message history.

Write **slackclaw** in lowercase everywhere. Use backticks for commands and the
binary name in prose. Do not use Slackclaw, SlackClaw, or SLACKCLAW.

## Promise

Make a user's Slack history locally searchable without requiring credentials
for the default cache source.

## Principles

- Local first. Keep the archive on the user's machine by default.
- Clear. Explain what the command found, changed, or could not access.
- Quiet. Produce compact output that works in a terminal and a pipe.
- Honest. Separate implemented sources from planned sources.
- Respectful. Treat every message and local path as private.

## Voice

Use direct, technical language without ceremony. Lead with the result. Give a
specific next step when a check fails. Keep empty states short and lowercase.

Use the claw metaphor only in the product name or occasional descriptive copy.
Do not fill commands, errors, or status lines with claw jokes.

## Name and mark

The project has no committed logo file. The README uses a speech-bubble emoji
as decoration beside the lowercase name. It is not a standalone product mark.

Do not use Slack artwork as the slackclaw logo. Do not imply that the project
is an official Slack product. Third-party badges describe license, runtime,
storage, and platform support. Their colors are not brand colors.

## Product language

Prefer these terms:

- local archive
- Slack Desktop cache
- cache source
- sync
- message history
- full-text search
- SQLite database
- workspace and channel

Do not call a partial local cache a complete backup. Do not promise unimplemented
self-session, bot-token, live-tail, publish, subscribe, or MCP features.

## Privacy

Treat messages, channel names, people, workspace names, local paths, and session
data as private. Examples must use invented values. Never copy a real local
archive into a fixture, issue, screenshot, log excerpt, or external prompt.
