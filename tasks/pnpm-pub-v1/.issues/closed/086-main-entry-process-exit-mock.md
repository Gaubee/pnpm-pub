---
title: "Main entrypoint regression mocked process exit with a never cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The release daemon entrypoint regression mocked `process.exit` with `((() => undefined) as never)` so the test could observe the null-handle single-instance path while also checking boot options.

## Impact
Chapter 7.2.1 makes the release entrypoint a boot source for the package-version handshake, and Chapter 5.1.1 requires the packaged daemon to boot the tray path by default. The test's core evidence is the `bootDaemon` call; a fake process termination path added a type escape unrelated to that atom.

## Evidence
- `test/unit/main-entry.test.ts:11` now returns a truthy mocked boot result, keeping the test on the live-daemon boot path.
- `test/unit/main-entry.test.ts:26` still proves the release entrypoint imports and boots.
- `test/unit/main-entry.test.ts:30` still asserts a single `bootDaemon` call.
- `test/unit/main-entry.test.ts:35` and `test/unit/main-entry.test.ts:36` still assert package version and non-headless tray defaults.
- `test/unit/main-entry.test.ts` no longer contains an `as never` process-exit mock.

## Resolution
- Removed the `process.exit` spy and `as never` mock from the release boot regression.
- Kept the test focused on the release entrypoint boot contract instead of the single-instance exit projection.
- Verified the focused main-entry regression and project typecheck.

## Self-Review
- Task offset: this round narrows entrypoint test evidence to the release boot atom; it does not change daemon runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
