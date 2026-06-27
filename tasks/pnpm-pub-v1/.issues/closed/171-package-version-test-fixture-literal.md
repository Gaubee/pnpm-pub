---
title: Package version tests duplicated the current release literal
state: closed
github_issue_status: closed
label: test-coverage
resolution: fixed
---

## Summary

The runtime package-version law had already moved CLI and daemon handshakes onto `package.json`, but two focused tests still asserted the current release as the literal `0.1.0`. That left the test lane with its own release-truth copy.

## Impact

Chapter 7.2 makes the CLI version handshake the daemon self-replacement law. Tests should prove that the runtime reads release truth from the package manifest; they should not need to be edited merely because the package version changes.

## Evidence

- `test/helpers/package-version.ts:5` reads the root package manifest version through an unknown-safe decoder.
- `test/unit/cli-handshake.test.ts:207` now reads the expected handshake version from that helper.
- `test/unit/cli-handshake.test.ts:208` compares daemon-bound `cliVersion` frames with the manifest-backed expected value.
- `test/unit/main-entry.test.ts:36` now asserts the packaged daemon boot version against the manifest-backed expected value.
- `tasks/pnpm-pub-v1/.issues/closed/050-cli-daemon-version-hardcoded.md:28` now points to this closure instead of describing the test literal as current residue.

## Resolution

Added a test-only manifest reader:

```text
package.json
    |
    v
test manifest decoder
    |
    v
CLI / daemon version assertions
```

The tests now keep package manifest version as the single source of release truth while still exercising the CLI and daemon entrypoint surfaces.

## Self-Review

Task offset: this round changed test fixture truth only; it did not alter runtime version reading, IPC frame schema, or daemon self-replacement behavior.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
