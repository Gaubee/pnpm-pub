---
title: "CLI handshake regression asserted stringified IPC frames"
state: closed
github_issue_status: closed
label: "test-contract"
---

## Summary
The CLI handshake regression decoded IPC frames through `FrameReader`, then immediately stringified each frame and asserted protocol intent with substring checks such as `"command":"publish"`.

## Impact
Chapter 7.2.1 defines the CLI/daemon pipe as the release handshake and command-intent channel. String matching turned typed protocol frames into text projections, weakening the evidence for profile overrides, publish passthrough, status, and package-version handshakes.

## Evidence
- `test/unit/cli-handshake.test.ts:15` now imports the shared `IpcRequest` protocol type.
- `test/unit/cli-handshake.test.ts:38` now records decoded frames as `IpcRequest[]`.
- `test/unit/cli-handshake.test.ts:41` now uses a local type guard to keep only request frames from the socket stream.
- `test/unit/cli-handshake.test.ts:74` now dispatches daemon responses from typed `frame.command` values.
- `test/unit/cli-handshake.test.ts:159`, `test/unit/cli-handshake.test.ts:180`, and `test/unit/cli-handshake.test.ts:211` now assert protocol fields directly instead of substring projections.

## Resolution
- Replaced stringified captured IPC frames with typed `IpcRequest` capture.
- Added small request and publish-request guards for the test server.
- Renamed the touched regressions with Given/When/Then scenario statements.
- Verified the focused CLI handshake regression and project typecheck.

## Self-Review
- Task offset: this round improves CLI protocol test evidence; it does not change CLI or daemon runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
