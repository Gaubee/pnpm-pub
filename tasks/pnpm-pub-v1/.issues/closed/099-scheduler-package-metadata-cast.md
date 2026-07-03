---
title: "Scheduler package metadata used an unchecked JSON cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The publish scheduler parsed `package.json` and cast the result directly to the expected package metadata shape.

## Impact

Chapter 3.3 turns CLI publish intent into a pending event, and the event payload becomes the user-visible confirmation source. Package metadata is a source record only when the runtime JSON values prove their shape; invalid `name`, `version`, or `description` values should not become publish target facts.

## Evidence

- `src/daemon/scheduler.ts` now parses package metadata through `parsePackageMetadata`.
- Only string `name`, `version`, and `description` fields are accepted from `package.json`.
- Malformed or missing metadata continues to fall back to `(unknown)` and `0.0.0`.
- `test/unit/proactive-events.test.ts` intercepts a CLI publish from a package with malformed metadata and verifies the pending event uses neutral target facts.

## Resolution

- Replaced the unchecked `package.json` metadata cast with an explicit parser.
- Preserved existing publish interception fallback behavior for unreadable or malformed package files.

## Self-Review

- Task offset: this round strengthens source-record parsing for publish event projection; it does not change packer metadata parsing or WebSocket/IPC framing.
- Task residue: the broader package and registry decoding surfaces named by this cluster were later resolved by `tasks/pnpm-pub-v1/.issues/closed/100-packer-package-metadata-cast.md`, `tasks/pnpm-pub-v1/.issues/closed/101-npm-token-response-cast.md`, `tasks/pnpm-pub-v1/.issues/closed/102-workspace-package-metadata-cast.md`, `tasks/pnpm-pub-v1/.issues/closed/107-registry-body-text-projection.md`, `tasks/pnpm-pub-v1/.issues/closed/108-registry-body-reader-discards-text.md`, and `tasks/pnpm-pub-v1/.issues/closed/109-token-apply-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
