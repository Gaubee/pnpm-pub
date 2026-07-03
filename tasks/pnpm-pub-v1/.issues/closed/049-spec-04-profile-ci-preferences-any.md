---
title: "Spec 04 profile ciPreferences used any in the public config model"
state: closed
github_issue_status: closed
label: "spec"
---

## Summary

Chapter 4's `PnpmPubConfig` schema documented `ciPreferences?: Record<string, any>`, while the daemon/shared and WebUI protocol mirrors already model the same extension field as `Record<string, unknown>`.

## Impact

The spec is the kernel law for this task. Leaving `any` in the public `profiles.json` ontology weakened the type-safety law at the source, even though runtime code had already moved to an explicit unknown boundary.

## Evidence

- `spec/04.md:29` now documents `ciPreferences?: Record<string, unknown>`.
- `src/shared/index.ts:23-24` already uses `Record<string, unknown>` for `Profile.ciPreferences`.
- `webui/src/lib/types.ts:8-12` mirrors the WebUI `Profile` type with `Record<string, unknown>`.
- `rg -n "Record<string, any>|\\bany\\b|as any|ts-nocheck" src webui/src test spec -S` no longer finds type-level `any` in the spec or runtime source.

## Resolution

- Replaced the remaining spec-level `Record<string, any>` with `Record<string, unknown>`.
- Kept `ciPreferences` as extension data, but made consumers explicitly narrow it before use.

## Self-Review

- Task offset: this round corrected a spec/runtime contract drift and did not add behavior.
- Task residue: comment text still contains plain English uses of the word "any"; no remaining type-level `any` was found in source or spec.
