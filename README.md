<p align="center">
  <img src="media/rehearsal-readme.png" width="96" height="96" alt="Rehearsal logo" />
</p>

<h1 align="center">Rehearsal for VS Code</h1>

<p align="center"><strong>Test database changes before applying them.</strong></p>

Rehearsal helps you review migrations, test them against a disposable local database,
and understand the result—all from VS Code. The dashboard shows your next step,
project readiness and local resource status.

## What you can do

- **Review migrations:** browse pending changes and optional static warnings before running them.
- **Rehearse locally:** test changes against a baseline and review failures and reports.
- **Manage environments:** open, verify, stop or reset project sandboxes with reviewed actions.
- **Control resources:** inspect containers and disk usage, then review cleanup before confirming it.
- **Configure your project:** review detected settings and an exact diff before saving changes.

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

**0.1.25 is a release candidate targeting Core 2.0.0.** Source versions do not mean
publication is complete. Check the [release assets](https://github.com/Ddupasquier/rehearsal-vscode/releases)
and [upgrade guidance](docs/extension-guide.md#install-and-open-your-project) before upgrading.

The candidate adds a prominent **Shut down VM…** control with a workload review and
confirmation, plus **Back to Rehearsal**. VM shutdown initially supports **macOS Apple
Silicon, Colima 0.10.3, VZ and the default profile** with a compatible core. It stops
the shared VM, including other projects' workloads, while preserving data volumes.
Use **Stop project services** when you only want to stop this project's services.

The separate **0.1.27 source candidate** adds explicit pinned PostgreSQL Drizzle
journal review, native format 4 baselines and exact reviewed SQL navigation through
a compatible Core contract. It is not a publication or real SDK/native acceptance
claim; see the [contract scope](docs/cli-contract-report.md#0127--core-drizzle-contract-candidate).

## Free Starter, optional updates

Starter's included features remain yours **indefinitely at no charge** for personal
or commercial development. No account, card or trial is required. Core is MIT-licensed;
future optional Pro features do not revoke existing Starter rights.

The extension includes no telemetry. Release checks require consent; automatic
extension and compatible CLI updates have separate opt-ins, both off by default.
No update forces an editor reload or runs a migration.

[Detailed guide](docs/extension-guide.md) ·
[Privacy](PRIVACY.md) · [License](LICENSE) · [Support](SUPPORT.md) ·
[Contributing](docs/extension-guide.md#contributing-and-local-development)
