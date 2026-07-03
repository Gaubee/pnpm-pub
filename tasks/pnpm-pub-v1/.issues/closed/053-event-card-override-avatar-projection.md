---
title: "Event card context override did not render profile avatar"
state: closed
github_issue_status: closed
label: "ui-projection"
---

## Summary

The Events card context-override identity pill rendered the effective profile username and initials, but did not use the existing profile `avatarUrl` even when the profile snapshot already carried it.

## Impact

Chapter 6.2.2 requires a pending card created by `--profile` to highlight the forced identity as Avatar + Username. Showing only initials weakened the identity projection and made the card less visually distinct from the sidebar-selected profile.

## Evidence

- `spec/06.md:26-30` requires a forced identity marker with Avatar + Username when a CLI event uses `--profile`.
- `webui/src/lib/types.ts:8-12` already mirrors `Profile.avatarUrl` from the daemon protocol.
- `webui/src/lib/components/app-sidebar.svelte:107-114` already uses `avatarUrl` for the active profile switcher.
- `webui/src/lib/components/event-card.svelte:51-55` now derives the effective profile record from the daemon profile snapshot.
- `webui/src/lib/components/event-card.svelte:108-116` now renders `AvatarImage` for the effective identity before falling back to initials.

## Resolution

- Kept Event payloads unchanged; the Event remains the action ontology and does not duplicate profile projection data.
- Reused the existing daemon profile snapshot as the source for avatar projection.
- Preserved initials as the fallback when no avatar URL exists.

## Self-Review

- Task offset: this round fixes only the context-override identity projection in the Event card.
- Task residue: no new residue found.
