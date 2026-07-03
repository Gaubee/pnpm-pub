---
title: "Dev runner banner still implied a seeded profile and immediate publish flow"
state: closed
github_issue_status: closed
label: "dev"
---

## Summary

`src/daemon/dev.ts` had already stopped seeding mock identity, but its startup banner still told the user to run `pnpm-pub publish` as if a usable profile already existed.

## Impact

That was a small but real UX drift: the banner instruction no longer matched the actual runtime state after the mock profile removal, so the dev runner was still nudging users toward a flow that would fail until they added a profile.

## Evidence

- `src/daemon/dev.ts:44-51` now says to add a profile in the UI before publishing.
- `src/daemon/dev.ts:12` still describes the runner as local UX testing only, with no seeded credentials.

## Resolution

- Updated the dev runner banner to tell the user to add a profile in the UI first, then run `pnpm-pub publish` from a project.

## Self-Review

- Task offset: the fix stayed in user-facing dev guidance and did not alter daemon behavior.
- Task residue: none after `pnpm exec vitest run test/unit/main-entry.test.ts test/unit/workspace.test.ts`.
