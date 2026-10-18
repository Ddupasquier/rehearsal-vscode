<p align="center">
  <img src="media/rehearsal-readme.png" width="96" height="96" alt="Rehearsal logo" />
</p>

<h1 align="center">Rehearsal for VS Code</h1>

<p align="center"><strong>Understand whether a database change is ready—without memorizing the CLI.</strong></p>

This commercial preview is a project-aware client for the Rehearsal package
installed in each workspace. Its native project navigator opens a Rehearsal Workspace with
persistent navigation for Overview, Project setup, Migrations, Environments, Data & auth,
Configuration, and Activity & reports.

The repository and [reviewed VSIX prereleases](https://github.com/Ddupasquier/rehearsal-vscode/releases)
are public on GitHub. This is not a Marketplace listing or an announcement of a paid
launch; those remain separate release decisions.

## Install and open your project

Use desktop VS Code 1.101 or newer on macOS or Linux, with Node.js 22, 24, or 26.
No source checkout, extension build, or Test Lab installation is needed.

1. Open your application's folder in VS Code—the one containing `package.json` and
   your migrations. If it does not already use Rehearsal, run this in that project's terminal:

   ```bash
   npm install --save-dev @rehearsal-db/core
   ```

   Core `0.1.0-rc.4` or newer is required. Follow [Getting started](https://ddupasquier.github.io/rehearsal-db/getting-started/)
   for safe setup and baseline inputs.

2. Open the [GitHub prereleases](https://github.com/Ddupasquier/rehearsal-vscode/releases).
   Download the chosen release's `.vsix` and `SHA256SUMS`. Compare its SHA-256 with the
   checksum from that same release: use `shasum -a 256 /path/to/rehearsal.vsix` on macOS
   or `sha256sum /path/to/rehearsal.vsix` on Linux. Stop if they differ.
3. Open **Extensions → … → Install from VSIX…** and choose that verified file.
   Reload the extension host if VS Code asks.
4. Review Workspace Trust. Open the Command Palette and choose
   **Rehearsal: Open Dashboard**, or use the dashboard button in the Rehearsal sidebar.
5. Follow **Next best step**. Review detected facts and the active configuration;
   operational actions still show their exact CLI command and required confirmations.

If VS Code's `code` command is available, step 3 can instead use:

```bash
code --install-extension /absolute/path/to/rehearsal.vsix --force
```

To update the extension, download and verify the next reviewed VSIX and repeat step 3.
GitHub VSIX installations do not auto-update. Keep the previous reviewed file for rollback.
An ordinary core-package update is different: the dashboard detects it automatically,
without reloading the VS Code window. [Support](SUPPORT.md) explains how to report problems.

Use **Check for updates** in the dashboard or **Rehearsal: Check for Updates** in the
Command Palette for an optional release check. The first trusted opening offers informed
opt-in: npm/GitHub see ordinary connection information, but receive no project data or
installed versions. Daily checks run only at project opening, not while idle. You can
defer or skip a release, or disable checks with **Rehearsal: Configure Update Checks**.
Checks never install anything automatically. Compatible does not mean newest; local or
candidate builds and unverified installation provenance require manual review.

## What the workbench shows

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
Passive inspection stays read-only. Every terminal action previews its exact allowlisted
public CLI command before opening an owned integrated terminal; installs, updates, migration
execution, runtime changes, and cleanup retain explicit editor or core confirmation. A running
editor-started action can be cancelled from Activity without signaling an unrelated operation.

The structured configuration editor accepts custom local URLs, application/proof commands,
lifecycle choices, and baseline retention. It validates bounded values, shows an exact diff,
rechecks the source for concurrent edits, and writes only after an explicit modal approval.
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
If VS Code cannot confirm a terminal's exit, its activity stays **Unverified**, even
after reloading. A different command in that terminal cannot mark Rehearsal complete.

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
`/progress`, and `/progress-unavailable`. Add `?theme=light`, `?theme=dark-modern`,
`?theme=contrast` or `?theme=contrast-light` to inspect explicit theme fixtures.
Browsing controls work with sample data;
`/progress?page=activity&live=1` adds a bounded six-update UI fixture to check that
live progress preserves the document, evidence disclosures, focus and scrolling.
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

That tier split is not implemented yet. Current preview artifacts retain the bundled
[license](LICENSE), which defines a 14-day evaluation and per-user commercial-preview
terms. An accepted receipt, invoice or order identifies a paid entitlement; public
prerelease availability alone does not. There is no technical trial countdown or paid
feature enforcement today. New Starter/Pro terms, pricing, billing and Marketplace
publication still need separate review and approval. Rehearsal core remains fully usable
without the extension.

GitHub VSIX installations do not auto-update. Every delivery must identify the extension
version, compatible core version, and SHA-256. Install a replacement with:

```bash
code --install-extension /absolute/path/to/rehearsal.vsix --force
```

Read the bundled [license](LICENSE), [privacy statement](PRIVACY.md), and
[support policy](SUPPORT.md) before evaluation. The extension also exposes each document
through the Command Palette. It includes no telemetry, advertising, hosted database access,
or automatic license activation.

## Product boundary

- Desktop VS Code 1.101 or newer on macOS and Linux.
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
- Exact update guidance for incompatible project packages; no background registry polling
  and no silent dependency changes.
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
