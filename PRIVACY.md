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
- Optional update-check consent, check/defer times and skipped release versions, keyed by
  a workspace hash. These records are local, not Settings Sync or telemetry.

Use **Rehearsal: Reset Saved Editor State** to remove view preferences and activity
receipts for a project. Update consent is separate: use **Rehearsal: Configure Update
Checks → Disable Automatic Checks** to stop optional checks. Uninstalling the extension
also stops future processing.

## When networking can happen

Passive project inspection makes no network request. Separate optional update checks
contact only `registry.npmjs.org` and `api.github.com` after informed consent or an explicit
one-time check. Servers see ordinary connection information such as your IP address;
requests send no project names, paths, files, installed versions, credentials or database
data. An opted-in project is checked at opening at most daily, with no idle polling or
background daemon. Use **Rehearsal: Configure Update Checks** to disable these checks.

Other networking happens only when you explicitly:

- open documentation or another external link;
- approve a package install or update through your project's package manager; or
- run a Rehearsal operation whose reviewed project configuration uses an allowed service.

Those operations are governed by the relevant package registry, browser, provider, and
Rehearsal core policies. The extension never contacts a hosted database by itself.

## Questions

Use the support route in [SUPPORT.md](SUPPORT.md). Report security concerns privately as
described in [SECURITY.md](SECURITY.md); do not put secrets or private data in an issue.
