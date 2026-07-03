---
title: "E2E publish document body used an unchecked cast"
state: closed
github_issue_status: closed
label: "type-safety"
---

## Summary

The publish interception E2E cast the mock registry PUT body directly to an npm publish document shape.

## Impact

Chapter 10.3 uses the mock registry PUT body as proof that confirmation released a real publish write with tarball attachments. That evidence should be validated against the document shape before assertions read `_attachments` and `versions`.

## Evidence

- `test/e2e/publish-intercept.test.ts` now defines `RegistryPublishDocument` and `PublishDocumentAttachment`.
- The E2E checks the mock registry PUT body with `isRegistryPublishDocument` before reading `_attachments` and `versions`.
- The focused publish interception E2E still proves parked publish intent, WebToken-confirmed publish, bad-token rejection, and clock-drift recovery.

## Resolution

- Replaced the direct publish-document body cast with a small shape guard.
- Preserved the E2E registry assertions for tarball attachment data and published package version.

## Self-Review

- Task offset: this round improves E2E registry write evidence hygiene; it does not change runtime CLI, daemon, WebUI, or registry behavior.
- Task residue: Dockerized Verdaccio still needs to be executed once Docker daemon access is available.
