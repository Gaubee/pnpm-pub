---
title: "TOTP drift helper ignores the supplied offset"
state: closed
github_issue_status: closed
label: "crypto"
---

## Summary

`generateTotp(secret, offsetMs)` now honors the supplied offset, so the clock-drift helper really computes the OTP for the adjusted epoch.

## Impact

The registry retry path can now reliably recompute the OTP that matches the server's clock. The drift-recovery law is source-backed again instead of a no-op projection, which keeps publish/renew retries aligned with the server time step.

## Evidence

- `spec/08.md` defines clock-drift auto-recovery as recomputing the OTP from the registry server time.
- `src/daemon/totp.ts:19-21` now routes non-zero offsets through `generateTotpAt(secret, Date.now() + offsetMs)`.
- `src/daemon/totp.ts:66-68` now reuses the offset-aware helper instead of duplicating the local-clock path.
- `src/daemon/npm-api.ts:254-267` depends on this helper when a 403 OTP failure includes a server `Date` header.
- `test/unit/totp.test.ts:66-77` verifies the offset-aware helper matches the code generated at the adjusted epoch.

## Resolution

Made the offset path real and added a regression test proving the helper emits the same token as the server-time epoch it is meant to model.

## Self-Review

- Task drift: the fix stayed inside the TOTP boundary and did not alter publish flow semantics or registry retry wiring.
- Task residue: no known residual after root typecheck and the focused TOTP test passed.
