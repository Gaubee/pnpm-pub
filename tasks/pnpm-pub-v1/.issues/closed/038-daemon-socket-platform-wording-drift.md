---
title: "daemon socket platform wording still implied macOS-only Unix sockets"
state: closed
github_issue_status: closed
label: "spec"
---

## Summary

`spec/05.md` and the shared path comment still described the Unix Domain Socket path as macOS-only, while the IPC law and implementation already apply the same Unix socket path to macOS and Linux.

## Impact

The daemon lifecycle chapter and source-level path note lagged behind the platform law. That left a reader with two different platform boundaries for the same IPC socket atom.

## Evidence

- `spec/05.md:16` previously said the daemon binds a Unix Domain Socket on `macOS`.
- `src/shared/paths.ts:45` previously annotated the run socket path as macOS-only.
- `spec/03.md:28` and `src/shared/paths.ts:50-59` define the Unix socket path for `macOS / Linux`.

## Resolution

- Updated `spec/05.md` to say `Unix Domain Socket (macOS / Linux)`.
- Updated the `runDir()` comment to describe the macOS/Linux Unix socket directory.

## Self-Review

- Task offset: this aligned documentation and source comments with the existing socket law; no runtime behavior changed.
- Task residue: none after stale wording search, focused IPC tests, and `git diff --check`.
