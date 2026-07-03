---
title: "spec/03.md still required a Rust N-API credential proxy"
state: closed
github_issue_status: closed
label: "spec"
---

## Summary

`spec/03.md` still described credential storage as a Rust N-API proxy law, while the active architecture and implementation use `@github/keytar` as the native credential boundary.

## Impact

The security chapter contradicted the current platform law. That made the credential ontology split between a stale Rust proxy requirement and the actual Keytar-native adapter.

## Evidence

- `spec/03.md:11` previously said credential reads and writes must go through a compiled Rust extension.
- `spec/02.md:60` defines `@github/keytar` as the chosen secure storage layer, replacing the earlier Rust `napi-rs` plan.
- `src/daemon/keychain.ts:1-109` implements the Keytar adapter and dynamic runtime loading path.

## Resolution

- Updated `spec/03.md` to name `@github/keytar` as the native credential proxy.

## Self-Review

- Task offset: this was a spec-law correction only; no runtime behavior changed.
- Task residue: none after task issue validation, `git diff --check`, and a targeted search for stale Rust N-API law wording.
