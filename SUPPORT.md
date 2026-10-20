# Support

Rehearsal for VS Code Starter is free preview software for local development, not a
backup system or production emergency service. Starter support is best effort through
the issue tracker; no purchase or account is required to use the extension.

## Before asking for help

1. Run **Rehearsal: Refresh Project Overview**.
2. Export the privacy-safe report from **Activity & reports**.
3. Run the workbench's **Support report** action when available.
4. Remove anything you do not want to share. Never include credentials, environment files,
   raw database rows, or private source data.

## Automatic-update recovery

The extension and CLI have independent, initially off opt-ins in
`rehearsal.automaticUpdates` user settings. Turning either flag off revokes its future
automatic work. Configure these through **Rehearsal: Configure Update Checks**; choosing
**Disable updates** turns both off for this computer and stops this project's release
checks. Metadata checks for other projects retain their separate preferences.

Updates defer for active or unknown operations, dirty dependency documents, unavailable
storage, a competing update or unverifiable artifacts. Save your dependency files, finish
the owning operation, then use **Check for updates**. Do not assume a dispatched npm
command completed: inspect its terminal exit and refreshed installed version.

An extension-host crash during a package update can leave a coordination lock because the
child command's completion is unknown. Rehearsal will not steal or age out that lock.
Keep automatic CLI updates off and report the interrupted update through the support route
below; do not delete lock metadata while a package manager may still be running. This
conservative recovery is distinct from routine automatic updates and never permits data
cleanup. Editor policies, offline services and unsupported compatibility require recovery
or manual review; no updater can guarantee an installation under those conditions.

## Get help

Open an issue at <https://github.com/Ddupasquier/rehearsal-db/issues> and include:

- Rehearsal extension, core, VS Code, Node.js, and operating-system versions;
- the redacted report and the exact step that failed; and
- whether the problem is repeatable in Rehearsal Test Lab.

Existing accepted commercial-preview orders retain their best-effort priority handling
and initial-response target of three business days; this is not a service-level agreement.
Any additional support, purchase, refund or private-contact terms remain governed by the
accepted order. Starter does not promise a response deadline or future paid support.

Security reports follow [SECURITY.md](SECURITY.md), not the public issue tracker.
