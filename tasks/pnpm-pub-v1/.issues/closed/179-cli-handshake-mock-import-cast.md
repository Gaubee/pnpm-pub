---
title: CLI handshake mock promoted importOriginal with a module cast
state: closed
github_issue_status: closed
label: type-safety
milestone: 175
resolution: fixed
---

## Summary

The CLI handshake regression used `(await importOriginal()) as typeof import('node:child_process')` inside the `node:child_process` Vitest mock. That made the mock-framework projection look like a proven module source.

## Impact

Chapter 7.2.1 makes the CLI package-version handshake the daemon replacement law. The regression should protect that IPC law without reintroducing unchecked module promotion in the test boundary. Keeping the cast after runtime sources were cleaned would leave the task ledger with one remaining type-safety residue.

## Evidence

- `spec/07.md:24` through `spec/07.md:27` defines the CLI socket connection, auto-boot, and package-version handshake behavior.
- `test/unit/cli-handshake.test.ts:25` now mocks `node:child_process` without receiving `importOriginal`.
- `test/unit/cli-handshake.test.ts:26` now uses `vi.importActual<typeof import('node:child_process')>('node:child_process')`.
- `pnpm exec vitest run test/unit/cli-handshake.test.ts` passes.
- `pnpm typecheck` passes.
- `rg -n "as any|as unknown|@ts-nocheck|Record<string, any>|JSON\\.parse\\([^\\n]+\\) as| as typeof import|require\\(.*\\) as" src webui/src test -S` returns no matches.

## Resolution

The mock now imports the real module through Vitest's typed actual-module API:

```text
Vitest mock boundary
    |
    v
typed vi.importActual
    |
    v
spawn-only override
```

The IPC test behavior remains unchanged; only the mock source boundary was tightened.

## Self-Review

Task offset: this round only changed test scaffolding around the CLI version-handshake regression. It did not change CLI runtime code, daemon self-replacement behavior, publish argument parsing, daemon spawn behavior, or production module loading.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
