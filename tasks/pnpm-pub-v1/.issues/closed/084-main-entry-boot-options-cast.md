---
title: "Main entrypoint regression cast boot options instead of using daemon contract"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The release daemon entrypoint regression asserted `bootDaemon` options by casting the captured mock call to an anonymous `{ cliVersion: string; withTray?: boolean }` shape.

## Impact
Chapter 7.2.1 makes the package version part of the release handshake law, and the packaged daemon entrypoint is the source that feeds that version into daemon boot. The test should prove the exported daemon contract directly instead of inventing a parallel projection of the boot options.

## Evidence
- `test/unit/main-entry.test.ts:8` now imports the exported `DaemonOptions` contract as a type-only import.
- `test/unit/main-entry.test.ts:11` now types the mocked `bootDaemon` parameter as `DaemonOptions`.
- `test/unit/main-entry.test.ts:33` now reads the first mock call without casting the captured options to an anonymous shape.
- `test/unit/main-entry.test.ts:26` now names the regression in Given/When/Then scenario form.

## Resolution
- Replaced the anonymous boot-option assertion cast with the exported daemon options contract.
- Preserved the release entrypoint behavior and its single-instance exit assertion.
- Verified the focused main-entry regression and project typecheck.

## Self-Review
- Task offset: this round improves type-safe test evidence for the release entrypoint atom; it does not change daemon runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
