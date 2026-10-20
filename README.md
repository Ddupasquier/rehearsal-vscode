<p align="center">
  <img src="media/rehearsal-readme.png" width="96" height="96" alt="Rehearsal logo" />
</p>

<h1 align="center">Rehearsal for VS Code</h1>

<p align="center"><strong>Understand whether a database change is ready—without memorizing the CLI.</strong></p>

This free Starter preview is a project-aware client for the Rehearsal package
installed in each workspace. Its native project navigator opens a Rehearsal Workspace with
persistent navigation for Overview, Project setup, Migrations, Environments, Data & auth,
Configuration, and Activity & reports.

The repository and [reviewed VSIX previews](https://github.com/Ddupasquier/rehearsal-vscode/releases)
are public on GitHub. Use the [official installation guide](https://ddupasquier.github.io/rehearsal-db/vscode/)
for current distribution channels. Starter is free; preview status describes stability,
not a trial or a paid launch.

The canonical extension identity from **0.1.19** is
**`rehearsal-db.rehearsal-db`**: publisher `rehearsal-db`, package name
`rehearsal-db`, and Marketplace display name **Rehearsal DB**. The workbench and its
commands still use the **Rehearsal** brand. Check the complete publisher and ID rather
than installing an unrelated extension with a similar name. Marketplace availability
is established by the official installation guide, not by a registered publisher alone.

Already using a GitHub preview through 0.1.18? Follow the
[one-time identity migration](#move-from-a-preview-through-0118) before installing the
canonical package. This is an explicit manual change, not an automatic rename.

## Install and open your project

Use desktop VS Code 1.101 or newer on macOS or Linux, with Node.js 22, 24, or 26.
No source checkout, extension build, or Test Lab installation is needed.
For Windows desktop use, open the project with **Remote - WSL** in a WSL 2 Linux
distribution and install Rehearsal into that Linux extension host. Keep project files,
Linux Node and the local Docker engine on the Linux side, not under `/mnt/c`. Follow
the [Windows setup guide](https://ddupasquier.github.io/rehearsal-db/getting-started/#windows-use-a-wsl-2-linux-workspace).
Since 0.1.21, native Windows inspection and foreground actions refuse before any CLI child
process is launched; its guidance is not a claim that native Windows database runtime works.
WSL remains a compatibility preview: Linux/WSL core fixture proof does not certify a
native Remote-WSL editor walkthrough or Supabase/Auth/Storage in that environment.
Optional [OS-specific setup helpers](https://github.com/Ddupasquier/rehearsal-db/blob/main/installers/README.md)
provide separate Windows/WSL, macOS and Linux entry points. They check prerequisites by
default; installation requires an explicit option and never starts a database.

1. Open your application's folder in VS Code—the one containing `package.json` and
   your migrations. If it does not already use Rehearsal, run this in that project's terminal:

   ```bash
   npm install --save-dev @rehearsal-db/core
   ```

   This release targets core **1.0.2**; `0.1.0-rc.4` remains the minimum core contract.
   The new persistent migration diagnoses require core 1.0.2; an older compatible
   package cannot supply that evidence.
   Confirm the target appears on npm before selecting it. Follow [Getting started](https://ddupasquier.github.io/rehearsal-db/getting-started/)
   for safe setup and baseline inputs.

2. Open the [GitHub prereleases](https://github.com/Ddupasquier/rehearsal-vscode/releases).
   Choose the **0.1.22** release and download
   `rehearsal-db-0.1.22.vsix` and `SHA256SUMS`. If that version is absent, publication
   has not completed; a source version is not a downloadable release.
   Compare its SHA-256 with the
   checksum from that same release: use `shasum -a 256 /path/to/rehearsal-db-0.1.22.vsix`
   on macOS or `sha256sum /path/to/rehearsal-db-0.1.22.vsix` on Linux. Stop if they differ.
3. Open **Extensions → … → Install from VSIX…** and choose that verified file.
   Reload the extension host if VS Code asks.
4. Review Workspace Trust. Open the Command Palette and choose
   **Rehearsal: Open Dashboard**, or use the dashboard button in the Rehearsal sidebar.
5. Follow **Next best step**. Review detected facts and the active configuration;
   operational actions still show their exact CLI command and required confirmations.

If VS Code's `code` command is available, step 3 can instead use:

```bash
code --install-extension /absolute/path/to/rehearsal-db-0.1.22.vsix --force
```

### Move from a preview through 0.1.18

Earlier GitHub previews use **`rehearsal-db.rehearsal`**, a different VS Code identity.
Public 0.1.18 downloads and checksums remain unchanged. Its updater looks for the old
`rehearsal-<version>.vsix` name, so it does not silently install the new identity from
`rehearsal-db-<version>.vsix`. Complete this one-time migration yourself:

1. Finish every Rehearsal command in your open project windows. For an open sandbox
   app, press **Ctrl+C** once in its owning terminal and wait for the normal shell prompt
   and configured lifecycle result. Save your work before proceeding.
2. Download and verify the reviewed canonical VSIX and checksum as described above.
3. In VS Code's Extensions view, search **`@id:rehearsal-db.rehearsal`**. Open that
   legacy extension's gear menu and choose **Uninstall**. Do not choose a database
   discard/reset action or **Reset Saved Editor State** as part of migration.
4. Save any remaining files, then run **Developer: Reload Window**. Ensure the legacy
   extension is no longer installed in each profile where you intend to use the new one.
5. Use **Install from VSIX…** to install the verified canonical package. Check its full
   ID is **`rehearsal-db.rehearsal-db`**, then reload if VS Code asks. Reopen the dashboard
   and review your update preferences.

The canonical extension refuses activation while VS Code still reports the legacy ID.
An installed extension that is not currently active is not necessarily disabled.
Uninstalling and reloading is the supported path above; if both IDs are still reported,
resolve the old installation before retrying. Rehearsal never silently disables or
uninstalls another extension or interrupts an active session for this migration.

Project configuration, keys, baseline files and database/Storage data are not migrated,
reset or deleted by this identity change. Shared VS Code user settings, including
`rehearsal.automaticUpdates`, remain as you set them; review or turn them off before
migration if desired. Private per-extension view preferences, activity history and
metadata-check consent are not copied from the legacy extension. Re-select view
preferences and review consent in the new installation. For rollback, first finish work,
uninstall the canonical extension and reload before installing your retained, verified
legacy VSIX. Never run both identities together.

### Keep the canonical installation current

To update manually, download and verify the next reviewed VSIX and repeat step 3.
Or opt in to **Keep this extension up to date** in the Rehearsal update prompt.
Rehearsal downloads the official release, verifies its checksum, package identity and
compatibility, then hands it to VS Code's installer. It never forces a reload.
Canonical updates accept only `rehearsal-db-<version>.vsix` with embedded identity
`rehearsal-db.rehearsal-db`; they cannot silently switch back to a legacy package.
Keep the previous reviewed file for rollback.
An ordinary core-package update is different: the dashboard detects it automatically,
without reloading the VS Code window. [Support](SUPPORT.md) explains how to report problems.

Use **Check for updates** in the dashboard or **Rehearsal: Check for Updates** in the
Command Palette for an optional release check. The first trusted opening offers informed
opt-in: npm/GitHub see ordinary connection information, but receive no project data or
installed versions. Metadata-only daily checks run at project opening. Automatic-update
opt-ins additionally check daily while the window remains open. You can
defer or skip a release, or disable checks with **Rehearsal: Configure Update Checks**.
Checks alone never authorize installation. The update prompt has independent, initially
off extension and CLI auto-update checkboxes. Choose **Save preferences** to remember
them, or edit your user settings:

```json
"rehearsal.automaticUpdates": { "extension": true, "cli": false }
```

Enable `cli` separately for compatible registry-backed npm packages in trusted idle
projects. CLI updates preserve the dependency group, pin the exact checked version and
update the lockfile with install scripts disabled. Dirty dependency files, busy terminals,
unknown completion and another window's update defer installation. No migration, database
lifecycle action or forced editor reload is requested. Turning either flag off revokes
future automatic work for that component. Project settings cannot authorize installation.
Compatible does not mean newest; breaking CLI upgrades, local/candidate builds and
unverified provenance require manual review. Offline or failed verification preserves the
existing installation and provides recovery guidance rather than claiming success.

The dashboard's top-right **Extension** badge always shows the loaded extension
version, separately from **Core**. A confirmed update shows installed → newest;
select the badge to check or review updates. Offline or unchecked availability is
unknown—not “up to date.” Release results update in place without refreshing the view.

## What the workbench shows

Overview distinguishes a command that is currently running from the database's
running/stopped state and the last recorded rehearsal result. A completed run can leave
the database running without another command being active. Recorded CLI proof requires
the completed primary proof stage; it is historical evidence, not a new check of the
current configuration or migrations. Database-only projects offer **Verify database**
and migration review without asking you to configure a browser application. Optional
application launch remains available when the project actually configures it.

With core 1.0.2, **Activity & reports** retains bounded migration failure explanations
and safe next steps after refresh. Recognized provider evidence can distinguish a syntax
error from, for example, existing rows violating a new constraint. Unsupported or
ambiguous evidence stays unknown. SQL, row values, connection strings and raw provider
details are not included in these diagnostics. When core proves the exact attempted
project-local migration input, **Open exact migration input** opens only the unchanged,
reviewed file in VS Code. Changed or dirty files require a fresh review; an attempted
input is not a proven SQL origin and no line or column is guessed. Rehearsal never
rewrites or retries the migration automatically. Follow the main
[failure-and-fix tutorial](https://ddupasquier.github.io/rehearsal-db/tutorial/) to review
a fresh candidate, observe a safe failure, correct it and verify the result.

If the tutorial CLI works but the dashboard says **Project package link needs repair**,
npm linked its package outside this repository. Keep the same project and baseline.
Install a project-local copy:

```bash
npm install --ignore-scripts --no-save --install-links /absolute/path/to/rehearsal-db
```

Alternatively, install a reviewed tarball/published package, then choose **Refresh**.
A local copy does not track later source edits. Do not reset data,
clear editor state or relax the repository boundary to repair a package link.

The Environments page consumes Rehearsal core's versioned resource inventory. It shows
only the current project's ownership-proven containers, running/stopped state, nullable
live CPU and memory totals, restart policy, retention intent, Docker totals, and
measurable Colima disk capacity. The
extension never queries Docker directly and never starts the shared engine. Cleanup stays
behind core's exact preview and confirmation.
Core releases advertising `resourceManager: 1` also provide the Local Resources manager:
four browsable sections for environments, persistent data volumes, shared images, and
other projects' read-only containers. Search/filter/sort controls include largest-first
disk review. Friendly names and protection policies are saved through reviewed config
diffs; technical ownership IDs stay unchanged. Selected image cleanup shows exact IDs,
tags, and a size estimate, revalidates through core, and never selects database volumes.
Each resource list starts with five cards and has its own Previous/Next controls;
choose 5, 10 or 25 rows per list. Target summaries and retained baseline versions
use the same bounded paging. Filters and sorting apply to the entire inventory,
not just the current page. Paging preserves drafts and selections. Bulk selection
selects only safe candidates on the current page; selected images on other pages
remain counted and can be cleared before the exact cleanup review.
Volume deletion is available only through the owning environment's reviewed discard.
**Inspect environment** also shows optional, recorded runtime provenance: restore-writer
version, baseline generation and data checksum, candidate migration digest, and configured
loopback ports. The inspecting core version is separate from the version that restored
the runtime. Older receipts may not record it. These facts are not fresh verification,
and configured ports do not prove that a service is listening. Use **Verify** for fresh
runtime evidence.
Presence, receipt compatibility and long-running review have separate labels and filters.
A created environment with missing verification is not described as never created.
**Incompatible** refers only to recorded format/provider metadata—not a guess based on
version differences. **Long-running review** uses age, not user inactivity. Configured
sandboxes preserve data on stop/start, including automatic workload stop. Approved
run/reset can replace data and volumes; reviewed discard removes volumes.
Each destination presents one focused job instead of one long diagnostic report. The
workspace includes readiness, the active configuration, baseline metadata, candidate
migrations, structured local-runtime state, current Rehearsal activity, and local
application details. The Environment Workbench adds migration search/sort/review,
target and view-profile selection, editable loopback application addresses, retained
baseline versions, provider-neutral authentication review, aggregate environment
comparison, redacted report export, and a bounded project-local activity history.
Migration checkmarks record review, not approval: only the first 1,000 checked IDs
are remembered after refresh. All migrations remain in the complete execution set.
Project setup presents a smart Project Profile:
**Detected** facts, evidence-backed **Suggested** values with confidence, and
security-sensitive **Your decision** choices that Rehearsal refuses to guess.

It does not implement database behavior, inspect private rows, read credentials, or
contact hosted databases. Rehearsal core remains the only migration and safety engine.
Passive inspection stays read-only. User-triggered terminal actions preview their exact
allowlisted public CLI command before opening an owned integrated terminal. Compatible
automatic CLI updates instead require the separate saved opt-in and repeated checks above;
migration execution, runtime changes, and cleanup retain explicit editor or core confirmation. A running
editor-started action can be cancelled from Activity without signaling an unrelated operation.

The structured configuration editor accepts custom local URLs, application/proof commands,
lifecycle choices, and baseline retention. It validates bounded values, shows an exact diff,
rechecks the source for concurrent edits, and writes only after **Apply changes** in a
readable review tab. The complete diff stays visible without a covering dialog; Cancel
makes no changes, and a saved state offers **Return to project**. Image cleanup and
long-running environment review also show their complete details before the existing
final destructive confirmation.
Complex expression-based fields fail closed and remain available through **Open configuration**.
Finish or dismiss a configuration review before starting another. If the source changes
while saving, Rehearsal asks you to review the current file instead of claiming success.

Core releases advertising configuration review also expose the validated resource policies
and named project profiles. A profile selects the targets shown and an optional local
browser address; selecting it never changes the database, skips required migrations, or
creates another runtime. Saved profiles are views of configured targets, not historical
database copies. Per-environment actions show their exact target before use.
Long-running environment review uses observable container start/stop times, not proof of
user inactivity. Scheduled policy choices request a later review; they do not install a
background cleanup daemon.

Activity shows bounded, core-recorded stages and recent outcomes when available. Missing
or unsafe evidence is shown as unavailable, not successful. Provider consent, screen-reader
acceptance, and application-specific security checks remain separate from these receipts.
Live progress updates in place rather than reloading the dashboard, preserving navigation,
focus, scroll position and expanded evidence while an operation runs.
Live monitoring is bounded to five minutes. A sandbox can stay open longer: when that
limit is reached, Rehearsal checks its actual state once instead of treating the time
limit as a failed project check. The application is not stopped or reset.
During a hands-on session, Overview distinguishes **Opening sandbox**, **Sandbox
running** and **Closing sandbox** using core's public phase evidence. Missing phase
evidence says **Sandbox session open**, not ready. Project inspection is on hold
until the session closes; the application itself is not paused. Use Overview's
local-address field and **Open application** to visit the URL shown by the owning
terminal. A remembered address is labelled as user-entered, not freshly verified;
no port is guessed. Opening the browser does not run another command or reset data.
If VS Code cannot confirm a terminal's exit, its activity stays **Unverified**, even
after reloading. A different command in that terminal cannot mark Rehearsal complete.
Commands reuse the same Rehearsal terminal for each project after its previous command
has a confirmed exit. A running sandbox or manually entered foreground command is never
interrupted to make room for another action. If you close the terminal, change its working
directory, or reopen the project, Rehearsal creates a fresh project-scoped terminal.
Without shell integration or a confirmed exit, finish the command and close that terminal
before retrying; an idle database lock alone does not prove the terminal is ready.
New terminals allow up to five seconds for shell integration, proceeding immediately
when it arrives. Diagnostics identify compatibility-mode dispatch and the specific
reason reuse is blocked; a finishing project check is not reported as an unknown exit.

Markdown and JSON exports retain aggregate counts where supplied. Detailed lists are
limited to the first **1,000 readiness checks**, **32 runtime targets**, and **1,000 baseline
generations**; an omission notice reports any additional entries. A bounded detail list
is not a claim that the omitted checks passed or that additional environments were tested.
Export asks you to choose a local file. If project trust, the open dashboard or inspected
state changes while that dialog is open, refresh and export again. No report is uploaded.

Projects on an older incompatible package get an **Update Rehearsal** button instead of a
cryptic timeout. The extension detects npm, pnpm, Yarn, or Bun, shows the exact update
command and affected project files, and runs it only after approval. When the terminal
finishes, the project workspace refreshes automatically where shell integration permits.
Updates made in another terminal are detected from the project manifest, lockfile, and
installed package metadata, then reflected automatically without reloading the VS Code
window.

When a workspace has not installed a discovery-capable Rehearsal release, the extension
uses a deliberately small bootstrap scan through VS Code's workspace APIs. It reads only
`package.json`, lockfile names, known config filenames, and conventional migration paths;
it does not execute project code. Once core advertises the versioned Project Profile
contract, the extension uses `rehearsal discover --json` and stops duplicating broader
discovery rules.

## Contributing and local development

These steps are for developing the extension, not installing it into your application.
Clone this repository first. The F5 launch configuration expects a sibling
`rehearsal-test-lab` checkout; its maintained runbook owns fixture preparation and
resource guards. Ordinary extension users do not need that repository.

```bash
npm install
npm run check
code .
```

The maintained check also initializes the compiled webview controller in an isolated
DOM double. This catches packaging/serialization errors; it is not visual or
screen-reader acceptance.

Press `F5` and choose **Run Rehearsal Extension**. The development host opens Rehearsal
Test Lab and its dashboard opens automatically after the trusted single-folder project is
inspected. Reopen it at any time with the dashboard button in the Projects view title or
the explicit **Open Rehearsal dashboard** row at the top of that view. Disable
`rehearsal.openDashboardAutomatically` when you prefer manual opening. Multi-root
workspaces stay explicit so the extension never guesses which project you intended.

Use the workspace navigation to move among the seven focused destinations. The primary
card always shows the next useful action. Operational buttons preserve the exact candidate
digest and open the command in a project-scoped terminal.

For fast visual review without launching a second VS Code window, run:

```bash
npm run preview
```

Open `http://127.0.0.1:4178`. The preview is loopback-only and includes safe fixture
states at `/loading`, `/outdated`, `/missing`, `/not-ready`, `/timeout`, `/auth`,
`/progress`, `/progress-unavailable`, `/sandbox`, and `/sandbox-starting`.
Add `?theme=light`, `?theme=dark-modern`,
`?theme=contrast` or `?theme=contrast-light` to inspect explicit theme fixtures.
Browsing controls work with sample data;
`/progress?page=activity&live=1` adds a bounded six-update UI fixture to check that
live progress preserves the document, evidence disclosures, focus and scrolling.
`/sandbox-starting?live=1` exercises opening → interactive → cleanup text changes
with the same address input preserved; it is synthetic UI evidence, not a live app.
resource review buttons explain their VS Code flow without applying anything. This
developer surface never runs Rehearsal commands or touches a project.

To try the packaged extension instead:

```bash
npm run verify:vsix
npm run package:vsix -- --out rehearsal.vsix
code --install-extension rehearsal.vsix --force
```

`verify:vsix` builds the production archive, checks that development-only files are absent,
installs it under isolated temporary VS Code user-data and extension directories, confirms
the exact manifest identity and version, and removes its temporary files. The
second command creates a local handoff artifact only when you actually need one.

The workspace repository must install `@rehearsal-db/core`. A nested project may use the
repository's normal hoisted dependency, but resolution never crosses the Git repository
boundary or falls back to a global package or private source checkout.

## Licensing and planned editions

The approved direction is a complete free MIT CLI, a useful free **VS Code Starter**,
and optional paid **Pro** editor workflows. Starter keeps basic setup, migration-plan
review, runtime controls, safety and recovery; Pro adds advanced visual productivity.
See the [edition boundary and launch gates](docs/commercial-readiness.md).

Versions distributed with the [Starter license](LICENSE) include all their editor
features indefinitely at no charge for personal or commercial development work. No
account, payment card, purchase, trial period or license activation is required. This
includes the existing advanced review, configuration, comparison and reporting tools;
they are not being removed or put behind a paywall.

Future optional Pro features must be separately identified and cannot retroactively
restrict a version already granted under the Starter license. No Pro entitlement system,
billing flow or paid-feature gate is implemented. Pro terms, pricing and paid publication
remain separate decisions. Rehearsal core stays MIT-licensed and fully usable
without the extension. Existing accepted-order rights and support remain in effect.

Historical VSIX files retain their bundled terms; this source change does not replace
their bytes or checksums. Install a reviewed release carrying the Starter license to use
that grant. Technical preview status describes stability, not a timed trial.

GitHub VSIX installations update automatically only after the separate opt-in above. Every delivery must identify the extension
version, compatible core version, and SHA-256. Install a replacement with:

```bash
code --install-extension /absolute/path/to/rehearsal-db-0.1.22.vsix --force
```

Read the bundled [license](LICENSE), [privacy statement](PRIVACY.md), and
[support policy](SUPPORT.md) before use. The extension also exposes each document
through the Command Palette. It includes no telemetry, advertising, hosted database access,
or automatic license activation.

## Product boundary

- Desktop VS Code 1.101 or newer on macOS and Linux; Windows desktop uses the WSL 2
  Linux extension-host compatibility preview described above. Native Windows inspection
  and foreground dispatch have been deliberately refused since 0.1.21 rather than claiming unsafe process cleanup works.
- SSH, Dev Containers, Codespaces, browser-only VS Code, mobile systems and other
  unlisted environments have no end-to-end support claim. A Node/controller CI pass is
  not a native editor, database, provider, accessibility or every-architecture acceptance.
- Node.js 22, 24, or 26 in the extension host.
- Native Tree View navigation plus a theme-aware project workbench with nonce-restricted
  in-panel navigation; no telemetry, billing, or hosted license service.
- Read-only inspection through versioned Rehearsal JSON results; operational actions remain
  delegated to fixed public CLI commands.
- Explainable project discovery with detected, suggested, and human-decision categories;
  configuration edits are limited to known literals and require an exact diff plus explicit
  approval; every later operation still passes core validation and confirmation.
- Migration review supports text, target, status, and timestamp filtering/sorting; its
  checklist never reorders or weakens the exact candidate digest.
- Retained baseline versions expose aggregate metadata only; row values stay private.
- Harmless view preferences and at most 20 bounded editor-action receipts stay in local
  workspace storage. Credentials and policy approvals are never stored there.
- Guided setup, exact-plan review, rehearsal, migrate, sandbox open/start/verify/reset/
  stop/discard, identity connection, cleanup preview, support, install, and update actions.
- Exact update guidance for incompatible project packages. Passive inspection stays
  network-free; daily release checks and automatic installation require their separate
  user consent. CLI dependency changes require explicit approval or the independent
  compatible-update opt-in described above.
- Structured activity and runtime state; human-formatted CLI output is never parsed.
- Refresh cancellation stops only the inspection process owned by the extension.
- Every refresh announces a cancellable loading state in the sidebar and dashboard. A
  timeout preserves already-proven state and offers retry, workspace timeout settings,
  Doctor, diagnostics, and support instead of unexplained unavailable values.
- Untrusted workspaces fail closed and run no process.
- Multiple workspace folders are refreshed independently with at most two simultaneous
  inspections.
- Concise Tree View labels are exposed to screen readers while longer diagnostic detail
  remains available in tooltips.
- **Rehearsal: Reset Saved Editor State** clears only local view preferences and bounded
  action receipts; it does not alter project files or database resources.

Read [the architecture decisions](docs/architecture.md), [security model](SECURITY.md),
and [CLI audit](docs/cli-contract-report.md) before extending the prototype.
