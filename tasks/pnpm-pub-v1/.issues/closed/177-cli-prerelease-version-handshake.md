---
title: CLI version handshake reduced prereleases to numeric core
state: closed
github_issue_status: closed
label: cli
resolution: fixed
---

## Summary

The daemon freshness check compared only `major.minor.patch`. Versions such as `0.1.0-beta.1` and `0.1.0` collapsed to the same core, so a release CLI could fail to retire a prerelease daemon.

## Impact

Chapter 7.2.1 makes the CLI package version the source of truth for waking a fresh daemon when the running daemon is older. Dropping prerelease ordering could keep stale prerelease platform laws alive behind a successful handshake projection.

## Evidence

- `src/daemon/ipc-server.ts:231` now compares parsed semver cores and prerelease identifiers.
- `src/daemon/ipc-server.ts:246` parses build metadata away while preserving prerelease identifiers.
- `src/daemon/ipc-server.ts:257` treats release versions as newer than prereleases with the same core.
- `src/daemon/ipc-server.ts:273` compares numeric and string prerelease identifiers without unchecked casts.
- `test/unit/ipc-server.test.ts:226` proves release `0.1.0` retires daemon `0.1.0-beta.1`.
- `test/unit/ipc-server.test.ts:252` proves `0.1.0-beta.2` retires `0.1.0-beta.1`.
- `test/unit/ipc-server.test.ts:278` proves prerelease `0.1.0-beta.2` does not retire release daemon `0.1.0`.

## Resolution

The IPC handshake now follows the release-truth order:

```text
CLI package version
    |
    v
major/minor/patch comparison
    |
    v
prerelease comparison when cores match
```

This keeps daemon replacement in the IPC boundary and avoids a separate compatibility channel.

## Self-Review

Task offset: this round only changed daemon-side version ordering for IPC freshness decisions. It did not change package-version discovery, CLI retry behavior, daemon process spawning, or publish flow.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
