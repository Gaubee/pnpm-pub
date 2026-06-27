---
title: "src/daemon/dev.ts banner string broke on a raw backtick"
state: closed
github_issue_status: closed
label: "daemon"
---

## Summary
`src/daemon/dev.ts` embedded `pnpm-pub publish` inside a template literal without escaping the backticks, which terminated the string early and broke compilation.

## Impact
The dev runner could not typecheck, so the task loop was blocked before the updated runtime banner could even be exercised.

## Evidence
- `src/daemon/dev.ts:41-55` contained a template literal banner.
- `src/daemon/dev.ts:50` used raw backticks around `pnpm-pub publish`, which closes the template string in TypeScript.
- `pnpm typecheck` failed with `src/daemon/dev.ts(50,39): error TS1005: ',' expected.`

## Resolution
- Removed the raw backticks from the banner text so the template literal remains valid.

## Self-Review
- Task offset: this was a syntax repair only; no runtime contract changed.
- Task residue: none after `pnpm typecheck` and the focused workspace/CLI tests passed.
