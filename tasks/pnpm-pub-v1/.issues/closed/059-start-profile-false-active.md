---
title: "start --profile could report active after rejecting the requested identity"
state: closed
github_issue_status: closed
label: "bug"
---

## Summary

The IPC `start --profile=<name>` path delegated profile application to `onStart`, but always returned an active status frame even when the requested profile did not exist and no default identity changed.

## Impact

Chapter 5.4.5 requires explicit profile overrides to bind execution identity strictly, and Chapter 7.1 exposes `start --profile` as a management command. Reporting active success for an unknown profile created a false projection: the CLI saw a successful start while the requested identity was not a real source-backed profile.

## Evidence

- `src/daemon/ipc-server.ts:166` now treats `onStart` as a boolean profile-application result.
- `src/daemon/ipc-server.ts:170` now emits an `exit` frame with code `1` when the profile does not exist.
- `src/daemon/index.ts:88` now returns whether the daemon actually applied the requested start profile.
- `test/unit/ipc-server.test.ts:96` covers the unknown-profile rejection and verifies no active status is emitted.

## Resolution

- Made the IPC start-profile authority boundary explicit with a boolean result.
- Preserved valid `start --profile=work` behavior while rejecting unknown profile atoms loudly.
- Avoided compatibility fallback to the existing default identity.

## Self-Review

- Task offset: this round only closes the IPC management false-active profile projection.
- Task residue: CLI user-facing text still depends on the generic IPC exit-frame rendering path; this round fixed the daemon-side authority signal.
