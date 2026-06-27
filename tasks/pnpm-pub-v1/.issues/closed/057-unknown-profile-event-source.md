---
title: "Unknown profile selection could create orphan proactive Events"
state: closed
github_issue_status: closed
label: "bug"
---

## Summary
The WebSocket profile switch path could persist an arbitrary default profile string. A later GUI-created proactive action would then create a pending Event whose `profile` did not resolve to a configured identity.

## Impact
Chapter 6.1 defines Profile isolation as the WebUI's core state boundary, and Chapter 6.2 defines Events as executable action sources. Letting a projection-level profile string become Event ontology could produce a visible pending action that cannot execute with real credentials.

## Evidence
- `src/daemon/store.ts:85` now rejects unknown usernames before mutating `profiles.json` default state.
- `src/daemon/web-server.ts:262` now returns a toast instead of broadcasting a switch for a missing profile.
- `src/daemon/scheduler.ts:234` now refuses proactive Event creation for unknown profiles.
- `test/unit/store.test.ts` covers the default-profile rejection and persistence invariant.
- `test/unit/proactive-events.test.ts` covers the no-orphan-Event scheduler boundary.

## Resolution
- Moved the identity check into the store law so the default profile remains source-backed.
- Added a scheduler guard so executable Events cannot be mounted without a real profile atom.
- Kept the fix destructive and narrow: no compatibility aliases, no ghost profiles, no fallback identity.

## Self-Review
- Task offset: this round only fixes unknown-profile source conservation for WebUI profile switching and GUI proactive Event creation.
- Task residue: existing Events with already-orphaned profile names are not migrated; the in-memory event log is process-local under the current design.
