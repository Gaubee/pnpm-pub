---
title: "CLI handshake retry regression duplicated spawn mock with a never cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The CLI handshake retry regression re-mocked `child_process.spawn` inside the daemon-outdated scenario with `as never`, even though the test file already provides a suite-level no-op spawn mock.

## Impact

Chapter 7.2.1 depends on the CLI retrying after a `daemon-outdated` signal without actually forking a daemon in unit tests. Keeping two spawn mock sources blurred the test's source of action and added an unnecessary type escape around the retry evidence.

## Evidence

- `test/unit/cli-handshake.test.ts:24` still defines the suite-level `node:child_process` mock.
- `test/unit/cli-handshake.test.ts:186` still exercises the daemon-outdated retry scenario.
- `test/unit/cli-handshake.test.ts:205` still proves the retry contacted the daemon twice.
- `test/unit/cli-handshake.test.ts:207` still proves the package-version handshake was sent.
- `test/unit/cli-handshake.test.ts` no longer contains the scenario-local `vi.mocked(spawn).mockImplementation(... as never)` override.

## Resolution

- Removed the redundant per-scenario spawn mock.
- Kept the no-op spawn behavior centralized at the suite mock boundary.
- Verified the focused CLI handshake regression and project typecheck.

## Self-Review

- Task offset: this round improves CLI handshake test-source hygiene; it does not change CLI or daemon runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
