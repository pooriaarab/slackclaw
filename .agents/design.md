# slackclaw design system

This document defines the current terminal interface. Source output in
`src/cli/` remains the implementation source of truth.

## Overview

slackclaw is a plain-text CLI. Design for predictable scripts and readable
interactive use. Keep output stable, compact, and free of hidden formatting.

The interface uses human-readable lines. `doctor --json` provides explicit JSON
for automation. Never mix prose, progress, or warnings into JSON stdout.

## Colors

The current CLI emits no ANSI colors. Preserve that behavior. Terminal themes
own foreground, background, selection, and contrast.

Do not use color as status or hierarchy. README badge colors come from their
providers and are not a slackclaw palette. If color is added later, it requires
an explicit interface decision and non-color equivalents.

## Typography

The user's terminal controls font family, size, weight, and line height. Emit
plain Unicode text that remains legible in a standard monospace terminal.

Keep commands, option names, field labels, and empty states lowercase. Use ISO
timestamps without local decoration. Use JSON field names exactly as the
program defines them.

Do not use bold escape codes, decorative capitals, smart alignment spaces, or
typographic punctuation that changes parsing.

## Layout

Write one search result or message per line. Keep its identity before its body:

- Search: `[timestamp] (source) message`.
- Messages: `[timestamp] message`.
- Doctor: `label: value`.
- Empty state: a short lowercase phrase.

Keep stdout for requested data. Send failures to stderr and exit nonzero. Avoid
tables whose alignment depends on terminal width. Do not truncate message text
without an explicit option.

For JSON mode, emit one valid JSON value. Do not add headings, status lines, or
ANSI escapes around it.

## Elevation & Depth

Terminal output has no visual elevation. Express hierarchy through order,
labels, and minimal indentation.

Keep primary records at column zero. Use two spaces only when a future nested
record needs a visible parent. Avoid box drawing, pseudo-panels, nested borders,
and repeated separators.

## Shapes

Use stable ASCII punctuation as structure:

- Square brackets enclose timestamps.
- Parentheses enclose a source.
- A colon separates a diagnostic label from its value.
- Hyphens prefix documented option names.

Do not add decorative emoji to program labels or status output. Preserve emoji
when it is part of a user's stored message. The README speech bubble is
documentation decoration and does not define terminal output.

## Components

Commands are the primary components. Each command needs a clear verb, a short
description, stable options, and one output contract.

Result rows represent messages. Doctor checks represent local readiness. Empty
states confirm a successful query with no result. Errors explain a failed
operation and return a nonzero status. Doctor JSON supports automation.

Use Commander for command and option structure. Keep storage and cache details
behind command boundaries instead of leaking internal objects into output.

## Do's and Don'ts

**Do**

- Keep the name lowercase in commands and output.
- Put ISO timestamps first in message rows.
- Keep empty states short, lowercase, and unpunctuated.
- Preserve one-record-per-line output for search and messages.
- Use invented messages, channels, people, and paths in examples.
- Keep JSON stdout valid and free of commentary.

**Don't**

- Do not emit ANSI formatting by default.
- Do not add decorative emoji or box drawing to program output.
- Do not expose private local paths unless a diagnostic requests them.
- Do not claim a local cache contains full workspace history.
- Do not document planned commands as implemented.
- Do not add website routes without a proven product domain.
