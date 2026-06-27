---
title: "Daemon index exported stale addProfile onboarding path"
state: closed
github_issue_status: closed
label: "architecture"
---

## Summary
`src/daemon/index.ts` exposed an `addProfile()` helper that duplicated the onboarding flow outside the active WebServer/store boundary. It wrote credentials to the keychain after `applyToken()`, but it did not update `profiles.json`, populate the in-memory credential pool, roll back keychain writes on persistence failure, or support the manual-token fallback accepted by `/api/add-profile`.

## Impact
The helper presented a false platform atom for Chapter 8 onboarding. If reused, it could create orphan keychain credentials with no profile source record, violating the onboarding sequence that stores credentials and then updates `~/.pnpm-pub/profiles.json`.

## Evidence
- `src/daemon/index.ts` no longer exports the stale `addProfile()` helper.
- `src/shared/index.ts` no longer exports the now-unused `AddProfilePayload` and `AddProfileResult` protocol types.
- `src/daemon/web-server.ts:365-405` remains the active onboarding boundary: it handles automated token application or manual token fallback, writes keychain credentials first, updates the profile store, rolls keychain state back on failure, and then populates the in-memory credential pool.
- `spec/08.md:30-34` requires keychain persistence followed by `~/.pnpm-pub/profiles.json` update.

## Resolution
- Removed the stale daemon-index onboarding export instead of preserving a compatibility branch.
- Removed the obsolete shared onboarding payload/result types that only supported that stale export.
- Kept onboarding effects conserved to the authenticated WebServer action source and the durable store boundary.

## Self-Review
- Task offset: this is an exported-surface cleanup, not a user-facing onboarding redesign. The active `/api/add-profile` path remains unchanged.
- Task residue: no library export is declared in `package.json`; if this package later grows a public API, onboarding should be exposed through a store-backed service contract rather than resurrecting daemon lifecycle exports.
