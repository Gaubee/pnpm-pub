---
title: "Dev runner comment still described seeded mock credentials"
state: closed
github_issue_status: closed
label: "dev"
---

## Summary

`src/daemon/dev.ts` still described the runner as if it seeded a mock profile with throwaway credentials, even after the bootstrap had been removed.

## Impact

That was a source-level drift. The runtime behavior was already corrected, but the file header still taught the wrong mental model to future readers.

## Evidence

- `src/daemon/dev.ts:1-12` previously described a seeded mock profile and throwaway credentials.
- `src/daemon/dev.ts:14-47` now describes the runner as booting the daemon and asking the user to add a profile in the UI before publishing.

## Resolution

- Updated the dev runner file header to match the current no-seeded-profile behavior.

## Self-Review

- Task offset: the fix stayed in comments and did not alter runtime behavior.
- Task residue: none after `pnpm exec tsx tasks/pnpm-pub-v1/scripts/issues.ts tasks/pnpm-pub-v1 validate --include-closed`.
