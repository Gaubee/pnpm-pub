---
title: "Packer package metadata used an unchecked JSON cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary
The tarball packer parsed `package.json` and cast the result directly to `Record<string, unknown>`.

## Impact
Chapter 1.3.1 and Chapter 7.1.2 depend on the packer to create the actual publishable artifact and pass package metadata into the npm publish document. That metadata is a source record only if the parsed JSON is a top-level object; arrays or primitives must not flow into publish construction as if they were package metadata.

## Evidence
- `src/daemon/packer.ts` now parses package metadata through `parsePackageMetadata`.
- `isJsonObject` proves the parsed `package.json` is a non-array object before it becomes `Record<string, unknown>`.
- `test/unit/packer.test.ts` verifies non-object `package.json` metadata is rejected before pack command discovery or shell execution.

## Resolution
- Replaced the unchecked packer metadata cast with an explicit object guard.
- Preserved existing behavior for valid package metadata objects.

## Self-Review
- Task offset: this round strengthens the actual pack/publish metadata source boundary; it does not change scheduler preview metadata, npm publish document assembly, or WebSocket/IPC framing.
- Task residue: the broader registry decoding surfaces named here were later resolved by `tasks/pnpm-pub-v1/.issues/closed/101-npm-token-response-cast.md`, `tasks/pnpm-pub-v1/.issues/closed/107-registry-body-text-projection.md`, `tasks/pnpm-pub-v1/.issues/closed/108-registry-body-reader-discards-text.md`, and `tasks/pnpm-pub-v1/.issues/closed/109-token-apply-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
