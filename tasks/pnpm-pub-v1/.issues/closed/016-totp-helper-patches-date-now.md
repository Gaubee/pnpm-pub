---
title: "TOTP helper still patches Date.now at runtime"
state: closed
github_issue_status: closed
label: "crypto"
---

## Summary

`generateTotpAt` now uses `otplib`'s preset-backed epoch path instead of monkey-patching `Date.now`.

## Impact

The TOTP path no longer mutates a global runtime clock source. The drift-recovery law stays pure and source-backed instead of relying on a hidden side effect.

## Evidence

- `node_modules/otplib/README.md:258-267` documents the `epoch` option for TOTP generation.
- `src/daemon/totp.ts:18-33` now uses `totp.clone({ epoch })` for adjusted-epoch generation and `authenticator.generate` for the current epoch.
- `src/daemon/totp.ts:58-61` routes drift recovery through the offset-aware helper.
- `test/unit/totp.test.ts:64-72` now pins `Date.now` only inside the Vitest assertion, not in runtime code.

## Resolution

Replaced the runtime Date monkey-patch with a preset-backed epoch clone and kept the deterministic proof inside the unit test harness.

## Self-Review

- Task drift: the fix stayed inside the TOTP helper boundary and did not change publish or registry retry semantics.
- Task residue: no known residual after root typecheck and the focused TOTP/drift tests passed.
