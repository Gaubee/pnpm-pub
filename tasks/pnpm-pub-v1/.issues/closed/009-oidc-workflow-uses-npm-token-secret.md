---
title: "Trusted Publish workflow still injects an NPM token secret"
state: closed
github_issue_status: closed
label: "oidc"
resolution: "Fixed by removing token-secret environment from the generated Trusted Publish workflow and guarding it in tests."
---

## Summary
The generated Trusted Publish workflow claims to use OIDC without a long-lived NPM token, but still sets `NODE_AUTH_TOKEN` from `secrets.NPM_TOKEN`.

## Impact
This blurs the spec's OIDC source-of-action boundary: the workflow appears to be Trusted Publishing, while the emitted execution path still depends on a reusable token secret.

## Evidence
- `spec/01.md:39-40` requires automatic/assisted Trusted Publish (OIDC) setup.
- `src/daemon/oidc-template.ts:23-41` grants `id-token: write` and comments that no long-lived NPM token is required.
- `src/daemon/oidc-template.ts:39-41` still injects `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` into the publish step.
- `test/unit/proactive-events.test.ts:73-75` only asserts the generated file contains `npm publish --provenance`, so the token-secret drift is currently unguarded.
- `src/daemon/oidc-template.ts:23-40` now emits the OIDC permission and provenance publish command without `NODE_AUTH_TOKEN`.
- `test/unit/proactive-events.test.ts:73-77` now asserts the generated workflow includes `id-token: write` and `npm publish --provenance`, while excluding `NODE_AUTH_TOKEN` and `NPM_TOKEN`.
- `rg -n "NODE_AUTH_TOKEN|secrets\\.NPM_TOKEN|NPM_TOKEN" src/daemon/oidc-template.ts test/unit/proactive-events.test.ts` only returns the negative assertions.

## Resolution
Removed the long-lived token environment from the generated Trusted Publish workflow and strengthened the proactive OIDC regression to protect the source-of-action boundary.

## Self-Review
- Task drift: the change stayed in the workflow-generation atom; it did not alter npm credential storage or daemon publish credentials.
- Task residue: no known residual for issue 009 after typecheck, focused OIDC regression, and token-secret grep guard passed.
