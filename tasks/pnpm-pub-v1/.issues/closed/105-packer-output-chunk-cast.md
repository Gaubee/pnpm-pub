---
title: "Packer command output used unchecked Buffer casts"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The packer command runner cast child-process stdout and stderr `data` chunks directly to `Buffer`.

## Impact
Chapter 1.3.1 and Chapter 7.1.2 depend on the packer to preserve `pnpm pack` / `npm pack` behavior while collecting command output for errors. Subprocess output is a runtime boundary; only known byte or string chunk shapes should become captured output facts.

## Evidence
- `src/daemon/packer.ts` now routes stdout and stderr chunks through `normalizeOutputChunk`.
- The normalizer accepts `Buffer`, `string`, and `Uint8Array` and drops unsupported shapes.
- `test/unit/packer.test.ts` verifies accepted and rejected chunk shapes without relying on unchecked casts.

## Resolution
- Replaced the unchecked stdout/stderr `Buffer` casts with explicit output normalization.
- Preserved existing pack command selection and error-output formatting.

## Self-Review
- Task offset: this round strengthens the packer subprocess boundary; it does not change package metadata parsing, tarball discovery, or publish document construction.
- Task residue: the test-only proactive-event package metadata cast was later resolved by `tasks/pnpm-pub-v1/.issues/closed/106-proactive-events-mock-metadata-cast.md`; the broader registry decoding surfaces were later resolved by `tasks/pnpm-pub-v1/.issues/closed/107-registry-body-text-projection.md`, `tasks/pnpm-pub-v1/.issues/closed/108-registry-body-reader-discards-text.md`, and `tasks/pnpm-pub-v1/.issues/closed/109-token-apply-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
