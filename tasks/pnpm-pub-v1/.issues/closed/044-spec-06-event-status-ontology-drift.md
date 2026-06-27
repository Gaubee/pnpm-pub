---
title: "spec/06 described the Events status ontology as only pending/success/failed"
state: closed
github_issue_status: closed
label: "spec"
---

## Summary
`spec/06.md` still described the Events timeline as having only three statuses: Pending, Success, and Failed. The shared protocol and WebUI already expose a richer status ontology with `expired`, `action-required`, and `rejected` as first-class states.

## Impact
Event status is protocol ontology, not a UI-only projection. Leaving Chapter 6 at the old three-state model made credential-renewal sources look like decorations on failed events, which contradicted the implemented pending-wall and renewal flow.

## Evidence
- `spec/06.md:25` now names the full status ontology: Pending, Success, Failed, Rejected, Expired, and Action Required.
- `src/shared/index.ts:146` defines `EventStatus` as `pending | success | failed | expired | action-required | rejected`.
- `src/daemon/scheduler.ts:327-333` resolves expired publish credentials as `expired`.
- `src/daemon/scheduler.ts:268-272` resolves refresh-token confirmation as `action-required`.
- `webui/src/lib/components/event-card.svelte:36-49` renders both statuses as dedicated warning/action projections.

## Resolution
- Updated Chapter 6 so the spec-level Events status law matches the shared protocol type.
- Explicitly described `Expired` and `Action Required` as credential-renewal sources instead of generic failure projections.

## Self-Review
- Task offset: this is a spec-law alignment round; runtime behavior was already implemented and tested by previous milestones.
- Task residue: none after status ontology search, task validator, and whitespace check.
