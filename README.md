<p align="center">
  <img src="media/rehearsal-readme.png" width="96" height="96" alt="Rehearsal logo" />
</p>

<h1 align="center">Rehearsal for VS Code</h1>

<p align="center"><strong>Test database changes before applying them.</strong></p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=rehearsal-db.rehearsal-db"><img alt="VS Code Marketplace version" src="https://img.shields.io/visual-studio-marketplace/v/rehearsal-db.rehearsal-db?style=flat-square&label=Starter&labelColor=1c2a34&color=287b5c" /></a>
</p>

<p align="center">
  <a href="https://ddupasquier.github.io/rehearsal-db/capabilities/">Released capabilities</a> ·
  <a href="https://ddupasquier.github.io/rehearsal-db/roadmap/">Public roadmap</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="docs/extension-guide.md">Detailed guide</a>
</p>

Rehearsal helps you review migrations, test them against a disposable local database,
and understand the result—all from VS Code. The dashboard shows your next step,
project readiness and local resource status.

## Available in free Starter

| Your next step              | What you can do today                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Understand your project** | Review detected settings, compatibility and readiness, then follow [guided setup](docs/extension-guide.md#project-setup-and-runtime-review).                                         |
| **Review migrations**       | Filter SQL, Prisma and Drizzle migrations, record review, inspect [static warnings](docs/extension-guide.md#static-migration-insights) and open exact SQL inputs.                    |
| **Rehearse changes**        | Run a full rehearsal, apply approved migrations without a reset, verify databases or open a [hands-on application session](docs/extension-guide.md#what-the-workbench-shows).        |
| **Keep useful evidence**    | Browse baselines and privacy, Storage and data-shape evidence; compare summaries and [export redacted reports](docs/extension-guide.md#what-the-workbench-shows).                    |
| **Recover and cancel**      | Follow persistent failure explanations, open unchanged attempted inputs and track or cancel [editor-owned operations](docs/extension-guide.md#what-the-workbench-shows).             |
| **Manage resources**        | Inspect ownership and available usage metrics, review protection settings and [preview cleanup](docs/extension-guide.md#project-setup-and-runtime-review).                           |
| **Use SQLite files**        | Review SQLite readiness and baselines, then enable or pause the owned file [without a VM](docs/extension-guide.md#sqlite-file-workflows).                                            |
| **Shut down the VM**        | Review affected workloads, confirm [supported VM shutdown](docs/extension-guide.md#vm-shutdown), then return with **Back to Rehearsal**.                                             |
| **Configure and update**    | Review exact configuration diffs, save display profiles and choose independent [extension/Core update preferences](docs/extension-guide.md#keep-the-canonical-installation-current). |

The [complete capability catalog](https://ddupasquier.github.io/rehearsal-db/capabilities/)
records published versions and verified scope. The
[public roadmap](https://ddupasquier.github.io/rehearsal-db/roadmap/) separately identifies
intended, queued and paused work. New database targets and container engines take
priority over further ORM integrations.

Starter **0.1.29** pairs with **Core 2.3.0** for
[SQLite file workflows](docs/extension-guide.md#sqlite-file-workflows).
Check the catalog for published availability and the guide for the qualified runtime.

The extension uses your project's Rehearsal CLI. Inspection is read-only; database
operations and destructive cleanup retain their review and confirmation steps.
Static warnings help with review; they do not prove a migration is safe.

## Get started

1. Install [**Rehearsal DB** from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=rehearsal-db.rehearsal-db)
   (publisher **rehearsal-db**, extension ID `rehearsal-db.rehearsal-db`).
2. Open your application folder. If Rehearsal is not already installed, run this in its terminal:

   ```sh
   npm install --save-dev @rehearsal-db/core
   ```

3. Open the Command Palette → **Rehearsal: Open Dashboard**.
4. Follow **Next best step** to configure your project and baseline.

See [Getting started](https://ddupasquier.github.io/rehearsal-db/getting-started/)
for baseline setup, or the [installation guide](https://ddupasquier.github.io/rehearsal-db/vscode/)
for distribution options. Older previews through 0.1.18 need a
[one-time extension migration](docs/extension-guide.md#move-from-a-preview-through-0118).

## Requirements and availability

Use desktop **VS Code 1.101+** on **macOS or Linux**, with **Node.js 22, 24 or 26**
selected in your project terminal. Container-backed rehearsals also need a supported
local container engine. Windows uses the **WSL 2 compatibility preview**, with the
project and tools inside Linux; native Windows execution is unsupported.

Check the [published release assets](https://github.com/Ddupasquier/rehearsal-vscode/releases)
and [Core compatibility guidance](docs/extension-guide.md#core-compatibility-and-upgrades)
before upgrading. Source versions do not prove publication; GitHub and Marketplace
availability can differ.

Introduced in 0.1.25, the prominent **Shut down VM…** control includes a workload
review and confirmation, plus **Back to Rehearsal**. VM shutdown initially supports **macOS Apple
Silicon, Colima 0.10.3, VZ and the default profile** with a compatible core. It stops
the shared VM, including other projects' workloads, while preserving data volumes.
Use **Stop project services** when you only want to stop this project's services.

Prisma and Drizzle review use pinned PostgreSQL SDKs and a compatible Core release.
See the [compatibility guide](docs/extension-guide.md#core-compatibility-and-upgrades)
for exact versions and qualification limits. Published availability is recorded in the
[capability catalog](https://ddupasquier.github.io/rehearsal-db/capabilities/).

## Free Starter, optional updates

Starter's included features remain yours **indefinitely at no charge** for personal
or commercial development. No account, card or trial is required. Core is MIT-licensed;
future optional Pro features do not revoke existing Starter rights.

The extension includes no telemetry. Release checks require consent; automatic
extension and compatible CLI updates have separate opt-ins, both off by default.
No update forces an editor reload or runs a migration.
Use **Rehearsal: Check for Updates** for current guidance. When installation needs
review, follow its Extensions or Settings action, then return to Rehearsal.

[Detailed guide](docs/extension-guide.md) ·
[Privacy](PRIVACY.md) · [License](LICENSE) · [Support](SUPPORT.md) ·
[Contributing](docs/extension-guide.md#contributing-and-local-development) ·
[Repository structure](docs/architecture.md#repository-layout)
