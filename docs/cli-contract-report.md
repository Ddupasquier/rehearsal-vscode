# Editor-facing CLI audit

## Historical Environment Workbench acceptance

The observations below were validated against the local `@rehearsal-db/core@0.1.0-rc.4` Environment Workbench
candidate. Package SHA-256:
`468fa219769ec7d0d902a4ce6aed7c8a66087005993f3ba4de39a5179634ba5a`.
This is candidate evidence, not a registry-publication claim. Test Lab installed that
exact artifact and exercised both PostgreSQL and Supabase from clean temporary consumers.
They do not certify later source changes. New resource-manager, configuration-review,
shape-evidence and progress work requires its own exact-artifact acceptance; the earlier
native host and VoiceOver observations must not be relabeled as tests of those controls.

## Result

The public CLI is sufficient for a safe project workspace without private imports or
human-output parsing. The extension can show package version, current operation activity,
readiness checks, configuration, targets, baseline metadata, candidate migrations,
approval digest, structured local-runtime state, and the loopback application URL.

The three original contract blockers are resolved in core:

- [structured runtime state](https://github.com/Ddupasquier/rehearsal-db/issues/112);
- [structured operation/busy state](https://github.com/Ddupasquier/rehearsal-db/issues/113);
- [mutating-operation cancellation contract](https://github.com/Ddupasquier/rehearsal-db/issues/114).

The extension cancels only its own read-only inspection process group. Guided operations
do not call a private API or reimplement the runtime: an allowlisted action opens the exact
public command in a project-scoped integrated terminal. Dependency writes and risky
runtime actions require an editor modal first, while Rehearsal core retains its own
digest, lock, local-target, confirmation, rollback, and cleanup checks.

## MVP matrix

| Need                 | Public command            | Accepted fields                                              | Exit behavior                                 |
| -------------------- | ------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| Installed version    | `--version --json`        | `name`, `version`                                            | `0`; resolution failure means missing package |
| Operation activity   | `activity --json`         | `schemaVersion`, `state`, sanitized operation metadata       | `0` or versioned error                        |
| Readiness            | `doctor --json`           | envelope plus `data.state`, `data.checks[]`                  | `0` ready, `1` not ready, `2–10` error        |
| Config and local URL | `explain --json`          | `data.config`, `data.environment`                            | `0` or versioned error                        |
| Baseline             | `inspect baseline --json` | generation, timestamp, counts, verification                  | `0` or versioned error                        |
| Candidates           | `candidates --json`       | filenames, per-target set, exact SHA-256                     | `0` or versioned error                        |
| Runtime              | `status --json`           | per-target `runtimeStatus`; human `data.output` is discarded | `0` or versioned error                        |
| Local resources      | `environments --json`     | exact owned environments, live use, and bounded capacity     | `0` or versioned error                        |

All normal envelopes use `schemaVersion: 1`, `rehearsalVersion`, `command`, `status`,
timing, warnings, and data. Error envelopes use the same schema version plus a stable
category, code, suggestions, and exit code mapping. The version result is a separate
two-field contract.

## Invocation contract

- Resolve the workspace-local manifest, or a repository-local hoisted manifest for a
  nested workspace, and use its declared bin. Never use `npx`, PATH lookup, a global
  package, a shell, or private package imports. Never search above the repository root.
- Use the workspace folder as `cwd` and pass `--config=<relative-path>` when configured.
- Pass only a documented infrastructure environment allowlist.
- Bound stdout and stderr independently to 1 MiB.
- Use the resource-scoped 15–300 second inspection timeout (90 seconds by default) for
  version and detail commands alike. A slow filesystem must not hit a separate hidden
  five-second limit before the user's timeout setting can apply.
- Cancel the extension-owned process group with `SIGTERM`, then `SIGKILL` after a short
  grace period. Never signal an existing Rehearsal operation reported by `activity`.
- Treat cancellation and timeout as adapter states; a killed process cannot promise a JSON
  envelope.
- Never log raw process output. Reduce absolute configuration paths to workspace-relative
  paths before display.

## Scenarios covered

- package missing;
- incompatible package with a direct, confirmed npm/pnpm/Yarn/Bun update path;
- missing, malformed, root, nested, explicit, and competing configurations;
- ready and not-ready projects;
- idle, busy, stale, and invalid operation-state contracts;
- stopped, running, unavailable, unhealthy, and mixed runtime contracts;
- zero and nonzero candidate shapes;
- schema mismatch, unsafe endpoint, contradictory state, and malformed JSON;
- output bounds and timeout;
- cancellation and extension-owned child cleanup;
- independent multi-root state;
- exact-candidate PostgreSQL Test Lab state plus the clean-room library's missing-config
  state, both in isolated temporary copies.

## Installed operation-history companion

For a focused activity-contract check, run Test Lab's
`scripts/verify-operation-activity.mts` with the exact core tarball. It installs a fresh
consumer, records successful baseline creation and an unconfirmed-candidate refusal,
and verifies private history isolation with infrastructure calls denied.

Then run this from the extension checkout, using its report path and the exact artifact
SHA-256 printed by Test Lab:

```bash
node --import tsx scripts/verify-operation-activity.ts /absolute/path/to/operation-activity.json FULL_ARTIFACT_SHA256
```

The extension's production parser and HTML generator must accept all four safe samples
without inventing successful runtime stages. Failed, mismatched or incompletely cleaned
evidence is refused. This is not native terminal cancellation, rendered layout,
keyboard, screen-reader or provider acceptance. Terminal execution ownership and reload
recovery have separate action-owner regression tests.

Add `--editor-review` to the Lab command to exercise read-only configuration proposals
and actual retained baseline generations in the same isolated consumer. Then run:

```bash
node --import tsx scripts/verify-editor-review.ts /absolute/path/to/operation-activity.json FULL_ARTIFACT_SHA256
```

This companion uses production configuration/baseline parsing, comparison and JSON/Markdown
report generation. Unknown runtime/provider evidence stays unavailable; retained counts
do not become proof of row or schema equality. Root and nested configurations, stale and
invalid proposals, unchanged reviewed files and the original immutable generation are
checked independently by Lab. It does not certify native save dialogs, editor writes,
keyboard/focus behavior or assistive technology; those need separate direct observations.

## Direct Extension Development Host observation

On 2026-10-10, the prototype was exercised in an isolated macOS Extension Development
Host using VS Code 1.141.0 arm64. The host opened temporary copies of Test Lab's
PostgreSQL and clean-room library projects; it did not start either runtime.

- Both workspace folders rendered independently in Dark Modern, Light Modern, and
  Default High Contrast. Two VS Code zoom-in steps preserved readable navigation and
  state, with expected text truncation and tooltips in the narrow tree.
- Keyboard-only commands focused the Projects view, traversed its roots and rows,
  refreshed both projects, and activated an item to show its exact read-only CLI
  equivalent.
- macOS VoiceOver recognized the view as a Projects table, exposed the hierarchy, and
  announced concise labels for both `Ready for rehearsal, 15 passed · 0 failed` and
  `Setup needs attention, 0 passed · 1 failed`. VoiceOver activation of the attention
  row displayed `npx rehearsal doctor` without running it.
- The direct host exposed and verified two launch-boundary corrections: the extension
  runs its workspace CLI through Electron in Node mode, and core preserves that mode
  only for its own nested runtime manager. Project-owned commands still receive the
  restricted project environment.

Opening the local application and external documentation links was intentionally not
part of this read-only observation. No browser or running database behavior is inferred
from it.

## Project workbench

The Postman-inspired project workbench is an additional presentation of the same safe
snapshot already consumed by the Tree View. It introduces no CLI command or private
import. The Tree remains the native navigator; selecting a project opens a theme-aware
editor panel with readiness, workflow stages, aggregate baseline metrics,
candidate filenames and digest, runtime targets, project details, a readiness checklist,
and an explicit next step. Restricted command links carry only an opaque panel token and
an allowlisted action ID. They never embed an absolute workspace path.

The workspace exposes guided setup, plan review, exact-digest rehearsal and migrate,
sandbox open/start/verify/reset/stop/discard, identity connection, cleanup preview,
support, dependency install/update, configuration, application, documentation, refresh,
and diagnostic actions. The UI itself does not claim command success: the terminal owns
interactive output, and the project snapshot refreshes after observed shell completion.

Pure rendering tests cover ready, missing-package, outdated-package, restricted-workspace,
failure, and hostile-text inputs. Action-catalog tests cover exact digest binding,
availability, package-manager selection, confirmations, and shell quoting. Direct visual
evidence is recorded below only after the exact candidate is rebuilt and inspected.

On 2026-10-11, the maintained loopback-only fixture preview was inspected in Chrome at
the normal editor width and at a 420 × 820 compact viewport. Overview, Project setup,
Runtime, timeout recovery, and the incompatible-package update state rendered without
page-level horizontal overflow. Persistent navigation, the skip link, expandable evidence,
and the unique **Update Rehearsal** action were exercised by keyboard or semantic browser
locators. Dark, light, and high-contrast variable sets preserved readable hierarchy and
visible focus styling. The rendered document contained one main landmark, a labeled
workspace navigation and no absolute workspace path. Its nonce-authorized navigation
script was limited to selecting known rendered pages. This browser check does not
substitute for VS Code Extension Host or assistive-technology acceptance.

The rebuilt extension was then installed into the normal macOS VS Code profile and the
window was reloaded. Test Lab's PostgreSQL project rendered **Ready to create a sandbox**
with 15/15 readiness, 10,003 baseline rows, zero candidates, one stopped PostgreSQL
target, and the Create sandbox action because no verified runtime receipt exists.
BlendCalc's installed `0.1.0-rc.2` package rendered
**Rehearsal update required** immediately, with the same state in the native Tree View and
a unique **Update Rehearsal** button in the workbench. The unsupported rc.2 CLI was not
executed, the former timeout did not recur, and no update command was approved or run.

After the runtime-receipt and navigation correction, the rebuilt VSIX was reinstalled and
the Test Lab VS Code window reloaded. Direct pointer checks selected Overview, Project
setup, Migrations, Runtime, and Configuration and displayed the matching page each time.
With no current runtime receipt, Overview and Runtime showed **Create sandbox** rather
than **Open sandbox**. Opening that action displayed the exact `rehearsal run` confirmation;
the confirmation was cancelled, activity remained idle, and no runtime was started.
This directly verifies installed-extension discovery and the project-package update
surface while preserving BlendCalc's manifest, lockfile, and dependency tree.

## Packaged installation observation

The private prototype package contains runtime JavaScript, the extension manifest,
documentation, license, logo assets, and the project-workbench stylesheet; it excludes
source files, tests, declaration files, and source maps. VSIX metadata is not reproducible
byte-for-byte, so `npm run verify:vsix` prints the file count, byte count, and SHA-256 of
each exact handoff artifact instead of treating a previous build's digest as current.

The exact VSIX was installed into isolated VS Code user-data and extensions directories
as `rehearsal-db.rehearsal@0.1.0`. The maintained `npm run verify:vsix` command now
rebuilds this archive, checks its allowlisted production contents, performs the isolated
installation, verifies the installed identity, and removes its temporary files. The
earlier direct host observation also launched the packaged extension without
`--extensionDevelopmentPath`: its commands appeared in the Command Palette, and its
Projects view independently rendered the PostgreSQL Test Lab fixture as ready and the
clean-room library fixture as needing setup. This verifies packaged discovery and
rendering; Marketplace publication, update delivery, and external-link navigation remain
untested.

Each private handoff VSIX is identified by the file count, byte count, and SHA-256 printed
by `npm run verify:vsix -- /absolute/path/to/candidate.vsix`. The digest belongs to that
exact archive; VSIX metadata means a later rebuild can have a different checksum without
a source change. The repository documentation deliberately does not embed a handoff
archive's own checksum, which would become stale as soon as that documentation is packaged.

Version 0.1.1 adds narrow project-file watchers so an external core installation refreshes
the Tree View and open workbench automatically. Package-manager write bursts are debounced;
the extension does not poll, execute package-manager code, or watch unrelated dependencies.

The same core artifact completed Test Lab's full candidate-acceptance workflow for both
PostgreSQL and Supabase targets, including onboarding, source preparation, baselines,
lifecycle, cleanup, identity, application, and unrelated-container isolation. That
acceptance validates the core candidate used by the extension; Test Lab is not part of
the extension product or runtime dependency.

## Project Profile and Environment Workbench candidate contract

The candidate adds `discover --json`, advertises Project Profile schema 1 in its package
manifest, exposes retained baseline generations, and returns safe application and cleanup
configuration through `explain --json`. The extension consumes those fields only when
advertised and otherwise keeps the existing overview plus a clearly labeled, limited VS
Code workspace-metadata bootstrap.

The candidate contract separates `detected`, `suggested`, and `decisions`; suggestions
carry confidence and review text, and every category carries bounded evidence. It reports
proposed configuration-field states but performs no write. The extension rejects unknown
schemas, absolute workspace evidence paths, unbounded values, or a safety declaration
that admits project-code execution, `.env` access, database contact, or Docker startup.

`explain.baseline.sourceSchemaSha256` and `inspect baseline.sourceSchemaSha256` are
additive, nullable SHA-256 fields for reviewed source-column metadata. Comparisons use
that exact receipt when available; missing legacy evidence remains unavailable, even
when row counts and migration history match. This is not a digest of complete current
runtime DDL and does not certify schema or application equivalence.

On 2026-10-11, the exact candidate completed Test Lab's full candidate workflow. The
machine report and isolation report passed for clean adoption, PostgreSQL, Supabase,
synthetic copied-account authentication, application lifecycle, migration application,
cleanup, numeric correspondence, and preservation of unrelated Docker resources. The
extension's installed-consumer check then observed 10,003 baseline rows, two retained
generations, a stopped PostgreSQL target, no candidate migrations, and a separate
missing-configuration clean room through public JSON only.

BlendCalc read-only acceptance used the code-identical candidate immediately before the
final documentation-only repack, without changing its tracked manifest, lockfile, or
project configuration. The extension observed two stopped Supabase targets, 1,139,886
aggregate baseline rows, two retained generations, three candidate migrations with digest
`be038d7baf756e254e41d5e25d5e1c277deadd89a323bed3e9e2827fd0a04fb0`, and the validated
loopback application configuration. A full BlendCalc restore remains blocked by the local
Colima disk being 94% full; no shared images or persistent volumes were removed. That
resource limitation is not relabeled as Google, restore, or end-to-end acceptance.
