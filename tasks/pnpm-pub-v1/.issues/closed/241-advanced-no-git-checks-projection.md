---
title: "Advanced panel projected empty args as no-git-checks enabled"
state: closed
github_issue_status: closed
label: webui
milestone: 241
resolution: fixed
---

## Summary

The pending publish EventCard Advanced panel rendered `--no-git-checks` as enabled when the event args did not contain any git-checks flag.

## Impact

The UI projection diverged from the daemon source of truth. A bare `pnpm-pub` publish created empty args, so the daemon kept git checks enabled, but the Advanced panel showed "No git checks" as enabled. The user had to toggle the switch off and on before the args actually contained `--no-git-checks`.

## Evidence

- `webui/src/lib/components/event-card.svelte` previously treated missing `--git-checks` as opted out.
- `src/daemon/publish-git-checks.ts` resolves CLI git-check args first, then env/npmrc, and defaults to git checks enabled when no source disables them.
- `src/daemon/store.ts` mutates pending publish and recursive-publish args in place, so Advanced edits are the source later confirmed by the scheduler.

## Resolution

Added `webui/src/lib/publish-advanced-args.ts` as the single WebUI parser/rebuilder for Advanced publish args. Empty args now project `noGitChecks: false`, explicit `--no-git-checks` still projects true, explicit `--git-checks` projects false, and edits patch only managed Advanced flags while preserving unmanaged publish args such as `--dry-run`, `--registry`, filters, and recursive intent.
