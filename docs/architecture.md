# Architecture decisions

Local suite drive placement is owned by one shared document discoverable through
`dt b open --json`. Repository module/build/evidence boundaries below remain intact.
Native harnesses use explicit developer-owned storage; shared coordination and existing
fixture/evidence migration require all affected owners. No system-temp fallback or
implicit sibling Lab checkout is selected by the suite development entry point.

## Repository layout

| Parent                  | Responsibility                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| `src/workspace/`        | Project discovery, tree, dashboard, actions and view state           |
| `src/migrations/`       | Migration contracts, review, findings and source navigation          |
| `src/configuration/`    | Literal configuration, forms and reviewed edits                      |
| `src/runtime/`          | CLI transport, engines, resources, operation state and reports       |
| `src/review/`           | Shared approval panels and stale-review protection                   |
| `src/updates/`          | Release checks, installation identity, preferences and updates       |
| `scripts/build/`        | Compatible flat runtime output                                       |
| `scripts/native/`       | Native editor launchers, drivers and synthetic fixtures              |
| `scripts/preview/`      | Loopback workspace and theme previews                                |
| `scripts/verification/` | Package, controller, platform and Lab verification                   |
| `tests/`                | Matching product domains, plus native, build and packaging contracts |

`src/extension.ts` remains the activation entry point; `src/contracts.ts` owns shared
snapshot types. Tool configuration and public documents keep their conventional paths.
Tests and verification automation are excluded from the installed extension.

Source folders do not change the installed layout: the build compiles TypeScript and
then maps modules, declaration references and source maps to flat `dist/src/` files.
`dist/src/extension.js`, manifest commands and the strict VSIX allowlist stay stable.
The mapper refuses ambiguous names, missing or escaping targets and unsupported module
loads before replacing generated output. It pads rewritten import literals to preserve
subsequent source-map positions and rebases original source paths. Generated output is
never edited manually or used as a second source owner.

## Product identity

| Decision      | Product-candidate contract                                                 |
| ------------- | -------------------------------------------------------------------------- |
| Repository    | Separate sibling repository: `rehearsal-vscode`                            |
| Visibility    | Public repository and reviewed GitHub VSIX prereleases                     |
| Display name  | Marketplace: Rehearsal DB; workbench and commands: Rehearsal               |
| Extension ID  | Canonical from 0.1.19: `rehearsal-db.rehearsal-db`                         |
| Publisher     | Registered Marketplace publisher `rehearsal-db`, administered by the owner |
| Product owner | Rehearsal project, administered by Ddupasquier                             |
| License       | Free Starter for included features; Rehearsal core remains MIT             |
| Version       | Owned by `package.json`; each released VSIX identifies its exact version   |

