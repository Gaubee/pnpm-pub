---
title: "CLI positional command parsing used an unchecked yargs cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The CLI entrypoint cast `parsed._` from yargs directly to `string[]` before deciding whether the invocation was an explicit daemon command or a publish fallback.

## Impact

Chapter 7.1 treats CLI argv as a source of action. Explicit commands should be recognized through a small boundary parser, while publish fallback must continue to preserve raw package arguments instead of trusting yargs shape assumptions.

## Evidence

- `src/cli/cli.ts` now routes `parsed._` through `toPositionalStrings`.
- The helper treats the yargs positional field as `unknown` until it is proven array-shaped.
- `test/unit/cli-handshake.test.ts`, `test/unit/cli-start.test.ts`, and `test/unit/cli-stop.test.ts` verify command recognition, profile override handling, and publish fallback still work.

## Resolution

- Replaced the unchecked yargs positional cast with a local parser helper.
- Preserved raw argv extraction for publish passthrough and `--profile` handling.

## Self-Review

- Task offset: this round strengthens the CLI source-of-action boundary; it does not change daemon IPC frames, profile persistence, or publish execution semantics.
- Task residue: the command-runner stream chunk cast and test-only metadata/header casts were later resolved by `tasks/pnpm-pub-v1/.issues/closed/104-drift-header-cast.md`, `tasks/pnpm-pub-v1/.issues/closed/105-packer-output-chunk-cast.md`, and `tasks/pnpm-pub-v1/.issues/closed/106-proactive-events-mock-metadata-cast.md`; the broader registry decoding surfaces were later resolved by `tasks/pnpm-pub-v1/.issues/closed/107-registry-body-text-projection.md`, `tasks/pnpm-pub-v1/.issues/closed/108-registry-body-reader-discards-text.md`, and `tasks/pnpm-pub-v1/.issues/closed/109-token-apply-error-cast.md`. Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
