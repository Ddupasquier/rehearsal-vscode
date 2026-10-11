# Privacy and data use

Rehearsal for VS Code does not include telemetry, advertising, analytics, or an extension
account. It does not upload database rows, baselines, Storage objects, credentials, SQL,
environment files, project source, or workspace paths.

## What stays on your machine

- Rehearsal configuration, policies, baselines, and runtime data.
- Read-only project results returned by the workspace-installed Rehearsal CLI.
- View filters, sorting, a selected display profile, and a validated loopback address.
- At most 20 bounded activity receipts containing an action label, timestamps, outcome,
  and exit code. Workspace paths are represented by a local hash.

Use **Rehearsal: Reset Saved Editor State** to remove those preferences and receipts for a
project. Uninstalling the extension also stops future processing.

## When networking can happen

Passive inspection makes no network request. Networking happens only when you explicitly:

- open documentation or another external link;
- approve a package install or update through your project's package manager; or
- run a Rehearsal operation whose reviewed project configuration uses an allowed service.

Those operations are governed by the relevant package registry, browser, provider, and
Rehearsal core policies. The extension never contacts a hosted database by itself.

## Questions

Use the support route in [SUPPORT.md](SUPPORT.md). Report security concerns privately as
described in [SECURITY.md](SECURITY.md); do not put secrets or private data in an issue.
