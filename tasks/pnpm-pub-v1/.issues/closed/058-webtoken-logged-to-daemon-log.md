---
title: "Daemon startup serialized the WebToken into the log file"
state: closed
github_issue_status: closed
label: "security"
---

## Summary

Daemon startup logged the full WebUI URL by calling `web.webUiUrl(port)`, which included the lifecycle-scoped `#token=...` WebToken.

## Impact

Chapter 3.2.2 defines the WebToken as a per-startup UI authorization secret injected through the tray/WebUI launch surface. Serializing that token into `~/.pnpm-pub/logs/daemon.log` turned a transient authority token into a disk artifact and weakened the local anti-forgery boundary.

## Evidence

- `src/daemon/index.ts:145` now logs `web.webUiUrlRedacted(port)` instead of the secret-bearing WebUI URL.
- `src/daemon/web-server.ts:362` still exposes `webUiUrl()` for the explicit tray/dev launch source.
- `src/daemon/web-server.ts:367` adds `webUiUrlRedacted()` for log-safe availability messages.
- `test/unit/daemon-logging.test.ts:24` proves daemon startup logs `#token=<redacted>` and does not contain the real `handles.webToken`.

## Resolution

- Split the WebUI URL projection into launch authority (`webUiUrl`) and log projection (`webUiUrlRedacted`).
- Preserved explicit interactive token delivery for tray/dev surfaces while removing token serialization from daemon logs.
- Avoided compatibility aliases or dual token names; only the projection boundary changed.

## Self-Review

- Task offset: this round only fixes daemon-log WebToken leakage.
- Task residue: the dev runner still prints the full WebUI URL to the interactive console by design, because that is the explicit developer launch surface rather than durable daemon log storage.
