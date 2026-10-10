<p align="center">
  <img src="https://raw.githubusercontent.com/Ddupasquier/rehearsal-db/main/docs/site/logo-mark.svg" width="96" height="96" alt="Rehearsal logo" />
</p>

<h1 align="center">Rehearsal for VS Code</h1>

<p align="center"><strong>Understand whether a database change is ready—without memorizing the CLI.</strong></p>

This private prototype is a read-only client for the Rehearsal package installed in each
workspace. It shows readiness, the active configuration, baseline metadata, candidate
migrations, structured local-runtime state, current Rehearsal activity, local application
details, and the equivalent public CLI commands.

It does not implement database behavior, inspect private rows, read credentials, contact
hosted databases, install packages, or silently change a project. Rehearsal core remains
the only migration and safety engine.

## Try the prototype

```bash
npm install
npm run check
code .
```

Press `F5` and choose **Run Rehearsal Extension**. The development host opens Rehearsal
Test Lab. Open the Rehearsal activity-bar view and choose **Refresh Project Overview**.

The workspace repository must install `@rehearsal-db/core`. A nested project may use the
repository's normal hoisted dependency, but resolution never crosses the Git repository
boundary or falls back to a global package or private source checkout.

## Current boundary

- Desktop VS Code on macOS and Linux.
- Node.js 22, 24, or 26 in the extension host.
- Standard Tree View UI; no webview, telemetry, licensing, or billing.
- Read-only Rehearsal commands with versioned JSON results.
- Structured activity and runtime state; human-formatted CLI output is never parsed.
- Refresh cancellation stops only the inspection process owned by the extension.
- Untrusted workspaces fail closed and run no process.
- Multiple workspace folders are refreshed independently.
- Concise Tree View labels are exposed to screen readers while longer diagnostic detail
  remains available in tooltips.

Read [the architecture decisions](docs/architecture.md), [security model](SECURITY.md),
and [CLI audit](docs/cli-contract-report.md) before extending the prototype.
