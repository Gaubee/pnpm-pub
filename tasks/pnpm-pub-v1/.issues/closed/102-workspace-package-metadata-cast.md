---
title: "Workspace package metadata used unchecked JSON casts"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The workspace scanner parsed `package.json` and cast the result directly to `Record<string, unknown>`, then repeated the same shape assumption for object-style `repository` metadata.

## Impact

Chapter 5.3 and Chapter 6.3 treat the workspace scanner as the local package fact source for the Workspaces projection and dashboard-driven events. A scanned package fact should only exist when parsed metadata proves it is a top-level object, and repository projection should not rely on unchecked object shape.

## Evidence

- `src/daemon/workspace.ts` now parses package metadata as `unknown` and gates it with `isRecord` before reading package fields.
- `parseRepository` now uses the same record guard before reading `url`.
- `test/unit/workspace.test.ts` verifies non-object `package.json` metadata is ignored and does not become a scanned package fact.

## Resolution

- Replaced the unchecked workspace metadata casts with an explicit non-array object guard.
- Preserved existing package scanning, private-package filtering, and repository URL normalization behavior for valid metadata.

## Self-Review

- Task offset: this round strengthens the workspace metadata source boundary; it does not change workspace root discovery, package glob parsing, or WebUI workspace rendering.
- Task residue: the command-runner stream chunk cast was later resolved by `tasks/pnpm-pub-v1/.issues/closed/105-packer-output-chunk-cast.md`; the broader registry decoding surfaces were later resolved by `tasks/pnpm-pub-v1/.issues/closed/107-registry-body-text-projection.md`, `tasks/pnpm-pub-v1/.issues/closed/108-registry-body-reader-discards-text.md`, and `tasks/pnpm-pub-v1/.issues/closed/109-token-apply-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
