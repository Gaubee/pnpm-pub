---
title: "Refresh-token confirmation required old credentials"
state: closed
github_issue_status: closed
label: "bug"
---

## Summary

`refresh-token` proactive Events were mounted correctly, but `PublishScheduler.confirm()` checked the existing credential pool before handling the refresh-token atom. If the token was already missing from memory/keychain, the Event resolved as `failed` with "Missing credentials" instead of becoming the renewal action source.

## Impact

Chapter 6.2 defines `Action Required` as a first-class credential-renewal state and lists force-refresh as a proactive action. Requiring old credentials before surfacing the refresh flow collapsed a renewal source into a generic failure projection.

## Evidence

- `spec/06.md:25` defines `Action Required` as a credential-renewal state, not a generic failure.
- `spec/06.md:33` lists forced local token refresh as a proactive Event action.
- `src/daemon/scheduler.ts:252` now handles `refresh-token` before reading the credential pool.
- `src/daemon/scheduler.ts:254` resolves the Event as `action-required`.
- `test/unit/proactive-events.test.ts:251` keeps the existing loaded-credential refresh regression.
- `test/unit/proactive-events.test.ts:273` proves a refresh-token Event without loaded credentials still resolves as `action-required`.

## Resolution

- Moved the `refresh-token` confirmation branch ahead of credential lookup.
- Kept publish, placeholder, and OIDC writes behind the existing credential wall.
- Added focused regression coverage for the missing-credentials refresh-token path.

## Self-Review

- Task offset: this round only fixes the refresh-token action-source semantics; it does not change publish/OIDC missing-credential handling.
- Task residue: resolved by `tasks/pnpm-pub-v1/.issues/closed/064-write-events-missing-credentials-failed.md`; write-capable Events without loaded credentials now resolve as `action-required` under the same status ontology.
