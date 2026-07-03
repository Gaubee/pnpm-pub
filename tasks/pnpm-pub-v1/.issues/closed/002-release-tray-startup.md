---
title: "Release entrypoint forced headless daemon mode"
state: closed
github_issue_status: closed
resolution: "Fixed in src/daemon/main.ts by removing the hard-coded withTray=false flag."
---

## Summary

The packaged daemon entrypoint explicitly disabled the tray host.

## Impact

Production launches would come up headless, bypassing the physical confirmation surface the spec depends on.

## Evidence

- `src/daemon/main.ts:8-23` now boots with the default tray behavior.
- `test/unit/main-entry.test.ts:25-35` asserts the entrypoint does not force `withTray=false`.

## Resolution

Dropped the explicit headless flag so release boot follows the tray path by default.
