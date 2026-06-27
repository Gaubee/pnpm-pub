---
title: "Keytar fat-package output did not preserve the package layout required by its JS shim"
state: closed
github_issue_status: closed
label: "build"
---

## Summary
The Chapter 9 Keytar fat-package law said the build should copy Keytar's JS surface and prebuilds, but the build plugin flattened native binaries to `<platform>.node` while the copied Keytar JS shim expects `prebuilds/<platform>/keytar.node` under its own package boundary.

## Impact
The production artifact could contain both a JS shim and native binaries yet fail to load the bundled Keytar atom. The runtime loader also kept a direct native-binary branch, which preserved a second packaging path instead of enforcing the copied-package law.

## Evidence
- `node_modules/@github/keytar/lib/keytar.js` loads `../prebuilds/<platform>/keytar.node` relative to its own JS file.
- `tsdown.config.ts:35-46` previously copied native files as flattened `<platform>.node` files.
- `src/daemon/keychain.ts:97-102` previously retained a direct native-binary fallback branch.
- Requiring the emitted shim before the fix failed before exposing the Keytar API.

## Resolution
- Changed the build plugin to copy Keytar prebuilds under `dist/prebuilds/keytar/prebuilds/<platform>/keytar.node`.
- Copied the Keytar JS entry at its package-relative path and wrote `dist/prebuilds/keytar/package.json` with `"type": "commonjs"`.
- Removed the runtime direct native-binary fallback branch so production loads through the copied Keytar package atom.
- Updated `spec/09.md` to describe the copied shim, preserved package layout, and CommonJS boundary.

## Self-Review
- Task offset: this is a Chapter 9 packaging-law fix; it does not change credential semantics or add a compatibility track.
- Task residue: none after typecheck, keychain tests, core build, emitted-layout inspection, emitted shim require, stale direct-binary search, and `git diff --check`.
