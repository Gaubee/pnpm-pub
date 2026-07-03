---
title: "Proactive-events mock packer used an unchecked metadata cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The proactive-events test mocked `packPackage` by parsing `package.json` and casting the result directly to `Record<string, unknown>`.

## Impact

Chapter 8.5 and Chapter 10.1 use these tests as evidence for dashboard-driven publish and OIDC event flows. The mock packer should follow the same source-record boundary as production: parsed package metadata only becomes a package fact after an object-shape guard.

## Evidence

- `test/unit/proactive-events.test.ts` now parses mock package metadata through `parseMockPackageMetadata`.
- The helper keeps parsed JSON as `unknown` until `isRecord` proves it is a non-array object.
- `pnpm exec vitest run test/unit/proactive-events.test.ts` verifies the proactive event scenarios still pass.

## Resolution

- Replaced the unchecked mock metadata cast with an explicit object guard.
- Preserved existing mock tarball behavior and publish-event assertions.

## Self-Review

- Task offset: this round strengthens test evidence for proactive event source facts; it does not change scheduler runtime behavior, packer production behavior, or publish execution semantics.
- Task residue: the broader registry decoding surfaces were later resolved by `tasks/pnpm-pub-v1/.issues/closed/107-registry-body-text-projection.md`, `tasks/pnpm-pub-v1/.issues/closed/108-registry-body-reader-discards-text.md`, and `tasks/pnpm-pub-v1/.issues/closed/109-token-apply-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
