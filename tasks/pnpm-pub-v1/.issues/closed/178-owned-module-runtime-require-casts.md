---
title: Owned startup modules used unchecked runtime require casts
state: closed
github_issue_status: closed
label: type-safety
milestone: 174
resolution: fixed
---

## Summary

The CLI daemon spawn path and daemon tray icon path loaded owned project modules through `require(...) as typeof import(...)`. These modules are not the Chapter 9 native-addon boundary, so the casts made internal platform atoms look like unchecked runtime inputs.

## Impact

Chapter 5.1 allows the CLI to redirect detached daemon output into `~/.pnpm-pub/logs/daemon.log`, and Chapter 1.3 defines the tray icon as an NPM logo plus user avatar projection. Both paths are owned source modules with normal ESM contracts. Keeping unchecked casts there weakens the repo's type-safety law and blurs the distinction between internal atoms and true external runtime module surfaces such as Keytar.

## Evidence

- `spec/05.md:13` defines daemon stdio as ignored or redirected to `~/.pnpm-pub/logs/daemon.log`.
- `spec/01.md:35` through `spec/01.md:38` defines the tray GUI and avatar-backed icon projection.
- `spec/09.md:27` through `spec/09.md:45` keeps dynamic require scoped to the Keytar native-addon loading boundary.
- `src/cli/cli.ts:25` now statically imports `daemonLogPath`, `ensureAppDirs`, and `socketPath` from the shared paths atom.
- `src/cli/cli.ts:66` through `src/cli/cli.ts:70` redirects daemon logs without a runtime module assertion.
- `src/daemon/index.ts:22` now statically imports `trayIconForProfile` from the avatar atom.
- `src/daemon/index.ts:503` through `src/daemon/index.ts:505` resolves cached avatar tray icons without a runtime module assertion.

## Resolution

Owned modules now flow through normal ESM imports:

```text
CLI / daemon startup
    |
    v
static project imports
    |
    v
typed path + avatar atoms
```

The explicit dynamic boundary remains only where the spec requires runtime native-addon loading.

## Self-Review

Task offset: this round only removed unchecked casts around owned startup modules. It did not change daemon lifecycle behavior, tray icon selection semantics, avatar cache behavior, Keytar dynamic loading, packaging layout, or CLI publish/start command framing.

Task residue: the remaining `as typeof import` occurrence is in the Vitest mock import boundary at `test/unit/cli-handshake.test.ts`; Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
