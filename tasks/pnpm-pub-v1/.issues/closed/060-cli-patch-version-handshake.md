---
title: "Daemon version handshake ignored newer CLI patch versions"
state: closed
github_issue_status: closed
label: "bug"
---

## Summary
The IPC version handshake only compared major and minor version parts. A CLI at `0.1.1` talking to a daemon at `0.1.0` would not trigger the `daemon-outdated` self-destruct signal required by the spec.

## Impact
Chapter 7.2.1 defines the CLI version as release truth for waking a fresh daemon when the running daemon is older. Ignoring patch versions could leave users connected to stale daemon code after a patch release, preserving old platform laws behind a successful handshake projection.

## Evidence
- `src/daemon/ipc-server.ts:125` now routes version decisions through `isNewerVersion()`.
- `src/daemon/ipc-server.ts:206` now compares major, minor, and patch version parts.
- `test/unit/ipc-server.test.ts:136` proves `0.1.1` against daemon `0.1.0` emits `daemon-outdated` and invokes `onStop`.
- `test/unit/ipc-server.test.ts:162` proves an older CLI stays silent and does not stop the daemon.

## Resolution
- Replaced the two-part major/minor comparison with a three-part numeric version comparison.
- Kept the decision inside the IPC handshake boundary.
- Avoided compatibility branches or duplicate version channels.

## Self-Review
- Task offset: this round only fixes daemon-side semantic version comparison for the CLI handshake.
- Task residue: prerelease ordering was later tightened by `tasks/pnpm-pub-v1/.issues/closed/177-cli-prerelease-version-handshake.md`; release package versions remain the active source of truth for production handshakes.
