# Contributing to slackclaw

Thanks for your interest. This project is early, so the goal is small, testable, reviewable changes.

## Before You Start

- For anything beyond a small fix, open an issue first to discuss the approach.
- Design docs and implementation plans for past work live under `docs/superpowers/`, if you want context on how a feature came together.
- Keep real Slack workspace data, tokens, and cookies out of git, screenshots, fixtures, and examples. slackclaw reads your own local Slack Desktop cache, so treat any fixture data as sensitive by default and sanitize it before committing.

## Local Setup

Requirements: Node 22+.

```bash
npm install
npm test              # vitest
npx tsc --noEmit       # type-check
npx tsx src/cli/index.ts --help
```

## Pull Requests

- One focused change per PR.
- Add or update tests for behavior changes.
- Run `npm test` and `npx tsc --noEmit` before opening the PR. CI runs both, but it's faster to catch locally.
- Only the repo owner merges PRs. `.github/CODEOWNERS` requests owner review on everything, and only the owner has write access to this repo, so anyone can open a PR but only the owner can merge one.

## Reporting Issues

Use GitHub Issues. Include your OS, Node version, and (for cache-source bugs) which Slack Desktop version you're on. Never attach real cache files or exported message content.
