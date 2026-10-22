# Editor-facing CLI audit

## Current release guidance

For current installation and supported-platform guidance, use the
[official installation guide](https://ddupasquier.github.io/rehearsal-db/vscode/):
Free Starter **0.1.23**, canonical ID **`rehearsal-db.rehearsal-db`**, paired with
core **1.0.2**. [Issue #186](https://github.com/Ddupasquier/rehearsal-db/issues/186)
records the migration-diagnosis and workflow fixes;
[issue #137](https://github.com/Ddupasquier/rehearsal-db/issues/137) records the later
configuration-recovery patch. Remaining integrated native, provider and accessibility
acceptance is tracked separately in
[issue #130](https://github.com/Ddupasquier/rehearsal-db/issues/130).

This report preserves artifact-specific observations and describes focused companion
checks. Historical identities, versions, publication status and resource blockers below
belong to their recorded observations, not the current release. They do not certify
later artifacts or unexercised native/provider/accessibility behavior.

## Static Migration Insights source contract

The source candidate adds optional `rehearsalContracts.migrationInsights: 1` consumption
through `inspect insights --json`, only with an independently validated plan v1 in a
trusted ready idle workspace. This section does not claim public 0.1.23/core 1.0.2
contains the feature or that a native editor observation has happened.

The closed schema-1 report includes the inspector version, complete candidate digest and
count, ordered targets/providers/baseline identities, exact candidate filenames/hashes,
bounded lexical rule findings, fixed explanation/remediation, explicit unknown coverage,
read-only safety and a non-safety limitation. Every binding must match the current plan;
unknown additions or SQL-bearing prose are refused. Optional analysis unavailable/invalid
keeps ordinary review/rehearsal controls intact. Core version/activity drift still fails
the normal inspection closed. Older packages are not asked for this command.

Only this response has an 8 MiB transport/parse cap. The accepted core analysis limits
are 1,000 candidates, 10,000 total files, 10,000 entries per migration directory, 2 MiB/file,
16 MiB total input and 5,000 findings. The existing migration rows show at most ten
findings each and disclose omissions. Findings contain no SQL bodies, object identifiers
or row values. Unknown or no-warning results never establish SQL validity, safe data
impact, production behavior, permissions or lock impact.

Static navigation uses a host-resolved opaque exact-report/finding ID. It rechecks the
current trusted idle snapshot, canonical confined file identity, exact digest, clean
document text and the actual UTF-16 lexical position. It neither invents failure
provenance nor changes existing SQLSTATE attribution. No SQL is edited or executed and
no engine, database, provider login or upload is started.

Focused parser/snapshot/source/navigation tests exercise these boundaries. Pure model,
mocked panel and file-reader checks are not native rendered/keyboard/Save-dialog,
provider-execution, screen-reader, Windows or Remote-WSL acceptance. Exact packaged and
installed-consumer verification remains separately required before release claims.

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

## Native editor-owned cancellation companion

The separate macOS-only companion exercises the installed canonical extension's real
activation, project terminal, Activity cancellation and public CLI state. It is opt-in,
not a new CI or release gate:

```bash
node --import tsx scripts/verify-native-cancellation.ts /absolute/rehearsal-db-0.1.23.vsix FULL_VSIX_SHA256 /absolute/prepared-fixture.json
```

The closed fixture contract in the launcher requires a fresh leased manual PostgreSQL
session, the exact published core 1.0.2 artifact and canonical 0.1.23 VSIX, local engine
identity, configured loopback addresses, immutable baseline generation and hashes/modes
of preserved files. Prepare the synthetic source, baseline and runtime through Test Lab's
maintained manual workflow first; retire its temporary reader and stop its source.
Use `keep-until-stop` for both lifecycle policies. Do not open the application beforehand.
Neither an existing user's sandbox nor a generic project is an accepted fixture.
The current public VSIX is pinned by both version and SHA-256; an arbitrary caller
checksum cannot authorize another artifact. Reports name the actual selected version,
checksum and public/private distribution. The original 0.1.22 public-artifact scenarios
remain available only with their historical exact checksum; the historical private
0.1.22 candidate remains restricted to `configuration-guidance`. These are separate
observations, never current-release native acceptance by inference.

The Mac must be unlocked normally; the companion does not bypass the login screen.
The launcher verifies exact installed inventories and creates its own editor profile.
Its private zsh initialization loads the selected VS Code application's official shell
integration script, resolved before startup; automatic injection is disabled only in that
disposable profile. User shell files and settings are untouched. Missing real shell API
events still fail acceptance; the compatibility terminal fallback is not substituted.
Both automatic-update options are off. A real operator declines metadata checks if
offered, approves Open Sandbox, then selects Activity's **Cancel editor-started operation**
and confirms **Cancel Operation**. The nonce-bound phase/control files coordinate those
observations; they never replace consent. With repeated-confirmation coverage enabled,
the second real command must return while the original confirmation stays open.

Require passing native and final verification reports: actual exact-execution start and
terminal closure, faithfully recorded shell-exit evidence when emitted,
matching-identity descendant cleanup, unavailable application listener, surviving unrelated
sentinel, unchanged baseline/files/leases and a still-running database. The launcher
reaps only its isolated editor, uninstalls its private extension copy and removes that
profile on success. The driver uses ordinary development-host activation, not VS Code's
automated-test mode, which deliberately suppresses real confirmation dialogs. Closing
the isolated editor and matching-identity descendant cleanup are recorded separately
from cancellation evidence. The caller still owns fixture databases, workspace and lease cleanup.
Cleanup observes bounded process identities before signalling individual owned processes;
a numeric process group or an ambiguous signal-zero error is not ownership evidence.
Linux observations use procps's kernel-backed executable-path field, not the mutable
thread name that Node can report as `MainThread`; macOS retains its executable `comm`
projection. PID, parent, process group and birth-time checks remain mandatory. Unknown
identities still refuse cleanup, and no observation deadline or inventory bound changes.
Failure retains bounded evidence; fallback cleanup cannot turn failure into a pass.
If a scenario requests recovery, actual dirty documents remain at finalization, or
editor state cannot be verified, the driver records a failed recovery disposition and
does not close the isolated window. Only a bounded dirty-document count/boolean is
recorded, never buffer text or paths. The launcher then skips signalling cleanup,
extension uninstall and profile removal, and retires its own waits while retaining
that actual window/profile for explicit inspection and saving. Reconcile the failed
receipt and save unknown work before manually closing or cleaning up that owned host;
retaining a profile alone is not proof that an unsaved buffer was backed up. A proven
clean success or clean failure retains the existing owned-editor cleanup behavior.

This is not mid-migration rollback, Windows/Remote-WSL, VoiceOver or subjective layout
acceptance. Command dispatch and control acknowledgements alone do not prove visible UI
actions. Record actual rendered observations separately. A graceful Open close may record
completed core history; missing exact shell-exit evidence leaves the editor receipt
unverified, not Cancelled or successfully completed. Clean cancellation and a confirmed
editor exit receipt are distinct observations; the companion never invents the latter.

### Native workbench review scenario

After cancellation acceptance finishes, the same opt-in launcher can reuse that leased
synthetic workspace without a reset:

```bash
node --import tsx scripts/verify-native-cancellation.ts /absolute/rehearsal-db-0.1.23.vsix FULL_VSIX_SHA256 /absolute/prepared-fixture.json workbench-review
```

This fixed scenario requires the original active 10,003-row baseline and a genuinely
retained, inactive three-row baseline with the same migration boundary. Prepare the
inactive generation through the installed public baseline builder with `activate: false`;
never change the active pointer, source, database or privacy key for a comparison demo.
The synthetic fixture starts with retention 2. Its unprivileged database and application
ports are derived from the verified manual-session lease, not a fixed machine port;
the scenario refuses a URL outside that exact lease rather than guessing its meaning.

The installed extension activates normally. Actual UI actions open and cancel a
configuration review, apply only retention 2 → 3, and return to the project. The driver
checks real review tabs, exact saved bytes, unchanged comments and bounded save events.
Another review is deliberately made stale by saving one exact, harmless source comment;
the actual stale Apply must refuse without overwriting that edit. An out-of-bounds
resource-policy proposal must be refused before review on 0.1.23; historical 0.1.22
instead requires complete validation to refuse its actual reviewed Apply without saving.
A fresh valid review is then opened and cancelled. Visible
errors require separate native observation; coordination alone never proves them.
Restoration accepts only known clean, saved fixture revisions after the review closes;
unknown disk or unsaved changes are preserved and fail acceptance.

Two exclusively created, display-only migration files provide contrasting order/name
controls. They are never applied; public candidate plans must remain identical across
the coordinated display phase. Cleanup removes only matching owned file identities and
bytes. The current native migration display has three rows, not a large-list acceptance
claim. A separate read-only inventory phase permits keyboard/focus, theme, large-text,
layout and assistive-technology observations without starting or stopping services.
Comparison/export acceptance has its own workflow and is not run by this
workbench-review scenario; both prepared baselines remain protected.

Require `workbenchReviewPassed`, preserved baseline/files/leases, restored configuration,
zero terminal executions and clean read-child closure without fallback. This certifies
only those objective observations. Phase acknowledgements do not certify that a filter
was visibly used, a refusal was readable, or that layout, focus, keyboard, themes or
screen readers worked. Record those observations separately. A genuinely stopped-engine
inspection and provider-login checks remain separate; this scenario neither stops the
shared engine nor claims to finish every workbench ticket.

For a continuation that only needs rendered inventory/migration observations, select
`presentation-review` instead of `workbench-review`. It skips all configuration edits
and retains the same file, baseline, zero-terminal, complete-plan and cleanup checks.
Its longer bounded inventory phase permits direct theme, keyboard and layout work;
it is not proof that any of those observations happened. Do not repeat already-proven
configuration acceptance or enable spoken accessibility output without permission.

The fixed `configuration-guidance` scenario accepts current public 0.1.23 or the
separately pinned historical private candidate. It exercises a stale review refusal, an invalid numeric value
refused before review, and correction into a fresh cancellable review. Native HTML
validation may refuse the invalid value before a host message: observe the field help,
no review and no save, rather than requiring a particular toast. Capture the actual
stale alert, disabled Apply and focused Close separately. It creates no SQL files and
does not imply that the private candidate was released or upgraded in a user's editor.
The source supports these exact artifacts; unit and process checks of this companion
do not establish a fresh native GUI run for 0.1.23. Native execution stays separately
opt-in and must never enable speech or speaker output without owner authorization.

## Installed migration and endpoint companion

Add `--workbench-review` to the Lab activity command for a separate synthetic consumer
of `inspect plan`, `candidates` and read-only endpoint proposals. Require a passing main
report, passing `workbenchReview` and removed workspace. Then run:

```bash
node --import tsx scripts/verify-workbench-review.ts /absolute/path/to/operation-activity.json FULL_ARTIFACT_SHA256
```

This companion uses the production migration parser, cross-snapshot guard, shared display
filters/sorts and configuration/URL validators. Lab independently proves ordered file
identities, stale-confirmation refusal and topology conflicts. Editor checks prove its
stricter URL rules; neither layer substitutes for an occupied-listener launch, restart,
native keyboard/layout, screen reader or provider login. No database services are started
by this focused workflow.

For live endpoint acceptance, use the Lab's separate leased workflow:

```bash
npm run resources:verify -- /absolute/path/to/core.tgz --profile=postgresql --endpoint-review
```

Require passing `profiles.json`, its PostgreSQL `endpointReview.status`, and
`isolation.json`. This checks occupied-listener refusal, two database-backed application
sessions, and an ordinary database stop/start with the synthetic edit and exact resources
preserved. The existing engine must be running; only disposable Lab resources are removed.
Browser and readiness paths stay separate. This is not native editor, provider-login,
screen-reader, VM-shutdown or Supabase acceptance.

## Native migration-failure panel companion

On macOS, the separately opt-in native companion accepts one frozen canonical VSIX,
its full SHA-256, recorded public samples, and an optional fourth exact attempted SQL
file:

```bash
node --import tsx scripts/verify-native-migration-failure.ts /absolute/candidate.vsix FULL_VSIX_SHA256 /absolute/public-samples.json /absolute/attempted-migration.sql
```

Omit the SQL argument when source-link acceptance is not requested. The samples file
is a closed `schemaVersion: 1`, `kind: "migration-workbench-samples"` wrapper, bounded
to 64 KiB, containing `artifactSha256`, `failureActivity` and corrected public envelopes
for activity, explain, status, candidates, doctor and baseline inspection. The legacy
single public `activity --json` success envelope remains accepted within 256 KiB, but
does not exercise the corrected workbench. Inputs must be regular files, not private
history or terminal output. Retain the originating core-artifact evidence separately;
a recorded version or hash declaration alone does not verify those artifact bytes.
The report distinguishes the VSIX hash, public-input hash and recorded core-artifact
hash, and compares installed extension files with the exact frozen archive.

An isolated native VS Code host loads the installed production parser and panel owner.
A minimal event-emitting projects/actions consumer exercises a recognized diagnosis
through snapshot refresh, then an explicitly controlled unknown diagnosis through
refresh and panel close/reopen. Malformed SQL-bearing, changed-summary and mismatched
receipt controls must refuse. Corrected envelopes additionally pass through the
production inspector's injected client and panel refresh, checking idle command activity,
a completed run with recorded primary CLI proof, a separately running database, zero
pending migrations and database-only next steps without an application-launch requirement.

When supplied, the SQL input is bounded to 2 MiB, must be valid UTF-8, and must match
exactly one recorded attempted-input SHA and safe relative path. Only an owned workspace
copy is opened through the production source handler. A changed-byte control must refuse
without opening the altered file; the copy is then restored. Final fixture inventory,
source bytes and public-input bytes must match their initial state. Without the optional
source, the workspace stays empty. No terminal, CLI or database operation is launched.
The existing normal-memory-pressure guard applies; the launcher owns and reaps only its
isolated editor process group.

Require the native result and final verification report to pass, including editor exit,
exact-extension uninstall and profile removal. Failure keeps bounded phase evidence
and the owned fixture for investigation. This proves native API/panel-document refresh,
not complete extension activation, a new provider execution, rendered DOM, human visual,
keyboard, screen-reader, Windows or Remote-WSL acceptance. It adds no CI or release gate.

## Installed baseline scope and resource-policy companion

Add `--scope-policy-review` to the Lab activity command. It creates separate synthetic
local-file PostgreSQL and Supabase consumers, with infrastructure tools denied and
audited. Require a passing main report, `scopePolicyReview.status: "passed"`, zero
audited tool calls and removed workspace. Then run:

```bash
node --import tsx scripts/verify-scope-policy-review.ts /absolute/path/to/operation-activity.json FULL_ARTIFACT_SHA256
```

The companion uses the production baseline/provider and policy parsers, aggregate scope
renderer, and resource-field validators. It checks multi-schema allowed/excluded tables,
an empty included table, relationship warnings, Storage aggregates, a bounded 2,051-row
sample, retained generation identity, fingerprint-bound non-writing proposals and exact
refusal outcomes. Source permission stays configured-but-not-contacted; missing source
schema evidence stays unavailable. It does not authorize a source or display private rows.

The companion requires sixteen exact, ordered refusal controls, including prototype
paths. Only the exact published rc.7 version and SHA-256 retain its observed diagnostic
defects: zero retention is `baseline_invalid` (4); manual-only and prototype paths are
`internal_failure` (10). Every other artifact must classify rejected configuration
proposals as `configuration_invalid` / `CONFIGURATION_INVALID` / exit 2. Matching version
metadata alone cannot select a historical exception. Baseline-input and checksum failures
retain their separate categories. These checks never accept an arbitrary nonzero result.

Earlier fourteen-control reports remain historical evidence for their original scope;
rerun the strengthened Lab scenario before using this companion. Their earlier acceptance
does not establish prototype refusal or whole-sequence preservation coverage.

The report is read through the shared 256 KiB regular-file, no-follow boundary and must
match the exact artifact and completed cleanup. This proves neither a running database,
Storage service, successful resource deletion, provider login nor native editor behavior.
Save/apply, visual, keyboard and screen-reader observations remain separate requirements.

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
