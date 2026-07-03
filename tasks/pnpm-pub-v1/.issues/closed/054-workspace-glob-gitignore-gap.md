---
title: "Workspace glob scan did not honor gitignored package directories"
state: closed
github_issue_status: closed
label: "workspace"
---

## Summary

The workspace scanner honored root `.gitignore` during recursive fallback scans, but the `pnpm-workspace.yaml` simple-glob fast path could still surface a package directory explicitly ignored by root `.gitignore`.

## Impact

Chapter 5.3.4 defines `.gitignore` exclusions as part of the scanner law, not as a fallback-only projection. Ignored generated package directories matched by `packages/*` could appear in the WebUI package list and become action sources for publish/OIDC flows.

## Evidence

- `spec/05.md:52-55` requires the high-speed scanner to skip directories contained in `.gitignore`.
- `src/daemon/web-server.ts:319-321` mounts WebUI scans with `respectGitignore: true`.
- `src/daemon/workspace.ts:262-267` now defines a prefix-aware ignored-path predicate.
- `src/daemon/workspace.ts:301-306` now applies that predicate before reading simple-glob package candidates.
- `src/daemon/workspace.ts:321-326` now applies the same predicate for scoped package candidates.
- `test/unit/workspace.test.ts:161-173` proves a `packages/generated` entry ignored by root `.gitignore` does not surface through the `packages/*` fast path.

## Resolution

- Kept the existing scanner law and `respectGitignore` switch; no compatibility branch was added.
- Applied `.gitignore` filtering to the `pnpm-workspace.yaml` fast path before package extraction.
- Added a focused regression for ignored package directories matched by workspace globs.

## Self-Review

- Task offset: this round is scoped to scanner exclusion semantics for simple workspace globs.
- Task residue: wildcard directory support was later added by `tasks/pnpm-pub-v1/.issues/closed/116-workspace-gitignore-wildcard-directories.md`, and plain name-entry depth support was later added by `tasks/pnpm-pub-v1/.issues/closed/172-workspace-gitignore-name-entry-depth.md`.
