---
title: "Dev runner injected a mock profile and credentials on startup"
state: closed
github_issue_status: closed
label: "dev"
---

## Summary

`src/daemon/dev.ts` was seeding a `dev-author` profile and throwaway credentials automatically when the dev runner started.

## Impact

That created synthetic runtime identity at startup. The dev runner should only bootstrap the daemon and let the user create or select real profile data through the UI, not pre-populate the store with a fake account.

## Evidence

- `src/daemon/dev.ts:31-49` previously wrote a mock `dev-author` profile, registry, token, and TOTP secret into the live store.
- `src/daemon/dev.ts:54-63` previously advertised that fake profile in the startup banner.

## Resolution

- Removed the automatic mock profile and credential bootstrap from the dev runner.
- Updated the banner to tell the user to add a profile in the UI instead of implying a seeded identity exists.

## Self-Review

- Task offset: the change stayed in the dev-only runner and did not alter release daemon behavior.
- Task residue: none after `pnpm exec vitest run test/unit/proactive-events.test.ts test/unit/workspace.test.ts`.
