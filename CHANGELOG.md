# Changelog

## 0.1.4 — Environment provenance and evidence bounds

- Adds optional per-target runtime provenance to **Inspect environment**: recorded
  restore-writer version, baseline generation and data checksum, candidate migration
  digest, and configured loopback ports. The inspecting package version is separate;
  legacy receipts remain unknown rather than borrowing current values.
- Labels receipt facts as recorded, not freshly verified. Configured ports are not
  listening-port checks, and container/volume timestamps do not prove user inactivity.
  Named profiles remain views of configured targets, not additional database copies.
- Preserves aggregate evidence while bounding export detail to 1,000 readiness checks,
  32 runtime targets and 1,000 baseline generations. Exports identify omitted detail
  instead of silently truncating it.
- Clarifies public GitHub source and VSIX prerelease availability. Marketplace
  publication, billing and a paid launch remain separate approval gates.

## 0.1.3 — Resource and evidence workbench candidate

- Adds browsable environments, persistent volumes, shared images and other projects,
  with search, sorting, protection, friendly labels and exact image-cleanup review.
- Adds ordered migration history, filterable review checklists, named display profiles,
  and structured configuration proposals. View selection never changes execution scope.
- Reviews privacy, authentication and sampled-baseline evidence; compares aggregate
  environments and exports bounded, redacted reports to an explicit destination.
- Shows core-owned stages and receipts. Live observation is bounded to editor-started
  actions and stops on completion, disposal, trust loss or timeout.
- Fixes dashboard flashing during live operations: progress updates in place without
  reloading the page or resetting navigation, focus, scroll or expanded evidence.
- Opens a newly selected workbench page at its top, without jumping on same-page
  selections or live progress updates.
- Makes small colored labels readable in light themes using separate adaptive text
  tokens; chart colors, status dots and focus indicators keep their original colors.
- Keeps cancellation above live progress instead of burying it below receipt history.
- Rechecks project trust, configuration identity and local-file ownership throughout
  configuration approval; changed or redirected files refuse without being saved.
- Opens configuration reviews as bounded, read-only in-memory diffs, without unsaved
  Untitled tabs. Insertions no longer make unchanged following settings look replaced.
- Proposes only changed simple-form values, preserving absent default settings. Restoring
  a form clears its draft state without discarding another form's unsaved changes.
- Preserves eligible selections, focus and unsaved forms across refreshes; hides filtered
  content correctly and guides missing application launch settings.
- Applies the configured inspection timeout to version checks too, avoiding a hidden
  five-second cutoff on slow filesystems.
- Keeps browser-address edits separate from reviewed application health-check URLs.
- Adds reviewed foreground idle controls; your application must supply the explicit
  activity signal. Missing signals do not trigger shutdown.
- Retires owned inspection descendants even when their launcher exits first.
- Refreshes automatically when an explicitly selected custom-named config changes;
  replacing that selection disposes its old watchers.
- Starts report export in the current workspace with a bounded, path-safe filename.
- Requires VS Code 1.101 or newer for its Node.js 22 extension host.

Native-host accessibility and commercial release approval remain separate gates. No
telemetry, hosted control plane, automatic billing or individual volume deletion is added.

## 0.1.2 — Automatic dashboard entry

- Opens the Rehearsal dashboard automatically once for a trusted single-folder project.
- Adds an explicit **Open Rehearsal dashboard** action at the top of the Projects view and
  replaces the ambiguous layout toolbar icon with a dashboard button.
- Adds `rehearsal.openDashboardAutomatically` for users who prefer manual opening.
- Replaces clipped compact tabs with an accessible navigation menu that works with mouse
  and keyboard input, preserves focus, and keeps every destination usable in narrow editors.
- Improves the tablet breakpoint and minimum-width summary layout so labels and status text
  remain readable instead of being truncated.

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
