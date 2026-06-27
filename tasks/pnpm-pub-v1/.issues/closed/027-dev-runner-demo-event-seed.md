---
title: "Dev runner injected a fake demo pending event"
state: closed
github_issue_status: closed
label: "dev"
---

## Summary
`src/daemon/dev.ts` seeded the dev server with a hardcoded demo `publish` event on startup so the Events hub would always show something on load.

## Impact
That was a runtime fake source of truth. The dev runner should bootstrap a mock profile and leave the event timeline to real user actions or explicit tests, not invent a publish event with synthetic package identity.

## Evidence
- `src/daemon/dev.ts:68-87` injected a hardcoded `@dev-author/demo-pkg` pending event on startup.
- `src/daemon/dev.ts:1-49` already seeds a mock profile and credentials for UX testing, so the extra event was not required to exercise the runner.

## Resolution
- Removed the demo pending event injection from the dev runner.
- Kept the mock dev profile bootstrap intact so `pnpm dev` still starts with a usable identity for manual testing.

## Self-Review
- Task offset: the fix stayed inside the dev-only UX runner and did not affect release daemon behavior.
- Task residue: none after `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/workspace.test.ts`.
