# Changelog

## 0.1.1 — Automatic project refresh

- Automatically refreshes the project Tree View and open workbench when another terminal
  changes the project manifest, package-manager lockfile, installed Rehearsal package, or
  known configuration file.
- Coalesces package-manager write bursts and disposes project watchers when folders close.
- Removes the need to reload the VS Code window after updating `@rehearsal-db/core`.

## 0.1.0 — Commercial preview candidate

- Added the project-aware Environment Workbench with seven focused destinations.
- Added safe project discovery, readiness, baseline, migration, runtime, and activity views.
- Added migration search, filtering, sorting, review state, and exact-digest context.
- Added target/profile views, retained baseline generations, and loopback app controls.
- Added bounded configuration proposals with exact diff and concurrent-edit protection.
- Added privacy-safe Markdown/JSON reports and extension-owned cancellation.
- Added explicit core update guidance and isolated packaged-install verification.
- Added bundled privacy, support, and license documents plus local editor-state reset.

This preview does not add telemetry, hosted database access, billing, or automatic license
activation. Rehearsal core remains a separate MIT-licensed package and safety engine.
