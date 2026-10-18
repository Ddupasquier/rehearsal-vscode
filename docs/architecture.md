# Architecture decisions

## Product identity

| Decision      | Product-candidate contract                                                |
| ------------- | ------------------------------------------------------------------------- |
| Repository    | Separate sibling repository: `rehearsal-vscode`                           |
| Visibility    | Public repository and reviewed GitHub VSIX prereleases                    |
| Display name  | Rehearsal                                                                 |
| Extension ID  | `rehearsal-db.rehearsal`                                                  |
| Publisher     | `rehearsal-db` is reserved in metadata; no Marketplace account is assumed |
| Product owner | Rehearsal project, administered by Ddupasquier                            |
| License       | Commercial preview per user; Rehearsal core remains MIT                   |
| Version       | Owned by `package.json`; each released VSIX identifies its exact version  |

Public GitHub source and VSIX prereleases do not establish a Marketplace listing or paid
launch. Each artifact still follows its reviewed release decision. Marketplace publication,
publisher/account creation, public pricing, payment setup and a paid launch require their
own approval; repository visibility is not that approval.
The manifest's `private: true` prevents npm publication; it does not describe GitHub
repository visibility or prevent reviewed VSIX packaging.

## Technical foundation

- TypeScript with strict checking and CommonJS output for the desktop extension host.
- VS Code `^1.101.0` using standard Tree View, commands, progress, notifications, links,
  and resource-scoped settings.
  Version 1.101 moved the extension host to Node.js 22, matching the supported core
  runtime floor ([official release notes](https://code.visualstudio.com/updates/v1_101)).
- No UI framework. A native Tree View discovers projects; a narrowly scripted
  `WebviewPanel` owns the product workspace after the Tree prototype proved the contract.
  Its nonce-authorized navigation script only switches among seven rendered destinations
  and reports the selected page to the extension. It also manages bounded filters, view
  preferences, local-address input, comparison, report-export requests, and configuration
  proposals. Restricted `command:` links use opaque, panel-lifetime tokens; absolute
  workspace paths never enter webview HTML.
- Vitest for pure contract, process, and state-model tests. Test Lab supplies the real
  installed-package acceptance workspace.
  Unit checks use two workers to bound local memory pressure; live container checks
  remain serialized by Test Lab's maintained resource guards.
- macOS and Linux are supported for the prototype. WSL is experimental. Native Windows,
  browser-based VS Code, Codespaces, SSH, and Dev Containers are not claimed yet.

## Editor experience and accessibility

- Standard VS Code Tree View, commands, progress, links, theme icons, focus handling, and
  keyboard navigation carry entry into the product. The project workbench adds a
  persistent, keyboard-accessible navigation shell for Overview, Project setup,
  Migrations, Environments, Data & auth, Configuration, and Activity & reports. It uses
  semantic HTML and VS Code theme tokens
  with the Rehearsal mint accent; it has no custom focus model, network request, or
  independent project-state authority. Technical evidence is progressively disclosed.
- Activity & reports and Environments use one grid spacing rule between their sections.
  Activity spacing separates summary, comparison/export,
  command, and history sections. Nested cards do not add their own outer margins;
  comparison and export cards align in wide views and stack in compact views.
- Page and card container queries own content layout independently of the window's
  navigation breakpoint. Two-column pages stack when their actual usable width is
  insufficient; migration filters become two columns or one column inside their card.
  Narrow connection cards put each value below its label and give the local-address
  input a full row. Controls shrink within their parent, technical values wrap, and
  status labels remain readable rather than disappearing behind clipping. Check all
  seven destinations at intermediate editor widths as well as the 300px minimum,
  wide layouts, supported themes, keyboard navigation, and text enlargement. CSS
  structure tests guard these rules; only rendered inspection establishes layout.
- A trusted single-folder project opens its dashboard once after the first successful
  inspection in an extension-host session. Later refreshes respect a dashboard the user
  closed. Multi-root workspaces stay explicit rather than guessing a project. The Projects
  view also owns a labeled dashboard action as its first row and a dashboard button in its
  title; automatic opening can be disabled with a resource-scoped setting.
- Every icon has a plain-language label. Status is never communicated by color alone.
- Small semantic text uses 25% accent and 75% editor foreground, separately from vivid
  chart colors, status dots, fills and focus indicators. Numeric regression checks require
  at least 4.5:1 on modeled surfaces in Light/Dark Modern, high-contrast and fallback
  fixtures. Preview themes declare chart variables explicitly; native rendered checks and
  custom-theme review remain separate from that bounded numeric evidence.
- Activity places cancellation before progress and historical receipts, and offers it
  only for an operation started by this extension. The host still checks ownership and
  asks for confirmation before closing its terminal.
- Configuration reviews use opaque, read-only in-memory documents, not editable Untitled
  files. Retention is bounded to 16 reviews, 2 MiB each and 8 MiB total; evicted or closed
  project reviews show expiry guidance. Trust, workspace and canonical file identity are
  rechecked throughout approval and before saving. Diffs align unchanged suffixes so a
  single insertion does not mislabel all later settings as changes.
- Guided actions remain available from the keyboard. Read-only refreshes stay inside the
  adapter; approved operations open their exact public command in a project-scoped
  integrated terminal.
- English is the only reviewed prototype language. User-facing strings must remain easy
  to extract before a public localization commitment.
- Development checkouts update through Git; packaged GitHub prereleases update through
  explicit VSIX installation. No automatic extension-update channel is installed.

## Runtime boundary

### Optional release advisories

`update_advisory.ts` owns a separate opt-in release check, never `inspectProject` or
the webview. Native consent names the fixed public npm/GitHub metadata endpoints and
ordinary connection disclosure. Opening-session checks are coalesced, at most daily
per opted-in workspace, with no polling/daemon. Explicit checks remain available.
Each request set has a five-second deadline and each response a 128 KiB limit; redirects,
cookies, authentication and project data are excluded. Stable installations do not
receive prerelease core recommendations; preview users may inspect the beta channel.
Compatibility floor and release freshness remain independent.

Local workspace storage holds only consent/times/skipped versions under a hashed key.
Matching npm root/hidden locks, a compatible root declaration and canonical local
metadata enable a same-compatibility-series exact-version review. The update preserves
the dependency group and uses `--save-exact`. Other package managers, local candidates,
ambiguous metadata and new major (or 0.x minor) series stay manual-only. Native approval
rechecks trust, saved consent, workspace, installation fingerprint and public operation
activity before launch. Saved-preference drift cancels an in-flight advisory; Memento
checks are not cross-window atomic locking, a filesystem lock or artifact-integrity
certification. Existing
watchers retire obsolete compatibility warnings after external dependency updates.
Extension advice opens a fixed GitHub release with reviewed VSIX/checksum assets, never
a package-supplied URL or a global installer. Offline/unsafe metadata stays unknown.

The Environments page reads `environments --json` only when the installed package
declares `rehearsalContracts.resourceInventory: 1`. Core owns Docker inspection,
ownership labels, capacity measurement, and cleanup eligibility. The extension validates
and renders that bounded result; it never invokes Docker, Colima, or Supabase itself. If
the shared engine is stopped, configured environments remain explicitly `unavailable`
instead of being guessed absent. A missing contract produces an update-oriented empty
state rather than inferred resources.
When core additionally advertises `resourceManager: 1`, the adapter uses `resources --json`
and validates its bounded catalog before rendering individual images, volume attachments,
and other projects' read-only containers. Older cores keep their aggregate view. Resource
search/sort/filter state is harmless editor preference data; environment labels and
protection remain core-owned configuration fields. The configuration editor can insert or
replace only those two literal fields in one plain runtime object and refuses ambiguous
or expression-based forms.

Each inventory environment may supply optional provenance schema 1. It projects only
bounded, target-local runtime receipt fields: the recorded restore-writer Rehearsal version,
baseline generation/data checksum and candidate migration digest. The inspector version is
separate. New restores record their writer version; missing legacy metadata stays unknown.
Receipt provenance is explicitly `recorded-not-reverified`: it does not verify current
database contents, baseline files or migration history. Configured loopback service and
application ports come from reviewed configuration, not a listening-port probe. Missing,
malformed, incompatible or foreign receipt paths cannot lend facts to another target.
Created times describe the oldest observed owned resource; last observable activity is
container start/stop or volume metadata, not database access or user inactivity. Inspection
time is separately labeled. No new environment registry or historical-copy inference exists.
Named profiles are reviewed display views of configured targets and optional local browser
addresses; selecting one never creates a copy or changes operation scope.

Doctor readiness does not gate independent read-only resource facts. With an active
discovered config, validated configuration metadata and an advertised inventory contract,
the client can still inspect core-owned resources while a baseline or engine needs
attention. Readiness stays not-ready; unavailable verification is not inferred from
those resource facts. Endpoint refusal, malformed metadata and version drift never
enable a weaker fallback. The final activity check still rejects racing operations.

Optional environment classification schema 1 keeps presence, receipt compatibility and
age-based review orthogonal to running/stopped operational state. Presence is proved from
owned containers/volumes, not preparation receipts. Compatibility covers recorded
format/provider only; unknown legacy metadata and differing writer versions never prove
runtime incompatibility. The long-running review evaluator shares core's stale-stop
cutoff semantics but cannot authorize a stop. Configured sandboxes preserve data on
stop/start regardless of stop-after-run. Approved run/reset can replace data and volumes;
reviewed discard removes volumes. Persistence does not promise immutable sandbox data
or stable volume IDs across reset. The editor filters these proven
classifications and never upgrades an unknown into absence, compatibility or helper
ownership. Display choices do not execute an operation or change its approval digest.

Resource messages contain only a configured target, an allowlisted action, or selected
full image IDs. The host maps targets back to the current core snapshot. Image cleanup
first requests core's exact `--images-only` preview, rejects any runtime/baseline selection,
shows a modal with tags, IDs, estimates, and zero selected volumes, then delegates the
digest-bound apply to the existing owned terminal. Core revalidates all references and
eligibility before removal. A pin is enforced by core for reset/run/discard as well as
runtime cleanup, independent of this editor. No individual volume-delete action exists.

Each trusted workspace folder receives its own controller, cancellation signal, package
resolution, explicit working directory, optional configuration path, and state tree.
One folder cannot lend its package, configuration, result, or process to another.

The adapter first checks `node_modules/@rehearsal-db/core/package.json` inside the
workspace folder. For a nested workspace it may follow normal package-manager hoisting
up to—but never above—the containing Git repository. It validates the manifest and
declared `rehearsal` bin, then launches that bin with the extension host's Node
executable. It uses argument arrays and `shell: false`.
Manifest reads are bounded to 1 MiB through a regular-file handle. The executable's
canonical path must remain inside the canonical package root; a symlink cannot redirect
inspection to an unrelated program. Internal package-manager links remain supported.

The extension requires `@rehearsal-db/core@0.1.0-rc.4` or newer for the versioned
activity/runtime inspection contract. Older projects stop after the package version
check: no unsupported command is attempted. The workspace and Tree View show an update
action using the detected package manager. The exact dependency command and affected
manifest/lockfile boundary are shown in a modal before execution.

Each workspace owns narrow file watchers for its root manifest, supported lockfiles,
installed Rehearsal manifest, known configuration locations, and its explicitly configured
project-relative configuration file. That optional path is bounded and confined to the
workspace; glob metacharacters are treated as literal filename characters. Changing the
configuration-path setting replaces the old watchers and cancels their pending refresh.
Related file writes are coalesced into one trailing read-only refresh. This keeps the Tree View and an
open workbench current when Rehearsal is updated in another terminal, without polling,
running package-manager code, watching unrelated dependencies, or requiring a window
reload. Removing a workspace disposes its watchers and pending refresh.

The first view invokes only these public commands:

- `--version --json`
- `activity --json`
- `discover --json` when the installed manifest advertises Project Profile schema 1
- `doctor --json`
- `candidates --json`
- `inspect baseline --json`
- `explain --json`
- `status --json`

The adapter accepts only JSON schema version 1. It never consumes `data.output`. It reads
the public `activity` contract before inspecting the project and again after the parallel
read-only queries. When an operation is busy, stale, or invalid, the view omits project
details that could be inconsistent and presents only the safe activity state. Runtime
state comes exclusively from `status.data.runtimeStatus` for each configured target.

Baseline privacy review is also target-bound: both explain scope and independently
inspected baseline scope must name the target's reviewed provider. A contradiction
refuses the inspection instead of presenting mixed evidence. Legacy baseline metadata
without a scope-provider claim remains unknown; the client never invents that claim.

Project discovery remains a core responsibility. A discovery-capable package classifies
each entry as detected, suggested, or requiring a human decision and supplies bounded
evidence, confidence, proposed field states, and a safety attestation. The extension
validates that contract and rejects any result that reports project-code execution,
environment-file access, database contact, or container-engine startup.

Before a capable package is installed, a small extension bootstrap reads only bounded
`package.json` metadata, lockfile names, known config filenames, and conventional
migration directories through `vscode.workspace.fs`. It does not follow symlinks or
execute code. The bootstrap is labeled as limited in the UI and never grows into a
second comprehensive discovery engine.

The project workbench renders only the already-normalized `ProjectSnapshot` used by the
Tree View. It receives no raw CLI envelope, environment, credential, row, source URL, or
absolute workspace path. Its content-security policy allows only the packaged stylesheet,
logo, and a per-render nonce-authorized interaction script. Messages are parsed as a closed
union. They may update harmless local view preferences, open a validated loopback URL,
request a redacted report export, or submit a bounded configuration proposal; they cannot
provide a command line, filesystem path, credential, or Rehearsal operation.

Refresh cancellation terminates only the read-only CLI process group launched by this
extension. Each inspection command has a resource-scoped 15–300 second timeout (90
seconds by default), and timeout messages identify the command that exceeded it. Global
multi-root refresh runs at most two projects concurrently.

The tree and webview share one explicit inspection lifecycle. Starting a refresh exposes
an accessible, cancellable loading state without discarding the last completed snapshot.
When no snapshot exists, the dashboard uses named loading placeholders rather than
`Unavailable`. A timeout preserves any already-proven package, discovery, readiness, and
idle-operation evidence, then offers retry, timeout settings, Doctor, diagnostics, and
support. Unknown values remain honest, but never become a dead end.

Operational actions do not create a second runtime engine. The extension builds only an
allowlisted public command, previews the exact command in a modal for every terminal action,
adds stronger language for dependency writes and risky runtime changes, then runs it in a
workspace-scoped integrated terminal. Activity cancellation closes only an owned terminal;
it never signals an operation merely discovered through core's activity contract. Rehearsal core
continues to own exact-plan digests, confirmation flags, operation locks, local-only
validation, cancellation, rollback, and cleanup. Candidate execution is bound to the
digest already returned by `candidates --json`; a stale digest therefore fails closed.
Configuration creation and baseline/source decisions remain in core's interactive guide.

The migration plan must agree with the separately read candidate set on ordered targets,
baseline identities, digests, counts and candidate files before the editor exposes that
plan. A changed or contradictory snapshot requests a fresh inspection. Historical entries
precede one complete candidate or applied suffix; filenames never establish SQL safety.
`migration_filter.ts` owns display filtering and sorting for both the webview and installed
contract checks. Review checkmarks never select execution scope. At most 1,000 checked IDs
are remembered after refresh; larger histories show that limit and retain all migrations.
Name sorting uses the descriptive migration name; full filenames remain searchable.
Stable, target-scoped checkbox IDs restore keyboard focus after refresh. These IDs grant
no approval; restored checkmarks still require the same plan and baseline identities.
The maintained check executes the compiled controller without Node globals to catch
CommonJS closure references in serialized helpers. This DOM-double check does not prove
rendered navigation, layout or assistive-technology behavior.

Explicit editor cancellation observes only public activity for at most 30 seconds,
then refreshes actual project state. This is a bounded completion check, not idle
polling or a daemon. Removed workspaces and extension disposal abort the owned read.
An idle lock does not prove verification passed. Missing terminal exit evidence is
marked unverified, never silently recorded as successful cancellation.
Completion events must match the exact shell execution returned when the action
was launched. Another command in the same terminal cannot finish its receipt.
Without shell integration, later execution events supply no exit evidence; closing
the terminal retains an unverified receipt, including after a reload. Repeated
cancellation requests share one approval/cleanup observation, and approval is
followed by a fresh ownership, workspace-presence and trust check.
Legacy unknown-exit receipts retain their unverified outcome; their old terminal-close
timestamp is not completion evidence. While cleanup observation is pending, guard
rechecks abort the owned read on trust/workspace loss and prevent further CLI reads.

An explicitly editor-started terminal action also receives an activity-only monitor:
one serial public `activity --json` read every two seconds for at most five minutes.
It gives startup at most 30 seconds to expose a busy operation; absence or timeout
does not mean success. Busy/stale views discard potentially inconsistent project
details and render only strict public activity. Busy-to-idle triggers one full
actual refresh. Terminal end, removal, trust loss, disposal and deadline abort the
owned read and timers. No daemon or idle workspace polling exists; long sessions
use explicit Refresh after the bounded monitor ends. Cancellation completion uses
its separate 30-second observer only after active monitoring is disposed.

An active operation gets one full safety render to remove potentially stale project
details. Further samples of that same operation patch only the bounded, escaped progress
region in place; elapsed-time ticks do not replace the dashboard document. Navigation,
keyboard focus, scroll position and expanded evidence remain stable. Operation identity,
workspace/configuration, inspection mode or safety-state changes invalidate that partial
path. Failed message delivery falls back only for the still-current document, and a
hidden/discarded webview gets a fresh document when shown again. Safety transitions take
precedence over unsaved form drafts so stale controls cannot remain authoritative.
Explicit navigation to another page starts at the top after preserving the intended
keyboard focus. Same-page selections and live progress leave scroll position unchanged;
ordinary document restoration retains its existing saved-scroll behavior.

Known literal configuration fields may be edited through the workbench. The editor accepts
only bounded loopback URLs, commands, lifecycle enums, and retention counts; requires one
unambiguous literal per field; shows an exact diff; refuses dirty or concurrently changed
documents; and asks for modal approval before applying and saving. It does not parse or
rewrite arbitrary JavaScript expressions. Core remains the authority that validates the
complete file before any later operation.
The simple form proposes only semantic changes from its initial displayed values; untouched
defaults do not become new configuration literals. Restoring form values updates the draft
guard after the browser reset, while edits in other forms remain protected.
Structured review also checks public activity before review and immediately before save.
Busy, stale, and invalid states refuse the edit. Unsaved forms survive ordinary
inspection updates; users review or explicitly discard them before the view refreshes.
The browser address and application readiness endpoint are independent reviewed fields.
Changing the browser URL preserves the health-check URL. Change its origin or path only
through an explicit structured proposal or manual configuration edit. The provider's
Auth callback remains a separate core-derived endpoint, not an editable browser address.
Editor-entered URLs require an explicit unprivileged loopback port and no credentials,
query/fragment delimiters or raw control/line-separator characters. Percent-encoded path
characters remain path text. Core's configuration contract can be wider; editor input
refusals are verified at this stricter boundary, not invented as core refusals.
These checks do not claim to lock out ordinary manual filesystem edits by other tools.
Only one configuration review may remain active per workspace, including its approval,
apply and save phases. Cancellation, refusal and failure release that guard. The source,
closed and dirty states are checked again after save before success is announced. Drift
requires another review; the extension does not overwrite or roll back another editor's
changes. This detects concurrent changes, not an atomic filesystem lock. The editable
object must also be the complete supported default-export expression: bare literals and
one-argument `defineRehearsalConfig` calls are allowed; expression suffixes are manual-only.

## Trust, privacy, and storage

- Untrusted workspaces show one explanatory item and run nothing.
- `rehearsal.configPath` is resource-scoped and must resolve inside its workspace folder.
- `rehearsal.inspectionTimeoutSeconds` is resource-scoped, bounded to 15–300 seconds, and
  changes only read-only inspection timeouts.
- The extension stores no credentials, raw rows, baseline contents, source URLs, or CLI
  responses.
- Resource-scoped workbench preferences contain only filters, sorting, selected display
  target/profile, and a validated loopback URL. A bounded 20-entry activity list stores
  action label, timestamps, outcome, and exit code only. Workspace identities are hashed
  before use as storage keys.
- The output channel records only bounded lifecycle summaries and stable error codes.
- Telemetry is absent. Settings Sync may carry only the optional relative config path and
  bounded inspection timeout.

## Evidence export bounds

Markdown and JSON exports use an explicit metadata allowlist, never a serialized raw
snapshot. Aggregate counts remain aggregate evidence where supplied. Readiness detail is
limited to the first 1,000 checks, runtime/comparison detail to 32 targets, and retained
baseline comparison detail to 1,000 generations. When any list exceeds its limit, the
export includes an omission notice with the number omitted. Capped detail never implies
that omitted checks passed or additional targets were exercised. Export requires an
explicit save destination; it does not upload or share the report automatically.
The destination must be a local `file:` URI without an authority, query or fragment.
Users may explicitly choose a file outside the workspace. One pending export per workspace
owns its save dialog. Original workspace identity, panel, trust and exact inspection are
checked before the dialog and immediately before writing; a changed context refuses.
Dialog/write failures show fixed recovery guidance rather than raw paths or errors.
These guards do not make the asynchronous OS write atomic against later external changes.

## Commercial boundary

The approved product direction is a complete free MIT CLI, free VS Code Starter and
optional paid Pro editor workflows. [Commercial readiness](commercial-readiness.md)
owns the edition boundary and separate Starter/Pro launch gates; it is not an entitlement
implementation. Database execution and safety remain core-owned and independent of
payment. Future editor gates must preserve free stop, cancellation, recovery and essential
evidence; a failed or expired entitlement must never interrupt an operation or block CLI
recovery.

Current artifacts still use the commercial-preview `LICENSE`: 14-day evaluation and
per-user licensing through an accepted order. No trial clock, activation or feature-paywall
enforcement exists. There is no telemetry, account or hosted license service. Public
GitHub prereleases establish technical distribution only. New license terms, entitlement
design, paid launch, checkout, Marketplace publication, pricing and refunds require their
own review and approval; approving the product model does not approve those operations.