Public GitHub source and VSIX previews do not establish a Marketplace listing or paid
launch. Each artifact still follows its reviewed release decision and publisher/account
controls. The [official installation guide](https://ddupasquier.github.io/rehearsal-db/vscode/)
owns the current distribution channels; a registered publisher alone is not a listed
extension. Public pricing, payment setup and a paid launch require separate approval.
The manifest's `private: true` prevents npm publication; it does not describe GitHub
repository visibility or prevent reviewed VSIX packaging.

### Legacy identity migration

GitHub previews through 0.1.18 used `rehearsal-db.rehearsal`. That public artifact and
its tag/checksum remain immutable and downloadable. The canonical name change uses a
new version, 0.1.19, and assets named `rehearsal-db-<version>.vsix`. The old updater's
`rehearsal-<version>.vsix` filter ignores canonical-only releases rather than silently
performing an identity migration. Canonical metadata and ZIP/manifest validation accept
only the canonical asset name, publisher `rehearsal-db` and package name `rehearsal-db`.

The canonical activation entry point checks the native extension registry before
registering commands, watchers or update schedulers. If VS Code reports the legacy ID,
activation refuses with migration guidance. `isActive: false` proves only that an
extension is not active, not that it is disabled. No guessed disabled state or automatic
uninstall, disable, rename, reload or process interruption resolves coexistence.
The supported owner-driven sequence is finish commands, save files, uninstall legacy,
reload, install canonical and review preferences. A disabled legacy installation is
safe only when the native API no longer reports it; otherwise refusal remains.

Private global/workspace storage is scoped to the extension identity and is not read,
copied or rewritten from the old identity. View preferences, activity receipts and
metadata-check consent therefore start in the new identity's own storage. Existing
shared `rehearsal.*` user configuration remains unchanged, including automatic-update
flags, so the migration guide asks users to review them. Project configuration, privacy
keys, baselines and database/Storage state are outside this identity migration.
The [extension migration steps](extension-guide.md#move-from-a-preview-through-0118) own the user flow.

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
- macOS Intel/Apple Silicon and Linux use the POSIX runtime. Windows desktop access uses
  the WSL 2 Linux-extension-host compatibility preview, with Linux Node and a project on
  the distribution's Linux filesystem, not `/mnt/c`. Native Windows inspection refuses
  before any CLI child launch; unsupported process-tree/ACL behavior is not guessed safe.
  WSL core PostgreSQL fixture proof is distinct from native Remote-WSL editor acceptance.
  WSL Supabase/Auth/Storage, browser-only VS Code, Codespaces, SSH, Dev Containers,
  mobile/BSD and other unlisted systems are not claimed as end-to-end supported.
  The [core platform policy](https://github.com/Ddupasquier/rehearsal-db/blob/main/COMPATIBILITY.md#operating-systems-and-execution-location)
  owns the shared host/runtime/architecture matrix.

The separate `Platform compatibility` workflow runs Node 24 on real Linux, macOS ARM,
macOS Intel and Windows runners without renaming existing protected checks. Its compiled
adapter smoke launches real Node children for version/JSON contracts from a path with
spaces and Unicode on POSIX. On actual native Windows it proves the prelaunch refusal
and absence of a child-execution canary. Targeted platform contracts and compiled
controller checks are not native VS Code API, WSL GUI, browser or database evidence.
The core's independent Windows WSL workflow owns real Linux-filesystem PostgreSQL proof.

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
- Related inventory actions share one wrapping action group so row gaps are retained
  at intermediate card widths. Baseline identifier backgrounds fit their content,
  bounded by the card width, rather than stretching into unused space.
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
- Configuration, image-cleanup and stale-stop reviews share a non-modal, escaped,
  read-only review webview. Details remain visible before explicit Apply; configuration
  saves do not cover the diff with a native modal. Destructive resource operations retain
  their concise final native confirmation and core-owned exact digest checks. Retention
  is bounded to 16 reviews, 2 MiB each and 8 MiB total; excess reviews fail closed rather
  than evicting an active review. Trust, workspace and canonical file identity are
  rechecked throughout approval and before saving. Diffs align unchanged suffixes so a
  single insertion does not mislabel all later settings as changes.
  After an approved edit, editor auto-save may publish only the exact reviewed source
  fingerprint through those guards. Success additionally requires a bounded byte-exact
  read from the original canonical regular file; a hidden editor document closing after
  save is not itself a failure. Changed bytes, file identity, trust or project state still
  fail closed, with no automatic retry or overwrite.
- Guided actions remain available from the keyboard. Read-only refreshes stay inside the
  adapter; approved operations open their exact public command in a project-scoped
  integrated terminal, except the explicitly reviewed VM shutdown described below.
- English is the only reviewed prototype language. User-facing strings must remain easy
  to extract before a public localization commitment.
- Development checkouts update through Git. Packaged GitHub prereleases support explicit
  manual VSIX installation or separately opted-in verified automatic installation. Core
  npm-package automatic updates have an independent user choice.

## Runtime boundary

### Visible VM shutdown

The development candidate reads `engine status --json` only when the installed core
advertises `containerEngineLifecycle: 1`. This configuration-independent evidence is
separate from project readiness, project runtime state and the selected Docker endpoint.
The persistent dashboard control and Command Palette entry remain discoverable when
configuration, capability or verified backend support is missing, with specific guidance.
An unreachable selected engine never establishes that a separately observed VM stopped.

`engine_lifecycle_contract.ts` owns the closed, bounded public status, impact review and
shutdown-result readers. `engine_lifecycle_view.ts` renders independent selected-engine
and Colima-profile states. Core owns backend qualification, exact workload/VM identities,
shared coordination and the digest-bound graceful shutdown. The editor never calls an
engine tool or selects a data-delete, force-stop or global context-switch operation.

VM shutdown is a narrow exception to terminal-based mutation dispatch: its explicit
impact review and final native confirmation authorize one bounded JSON command through
the existing process adapter. Manifest/executable identity, package version, workspace,
trust and known operation state are rechecked. A single owned in-flight request blocks
other terminal dispatch and is cancellable; transport timeout or cancellation after
dispatch produces uncertainty and fresh inspection. Only positive profile-stopped and
exact-VM-process-absent evidence establishes confirmed shutdown. A profile already
stopped without a prior process binding remains partial evidence. The editor parses no
terminal output, persists no CLI result and adds no periodic watcher or lifecycle service.
While configuration drafts are open, fixed engine-state messages patch only the engine
labels, associated guidance and native shutdown buttons. This preserves the form nodes,
focus and scroll while disabling conflicting requests. The message contains only closed
state/reason enums and an eligibility boolean; review requests contain one fixed type.

Genuine native-dialog acceptance uses the owned companion's normal startup activation,
without `--extensionTestsPath`: installed VS Code intentionally refuses prompt dialogs
in its extension-test mode. The same exact VSIX checks, external isolated profile,
normal-pressure guard and captured process-group cleanup remain. The launcher requires
both the bounded UI driver and a hash-bound passing result before normal completion;
unknown/failure retains evidence. Other historical file-only test modes are unchanged.

VM reviews explicitly use the optional Beside review column; other reviews default
to Active. This keeps the existing dashboard visible, including unbound configuration
drafts whose identity guard correctly refuses persisted restoration. Review navigation
uses a bounded review-owner return event keyed to the exact workspace. The owning panel reveals that dashboard in its existing column with focus, preserving its page
and existing persisted draft restoration; specialized caller return callbacks retain
priority. Back remains visible for ready/cancelled/failed/succeeded states and is
disabled during apply, with the same host-side pending guard. Hidden dashboards
continue to discard their DOM under the existing resource policy.

### Optional release advisories

`update_advisory.ts` owns a separate opt-in release check, never `inspectProject` or
the webview. Native consent names the fixed public npm/GitHub metadata endpoints and
ordinary connection disclosure. Opening-session checks are coalesced, at most daily
per opted-in workspace, with no polling/daemon. Explicit checks remain available.
Each request set has a five-second deadline and each response a 128 KiB limit; redirects,
cookies, authentication and project data are excluded. Stable installations do not
receive prerelease core recommendations; preview users may inspect the beta channel.
Compatibility floor and release freshness remain independent.

The dashboard header always identifies the loaded extension separately from core.
Only the existing consented check supplies its session-local, workspace-scoped newest
release evidence. A newer confirmed version displays installed → newest; unknown or
failed checks never imply currentness. Header-only messages update fixed text nodes,
not the document, so active progress, navigation, focus, scroll and form drafts survive.
The version badge remains visible in compact layouts and opens the existing update
review command; it neither fetches metadata itself nor installs an extension.

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
Manual extension advice opens a fixed GitHub release with reviewed VSIX/checksum assets,
never a package-supplied URL. Automatic installation requires the separate user opt-in
and artifact/coordination checks below. Offline/unsafe metadata stays unknown.

The update prompt is a non-modal webview with independent extension and CLI checkboxes,
initially off. Only an explicit Save preferences or eligible Update choice saves changed
flags to machine-scoped `rehearsal.automaticUpdates` user configuration. Repository and
workspace overrides are not consent. Configure Update Checks exposes the same controls
without requiring a new release. Closing, Later and Skip do not save checkbox drafts.
Existing metadata-check consent alone never grants installation authority.

Automatic extension updates use fixed official GitHub tag/asset URLs, bounded HTTPS
downloads and an allowlisted GitHub-to-release-assets redirect. SHA-256, bounded ZIP
contents, embedded publisher/name/version and supported engine ranges are verified before
VS Code's documented installExtension command receives the private local file. The
checksum is integrity evidence from the same trusted GitHub release, not independent
publisher authentication. A cross-window exclusive installation lock, fresh idle activity
and revocable user consent precede dispatch. No force reload is requested; the loaded
version badge remains truthful while VS Code may require a later restart. Interrupted,
unknown lock ownership fails closed instead of being stolen.

The CLI opt-in retains registry/npm provenance, exact manifest/lock identity, dependency
group and compatibility-series checks. It skips repeated install approval only while the
separate user opt-in remains current, adds --ignore-scripts/--no-audit/--no-fund, and refuses
dirty dependency documents or active/unknown terminal execution. Automatic installs have
project-scoped cross-window coordination and never fall back to an unobserved shell.
Queued idle deferrals resume on project evidence changes, not a runtime polling timer.
A bounded daily metadata scheduler runs only while either automatic option is enabled;
disabling both or disposing the host clears it, with no overlapping scheduler callbacks.
Metadata-only advisory opt-ins retain their project-opening cadence.
Dispatch is not completion: terminal exit and fresh inspection supply the actual outcome.
Neither update path runs migrations or database lifecycle commands.

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

Resource lists independently paginate the validated inventory, defaulting to five
cards with a shared 5/10/25 page-size control. Search, sorting and target/profile
filters apply before slicing; changed filters reset pages and refreshed inventories
clamp stale page indexes. Target summaries and retained baseline lists have separate
cached rows and independent page state, including the Data & auth baseline list.
Off-page cards are detached from the live document while
their bounded cached nodes retain form drafts, expanded details and eligible image
selections. Page state belongs only to the webview recovery state, not core settings.
Image-selection persistence uses the complete cached checkbox collection, not just
the mounted page. Bulk selection affects only visible current-page safe candidates;
selected off-page images remain explicit in the count and the existing 100-image
limit, exact preview and host/core revalidation remain unchanged. Paging requests no
new inventory, runs no command and cannot broaden resource ownership or deletion.

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
This inspection runtime is independent of an external `node` on `PATH` and of project
version-manager selectors. Foreground actions instead use the normal project terminal's
selected Node and package manager. The extension does not discover or install a second
Node runtime, source user shell initialization, alter version-manager aliases or override
a project selector. The [Node setup guide](extension-guide.md#node-setup-and-runtime-selection)
owns that user-facing distinction and recovery.
Manifest reads are bounded to 1 MiB through a regular-file handle. The executable's
canonical path must remain inside the canonical package root; a symlink cannot redirect
inspection to an unrelated program. Internal package-manager links remain supported.

A local-directory npm install can instead create a symlink whose canonical package root
is outside the containing repository. That specific refusal is `package_link_external`,
not a missing-package result or a diagnosis of every invalid manifest/bin. The dashboard
uses fixed recovery guidance: install a project-local package copy or reviewed packed
candidate, then refresh. For npm source-directory installs, `--install-links` requests a
copy instead of that external link. The canonical repository boundary is unchanged;
recovery does not require a database action or clearing editor state.

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

The closed activity-kind allowlist additionally recognizes core's `measure impact`
operation, including completed, failed and cancelled retained receipts. This is a
compatibility reader only: an active measurement still blocks conflicting editor
actions, and idle history does not make project inspection unavailable. The editor
does not invoke impact commands, parse aggregate measurements, add measurement UI or
equate an operation's completion with a successful rehearsal, application proof or
safe migration. Other unknown or argument-bearing operation kinds remain refused.
An older editor lacking this entry can reject activity/history produced by that core
capability; core and editor versions remain separate release boundaries.

Overview keeps current command activity, database liveness and recorded rehearsal/proof
outcomes separate. The Run workflow row uses the latest unambiguous core `run` receipt,
not a running database or an editor dispatch receipt. A passed CLI-proof label additionally
requires a completed primary `application-proof` stage in that completed run. A newer
failed/cancelled run does not borrow an older success; busy, unsafe or unavailable
inspection cannot promote retained history into current success. These labels explicitly
describe history: public receipts do not bind proof to current configuration, baseline or
candidate bytes. Activity & reports retains the exact timestamps and stage evidence.

CLI-proof configuration comes from validated `application.proofCommand`, independently
of HTTP readiness. Optional cleanup metadata does not erase validated application fields.
An explicit null readiness endpoint is a database-only configuration, not incomplete
application launch. Its next step is database verification/migration inspection; it does
not require a browser app or suggest configuring one. Missing legacy configuration stays
unknown rather than being guessed database-only or successfully proved. Readiness must
be explicitly null for that classification; malformed command/readiness metadata refuses
inspection rather than becoming a database-only default.

Core may additionally expose up to 20 `activity.recentFailures` entries, each bound by
operation ID to an existing failed recent receipt. This additive top-level field keeps
the exact existing progress and recent-receipt schemas unchanged for older clients.
`migration_failure.ts` validates the fixed versioned provider/SQLSTATE classification,
summary and remediation mapping; it does not parse SQL or provider output. Arbitrary
text, unknown fields, duplicates and diagnoses without a matching failed receipt are
refused. Activity & reports renders the escaped explanation after the normal refresh.
Only core's private, project-bound receipt stores it; the editor does not copy it to
Memento, parse terminal output, retry SQL, or infer rollback/cleanup from a failure.

An optional closed `diagnostic.source` identifies only the attempted migration input:
baseline/candidate kind, reviewed filename, exact SHA-256 and, when safe, a project-relative
path. It does not establish the actual SQL origin, and line/column remain null. Core
supplies no project-local link for baseline inputs; Supabase batch or otherwise
ambiguous attribution stays unknown.
`migration_failure_source.ts` validates that projection; the shared `migration_source.ts`
reader reads at most 2 MiB of an
exact project-local regular file, rejecting symlink redirects, identity drift, changed
bytes and invalid UTF-8. The Activity button sends only an operation ID, never a path.
The host resolves it against the current failed receipt and rechecks trust, workspace,
panel identity, file identity and both on-disk/document hashes before showing the file.
A dirty document or changed source refuses with fixed guidance; no SQL is executed and
no position is guessed. SQL text is shown only in the explicitly opened native editor,
never copied into webview HTML, diagnostics, exports or Memento.

Native Prisma review keeps the Core-owned migration-tool binding (schema 1, Prisma
7.10.1, PostgreSQL and exact lock/toolchain digests) on each target. Only that explicit
binding permits `<timestamp>_<ASCII slug>/migration.sql` identities; ordinary SQL targets
retain flat filename rules. Static source navigation compares the entire nested suffix
and retains the same ancestry, symlink, raw-byte and clean native-model checks. Baseline
formats 1 and 2 remain supported alongside format 3; format numbers do not grant runtime
or database safety authority.

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
allowlisted public command and previews user-triggered terminal actions with explicit
approval, adding stronger language for dependency writes and risky runtime changes.
Compatible automatic CLI updates use the independent saved consent and repeated guards
described above instead of another install prompt. Both routes use a workspace-scoped
integrated terminal. Activity cancellation closes only an owned terminal;
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

### Optional static Migration Insights

This optional addition targets extension 0.1.24/core 1.2.0; older releases lack it.
Manifest capability `migrationInsights: 1`, together with `migrationReview: 1`, enables
the public read-only `inspect insights --json` query in the trusted ready idle inspection.
`migration_insights.ts` owns the strict closed schema and exact plan/version binding.
The report's global and target candidate digests, count, ordered candidates, providers,
baseline generation IDs and every file hash must match the independently validated plan.
Fixed rule/severity/summary/suggestion, coverage, unknown-reason, limit and safety fields
are validated. Unknown schemas, SQL-bearing additions and arbitrary prose are refused.

The optional command alone uses an 8 MiB transport/parse bound. Analysis bounds remain
1,000 candidates, 10,000 total files, 10,000 entries per migration directory, 2 MiB/file, 16 MiB total
input and 5,000 findings. Invalid, oversized or unavailable optional results produce a
fixed unavailable hint without blocking otherwise-valid MVP actions. An actual package
version change or busy final activity retains the normal fail-closed snapshot behavior.
Capability absence or missing plan v1 launches no Insights command and exposes no links.

`migration_insights_view.ts` keeps warnings in collapsed existing migration rows, with
at most ten visible findings per file and an explicit omission/CLI-report notice.
Lexical-rule coverage is not SQL validity or safety; unsupported/malformed/bounded input
stays unknown. No findings are copied to editor storage or report exports. SQL bodies,
object identifiers, row values and raw provider output never enter finding markup.

The opaque source ID binds the complete normalized report and exact finding, without
accepting a path or position from a webview. The host uses the shared exact-input reader
and refuses trust, workspace, panel, snapshot, file, dirty-buffer or byte drift before
opening the file. It navigates only to a bounded actual UTF-16 lexical line/column in
that unchanged document. Static source observation never becomes
`owned_execution_input`; existing failure attribution and null positions are unchanged.
No execution engine, autofix, safety verdict, new gate or commercial restriction is added.

The common reader retains the exact UTF-8 raw text, including BOM/EOL bytes. Native
document comparison uses an explicit projection only: remove exactly one leading BOM
from the checked raw text and normalize its CRLF/bare-CR line endings to LF; normalize
document line endings to LF without stripping any document BOM. Both original raw disk
SHA/identity reads and the dirty-buffer guard remain mandatory. Additional BOM removal,
actual content changes or an out-of-range reported position refuse rather than guessing.
The CLI scanner already decodes away one leading BOM; the host does not subtract a
column again. Failure-input provenance and null error positions remain unchanged.
This follows the current [VS Code buffer builder](https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder.ts)
and [document mirror](https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/model/mirrorTextModel.ts)
source, not an observed native decoding guarantee for every encoding path. Model-backed
regressions do not replace separately pending native acceptance.

The developer-only native panel companion accepts the independent Lab's private
`migration-insights-native-fixture` handoff through
`scripts/native/verify-native-migration-failure.ts`. The existing launcher owns archive
verification, exact isolated installation, fresh normal-memory checks, the bounded
owned process group and profile teardown; historical pinned cancellation/comparison
scenarios are not relaxed. `native-insights-fixture.ts` validates the closed schema,
core artifact identity, whole-plan/Insights binding and bounded canonical base64
UTF-8 source copies. Unknown paths, duplicate files and changed hashes refuse.
The installed extension's actual production parser/panel/source handler is then
exercised by `native-insights-test.cjs`, including BOM/EOL/UTF-16 source positions,
dirty-buffer and changed-byte refusal, incomplete/unavailable analysis and no
terminal creation. Only synthetic owned copies are edited and restored. The
handoff contains SQL, stays private and is not a public report or support export.
This is a native host/source companion, not full canonical activation, new CLI
execution, rendered layout, webview click, actual keyboard or assistive-technology
evidence. Those observations remain separately required where applicable.

The loopback-only workspace preview accepts an explicit developer-owned
`--insights-fixture` path for `/migration-insights` and its unavailable variant.
The existing closed handoff parser and bounded no-follow regular-file reader feed
only plan/report metadata to the production renderer. No route serves source bytes
or the handoff. A labeled preview-only bridge observes actual controller source-button
dispatch without opening files, executing commands or impersonating the native host.
Browser rendering, focus, disclosure and keyboard observations therefore remain
distinct from the native source companion and full canonical activation.

Source navigation has one shared in-flight slot per workspace-panel owner, covering
both failure-input and static-finding opening across its projects. Repeated clicks while
it is occupied are ignored, not queued or retried. The slot releases in `finally` on
success/refusal and is cleared on disposal; existing disposed/current-context guards
still prevent stale continuation. Each accepted operation retains its two sequential
bounded raw-file checks rather than multiplying work for concurrent messages.

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
New terminals wait at most five seconds for shell integration and dispatch immediately
when it arrives. The current integration is re-read after final asynchronous
authorization, avoiding a needless compatibility fallback if it arrived meanwhile.
Diagnostics identify integration versus compatibility dispatch and distinguish running
owned/manual commands, fallback/unknown completion, and a pending completion refresh.
No command arguments, environment values or terminal contents are logged for this check.
Each extension-host session reuses its own project terminal only after confirmed shell
completion and an exact local workspace-directory check. A live owned action, manual
foreground shell execution, unknown exit, or pending completion refresh blocks another
dispatch and focuses the terminal with recovery guidance. Core activity reporting idle
does not establish shell completion. Closed/removed terminals lose ownership immediately;
an altered or unreported directory requires a new terminal rather than sending a command
to an uncertain project. Launch reservations precede asynchronous receipt writes and
directory/trust/ownership checks repeat before dispatch. Cancellation approval is bound
to the captured activity ID and exact execution, not just a reusable terminal object, so
an older dialog cannot close a newer command. Previously opened or user-created terminals
are never adopted, and disposal does not kill retained user processes.
Legacy unknown-exit receipts retain their unverified outcome; their old terminal-close
timestamp is not completion evidence. While cleanup observation is pending, guard
rechecks abort the owned read on trust/workspace loss and prevent further CLI reads.

An explicitly editor-started terminal action also receives an activity-only monitor:
one serial public `activity --json` read every two seconds for at most five minutes.
It gives startup at most 30 seconds to expose a busy operation; absence or timeout
does not mean success. Busy/stale views discard potentially inconsistent project
details and render only strict public activity. Busy-to-idle triggers one full
actual refresh. Terminal end, removal, trust loss, disposal and deadline abort the
owned read and timers. If an observed busy session reaches the five-minute limit,
one normal read-only inspection reconciles actual state. The monitoring deadline
alone never becomes a project-check failure or a successful completion. This does
not extend the polling budget; real inspection failures remain actionable errors.
No daemon or idle workspace polling exists; later samples in long sessions use
explicit Refresh or the exact owned terminal-completion event. Cancellation completion uses
its separate 30-second observer only after active monitoring is disposed.
A newer validated active/attention sample retires an older full inspection;
abandoned bootstrap/read results cannot overwrite it or clear a newer refresh's
loading state. Unknown or malformed observations do not authorize stale project facts.

An active `open` session is distinct from a background mutation. Only busy public
activity with a running `interactive-session` phase identifies a ready hands-on
sandbox; missing phase evidence remains an open session of unknown readiness.
Startup, interactive use and cleanup have separate dashboard and Projects labels.
Readiness, baseline and migration inspection are explicitly on hold, not described
as a paused application. The active Overview offers an explicit loopback-address
input using the existing browser message and endpoint validator. Public activity
contains no application address: the input starts blank unless the user saved a
valid custom address; it is a browser preference, not current configuration evidence.
No stale configuration, guessed port,
terminal-output parsing, extra locked project query or health claim fills that gap.
Opening an address starts no CLI command and changes no project configuration.
The host rechecks trust and workspace presence before opening the browser.
Semantic session-state changes patch fixed text nodes alongside progress, without
replacing the address input, navigation, focus or document on each sample.

An active operation gets one full safety render to remove potentially stale project
details. Further samples of that same operation patch the bounded, escaped progress
region and fixed session-state text in place; elapsed-time ticks do not replace the dashboard document. Navigation,
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
documents; and asks for explicit Apply in its non-modal review tab before saving. It does not parse or
rewrite arbitrary JavaScript expressions. Core remains the authority that validates the
complete file before any later operation.
Known numeric fields share one editor-owned bounds contract for parsing, visible range
help and native form constraints. Invalid input is refused before review with fixed
field guidance; values and raw provider errors are never echoed. Complete core validation
still runs before saving. Configuration reviews may show caller-owned, bounded recovery
guidance for known local refusals; unknown failures retain the generic alert. A stale
review explicitly preserves saved and unsaved edits, disables Apply, focuses Close and
asks the user to refresh and review the current source. Other review callers do not
inherit configuration-error details.
The simple form proposes only semantic changes from its initial displayed values; untouched
defaults do not become new configuration literals. Restoring form values updates the draft
guard after the browser reset, while edits in other forms remain protected.
Structured review also checks public activity before review and immediately before save.
Busy, stale, and invalid states refuse the edit. Unsaved forms survive ordinary
inspection updates; users review or explicitly discard them before the view refreshes.
Switching to a review tab retains bounded drafts and opener focus in the existing webview
state, not global storage. Restoration requires an unchanged primary-source fingerprint
and known form controls; password/file/hidden fields and independently sourced secondary
configuration forms are excluded. Saving expires the old draft identity. Unsafe project
states still take precedence over drafts.
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

The current `LICENSE` grants indefinite no-charge Starter use for personal and commercial
development of all features included in versions distributed with it. No account, card,
trial, activation or feature-paywall enforcement exists. Future separately identified
optional Pro additions cannot restrict already-granted versions; no entitlement code
belongs in core or its safety operations. Existing accepted-order rights and support are
preserved. Historical VSIX files keep their bundled terms and immutable checksums; the
new grant travels with a separately reviewed Starter release, not a rebuilt old artifact.

There is no telemetry or hosted license service. Public GitHub prereleases establish
technical distribution only. Future Pro terms, entitlement design, paid launch, checkout,
pricing and refunds need their own approval. Free Marketplace distribution still requires
its reviewed artifact and verified listing; publisher creation alone is not publication. Those future paid
decisions are not prerequisites for the approved Starter grant or free CLI use.

### Drizzle journal review candidate

The 0.1.27 candidate consumes only public Core `drizzleMigrations: 1` alongside
existing SQL and Prisma contracts. `native_migration_contract.ts` owns the exact
Kit 0.31.11 / ORM 0.45.4 / pg 8.23.1/default-ledger binding and journal
`{kind, idx, when, tag}` identities; journal milliseconds are never forged into
14-digit filename versions. Format 4 requires this binding and an explicit native
cutoff. Core proves the immutable semantic prefix; the editor independently binds
its baseline history digest to the review target. Producer raw journal/toolchain
bytes may differ after a valid append or across platforms; current candidate
approval still binds the actual full journal and installed toolchain.

`migration_source_review.ts` owns opaque current-review row IDs and the closed
reviewed-source schema 2. The host selects source through `inspect source` using
only target, native identity, raw SQL hash and complete review digest. It never
passes a caller path. Current capability/version, trusted idle workspace/snapshot,
confined no-symlink stable raw file, exact hash and clean native document checks
precede navigation. File-top reviewed input is distinct from attempted SQL or
failure attribution. Static Insights retains its lexical-only safety limitation
and exact native identity correlation. No SDK/private Core imports, project
execution, source regeneration or lifecycle ownership moves into the editor.
SQL/Prisma formats 1/2/3 retain their existing validation. Exact packaged native
Drizzle/SDK/Lab execution remains unverified until separately observed.

### Knex reviewed-code candidate

The isolated Knex candidate consumes public `knexMigrations: 1` and format 5
without changing SQL, Prisma or Drizzle identities. `knex_migration_contract.ts`
owns the pinned Knex 3.3.0 / pg 8.23.1/default-ledger binding, canonical bounded
code-file receipts and flat `.cjs` filename identities. The editor compares the
public baseline history digest and exact reviewed-code prefix, including unchanged
producer helper receipts and isolation policy; it does not equate appended whole
bundle or platform toolchain hashes. Historical applied-file checksums remain
explicitly unavailable. Ledger times never become migration identity or date filters.

Source schema 2 uses the existing current-review/target/native-identity/raw-hash
binding and Core `inspect source` command. Only this explicit Knex path admits
8 MiB `.cjs` files; existing SQL limits and trust, clean-document, confined-path
and stable raw-read checks remain. The editor reads JavaScript as text and never
loads its SDK or executes project JavaScript. SQL Insights does not analyze Knex
JavaScript. Core doctor owns worker readiness; parsing a binding is not execution
qualification. Genuine SDK/isolated-worker/packaged-native acceptance is separate
and remains unverified for this candidate.
