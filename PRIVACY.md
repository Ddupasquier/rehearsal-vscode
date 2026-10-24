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

Migration failure explanations come from bounded, redacted core receipts. They may
include a classification, SQLSTATE, fixed recovery guidance and an exact attempted-input
filename, digest and safe project-relative path. They exclude SQL, row values, connection
strings and raw provider details. The extension displays them without copying the raw
CLI response or diagnosis into its own saved activity receipts.

Earlier extension releases do not scan migration contents during passive inspection.
From extension 0.1.24/core 1.2.0, a trusted workspace whose core explicitly advertises
Migration Insights may also run that core's bounded static SQL inspection. It reads only
project-local regular migration files: at most 10,000 files in total, 10,000 entries per
migration directory, 1,000 pending candidates, 2 MiB per file and 16 MiB total input. No SQL is
executed, engine started, database contacted or source uploaded. The editor receives at
most 5,000 fixed findings with lexical positions, exact filenames/hashes and safe relative
paths—not SQL bodies, identifiers or row values. These optional results remain in the
current in-memory snapshot, not saved activity receipts or view state.

If you explicitly choose **Open exact migration input** or **Open exact
migration at finding**, the extension reads at most 2 MiB of that selected project-local
file to verify its UTF-8 bytes, identity and recorded digest before opening it in the
native editor. Changed or dirty files and symlink redirects are refused. SQL stays in
that local file/editor; it is not added to the webview, diagnostic report, saved editor
state or any upload. A lexical warning position is not a database error location, and
attempted failure input still does not establish an exact SQL error location.

Use **Rehearsal: Reset Saved Editor State** to remove view preferences and activity
receipts for a project. Update consent is separate: use **Rehearsal: Configure Update
Checks → Disable Automatic Checks** to stop optional checks. Uninstalling the extension
also stops future processing.

Automatic installation is a separate, initially disabled choice. The update prompt offers
independent extension and CLI checkboxes. They are saved as
`rehearsal.automaticUpdates.extension` and `.cli` in machine-scoped user settings, not
repository configuration or Settings Sync. Closing or deferring the prompt does not opt
in. Turn either flag off in user settings or **Rehearsal: Configure Update Checks**.

## Canonical identity and legacy previews

From 0.1.19, the package identity is `rehearsal-db.rehearsal-db` (Marketplace display
name **Rehearsal DB**); older GitHub previews use `rehearsal-db.rehearsal`. The new
extension does not read or import the old extension's private workspace/global storage.
Per-extension view preferences, bounded activity receipts and metadata-check consent
are not transferred. Review consent and re-select views in the new installation.

Shared VS Code user settings keep their existing values, including the separately
chosen `rehearsal.automaticUpdates` flags. They are not reset by the identity change;
review or disable them before migrating if desired. Project config, credentials, keys,
baselines and database/Storage data are neither copied nor modified for migration.
No migration report or account association is uploaded. The new extension refuses to
activate if VS Code still reports the legacy extension; it does not silently uninstall,
disable or rename it. Follow the [manual migration steps](README.md#move-from-a-preview-through-0118).

## When networking can happen

Passive project inspection makes no network request. Separate optional update checks
contact only `registry.npmjs.org` and `api.github.com` after informed consent or an explicit
one-time check. Servers see ordinary connection information such as your IP address;
requests send no project names, paths, files, installed versions, credentials or database
data. Metadata-only opt-ins check a project at opening at most daily, not while idle.
The separate automatic-installation choices also authorize the open-window daily checks
described below. Use **Rehearsal: Configure Update Checks** to disable checks; no separate
background daemon is installed.

If you explicitly enable automatic extension updates, Rehearsal also downloads only the
official GitHub release's VSIX and SHA256SUMS, allowing GitHub's HTTPS asset redirect to
`release-assets.githubusercontent.com`. These services see ordinary connection information
and the requested public release asset. Checksums, embedded extension identity and engine
compatibility are verified before VS Code receives the local file. No forced reload occurs.
The canonical identity accepts only its `rehearsal-db-<version>.vsix` artifacts; a legacy
package cannot become an automatic identity migration.
Automatic CLI updates separately authorize the project's npm registry/package-manager
traffic for compatible exact versions; installation scripts are disabled. No database
operation is requested. Active work, dirty files and unavailable verification defer updates.
While an automatic option is enabled, a daily release check also runs in an open editor
window. Turning both options off stops that timer; metadata-only project-opening checks
remain governed by their separate consent. There is no runtime polling or separate daemon.

Other networking happens only when you explicitly:

- open documentation or another external link;
- approve a package install or update through your project's package manager; or
- run a Rehearsal operation whose reviewed project configuration uses an allowed service.

Those operations are governed by the relevant package registry, browser, provider, and
Rehearsal core policies. The extension never contacts a hosted database by itself.

## Questions

Use the support route in [SUPPORT.md](SUPPORT.md). Report security concerns privately as
described in [SECURITY.md](SECURITY.md); do not put secrets or private data in an issue.
