---
title: "CLI handshake spawn mock carried unused unknown arguments"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The CLI handshake regression's suite-level `child_process.spawn` mock declared `..._args: unknown[]` even though the test never inspected spawn arguments.

## Impact

Chapter 7.2.1 only needs a no-op spawn boundary so the retry loop can be observed through IPC frames. Keeping unused `unknown[]` input in the mock added a type-safety escape that was not tied to a third-party boundary or runtime evidence.

## Evidence

- `test/unit/cli-handshake.test.ts` keeps the suite-level `node:child_process` mock as the only spawn source for the retry tests.
- `test/unit/cli-handshake.test.ts` no longer declares `..._args: unknown[]` in that mock.
- The daemon-outdated scenario still proves the CLI reconnects and sends the package-version handshake.

## Resolution

- Removed the unused variadic argument from the suite-level spawn mock.
- Preserved the no-op mocked process shape used by the CLI retry path.

## Self-Review

- Task offset: this round is test-source hygiene for the Chapter 7.2.1 handshake evidence; it does not change CLI or daemon runtime behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
