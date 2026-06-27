---
title: OIDC setup could fall back to daemon cwd when package path was missing
state: closed
github_issue_status: closed
label: source-of-action
milestone: 176
resolution: fixed
---

## Summary

`setup-oidc` accepted a payload without `path`, then `runOidc()` wrote the generated workflow under `process.cwd()`. That daemon cwd fallback was not the user-selected package source from the Workspaces flow.

## Impact

Chapter 8.5 defines OIDC setup as a Workspaces-originated action: the user selects a package, confirms the Event, and the daemon writes `publish.yml` for that package. Falling back to daemon cwd could write into an unrelated directory while still presenting the Event as a package-scoped Trusted Publish setup.

## Evidence

- `spec/08.md:137` through `spec/08.md:150` defines OIDC setup as selecting a package in Workspaces, confirming the Event, then writing `publish.yml`.
- `src/shared/index.ts:168` through `src/shared/index.ts:177` now makes `OidcContext.path` required.
- `src/daemon/scheduler.ts:134` through `src/daemon/scheduler.ts:148` now rejects OIDC payloads missing `repo`, `name`, or `path`.
- `src/daemon/scheduler.ts:443` through `src/daemon/scheduler.ts:450` now writes only to `ctx.path`.
- `webui/src/lib/types.ts:36` through `webui/src/lib/types.ts:42` mirrors the required `path` contract.
- `webui/src/lib/ws-message.ts:95` through `webui/src/lib/ws-message.ts:102` rejects OIDC Event payload projections without a string `path`.
- `test/unit/proactive-events.test.ts:271` proves a repo/name-only OIDC payload creates no executable Event and performs no registry action.

## Resolution

OIDC setup now conserves workflow writes to an explicit package path:

```text
Workspaces package selection
    |
    v
setup-oidc payload with required path
    |
    v
workflow write under that package only
```

No daemon cwd fallback or compatibility branch remains.

## Self-Review

Task offset: this round only tightened the `setup-oidc` source-of-action boundary. It did not change OIDC registry API behavior, generated workflow contents, `--force` overwrite law, publish confirmation, placeholder publishing, or workspace scanning.

Task residue: Dockerized Verdaccio verification remains blocked until Docker daemon access is available.
