<p align="center">
  <img src="media/rehearsal-readme.png" width="96" height="96" alt="Rehearsal logo" />
</p>

<h1 align="center">Rehearsal for VS Code</h1>

<p align="center"><strong>Understand whether a database change is ready—without memorizing the CLI.</strong></p>

This commercial preview is a project-aware client for the Rehearsal package
installed in each workspace. Its native project navigator opens a Rehearsal Workspace with
persistent navigation for Overview, Project setup, Migrations, Environments, Data & auth,
Configuration, and Activity & reports.
Each destination presents one focused job instead of one long diagnostic report. The
workspace includes readiness, the active configuration, baseline metadata, candidate
migrations, structured local-runtime state, current Rehearsal activity, and local
application details. The Environment Workbench adds migration search/sort/review,
target and view-profile selection, editable loopback application addresses, retained
baseline versions, provider-neutral authentication review, aggregate environment
comparison, redacted report export, and a bounded project-local activity history.
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

## Use the extension

```bash
npm install
npm run check
code .
```

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
states at `/outdated`, `/missing`, `/not-ready`, and `/timeout`. Add `?theme=light` or
`?theme=contrast` to inspect theme behavior. Preview buttons are inert anchors; this
developer surface never runs Rehearsal commands or touches a project.

To try the packaged extension instead:

```bash
npm run verify:vsix
npm run package:vsix -- --out rehearsal-0.1.2.vsix
code --install-extension rehearsal-0.1.2.vsix --force
```

`verify:vsix` builds the production archive, checks that development-only files are absent,
installs it under isolated temporary VS Code user-data and extension directories, confirms
the exact manifest identity and version, and removes its temporary files. The
second command creates the private handoff artifact only when you actually need one.

The workspace repository must install `@rehearsal-db/core`. A nested project may use the
repository's normal hoisted dependency, but resolution never crosses the Git repository
boundary or falls back to a global package or private source checkout.

## Evaluation and paid preview

The VS Code extension has a 14-day evaluation. Paid-preview access is licensed per user
through the receipt, invoice, or accepted order that accompanies the exact VSIX. Rehearsal
core remains MIT-licensed and fully usable without the extension.

Private VSIX installations do not auto-update. Every delivery must identify the extension
version, compatible core version, and SHA-256. Install a replacement with:

```bash
code --install-extension /absolute/path/to/rehearsal-0.1.2.vsix --force
```

Read the bundled [license](LICENSE), [privacy statement](PRIVACY.md), and
[support policy](SUPPORT.md) before evaluation. The extension also exposes each document
through the Command Palette. It includes no telemetry, advertising, hosted database access,
or automatic license activation.

## Product boundary

- Desktop VS Code on macOS and Linux.
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
- Untrusted workspaces fail closed and run no process.
- Multiple workspace folders are refreshed independently with at most two simultaneous
  inspections.
- Concise Tree View labels are exposed to screen readers while longer diagnostic detail
  remains available in tooltips.
- **Rehearsal: Reset Saved Editor State** clears only local view preferences and bounded
  action receipts; it does not alter project files or database resources.

Read [the architecture decisions](docs/architecture.md), [security model](SECURITY.md),
and [CLI audit](docs/cli-contract-report.md) before extending the prototype.
