---
title: "Trusted Publishing UI polish left workflow and batch draft residue"
state: closed
github_issue_status: closed
label: ui
milestone: 239
resolution: fixed
---

## Summary

The Q&A correction landed the right `configure-trust` / `setup-oidc` split, but the UI still had residue from the earlier dialog model:

- the generic current-config dialog exposed an OIDC tab even when the caller had no local package path for workflow preview/write;
- grouped batch `configure-trust` Events could receive independent draft edits instead of sharing the same batch draft;
- the new Trusted Publishing draft form still carried hard-coded English projection text.

## Impact

This blurred source boundaries in the interface. A package-list current-config dialog looked like it could write a local workflow without a local path source, and batch configuration did not fully preserve the user's "select all, then deselect" flow as one shared configuration intent.

## Evidence

- `webui/src/lib/components/trusted-publishing-dialog.svelte:48` derives `canPreviewWorkflow` from `config + packagePath`, and `webui/src/lib/components/trusted-publishing-dialog.svelte:83` only opens the workflow tab when that local path source exists.
- `src/daemon/store.ts:423` updates every pending grouped `configure-trust` Event draft through one `groupId`, skipping remove actions.
- `src/shared/orpc-contract.ts:255` and `webui/src/lib/store.ts:463` expose the grouped draft update as an explicit oRPC action.
- `webui/src/lib/components/trusted-publishing-draft-form.svelte:41` uses i18n label keys for provider choices, and the form labels now read from `trustedPublishing.*` projection strings.
- Browser evidence: `/tmp/pnpm-pub-trusted-dialog-current-no-workflow.png` shows the generic current-config dialog without OIDC tabs or disabled workflow actions.

## Resolution

Gated workflow preview/write UI behind a real package path source, propagated grouped batch drafts through a single backend update path, localized Trusted Publishing draft form labels, and updated the browser regression to assert the no-package-path current dialog remains a two-action dialog.

## Self-Review

- Task drift: kept the changes inside Trusted Publishing UI, event draft update plumbing, i18n, tests, and task ledger.
- Task residue: the existing Svelte components still use effect-based initialization; Svelte MCP reports this as a style suggestion, not a correctness issue. A deeper runes refactor should be a separate component architecture pass.
