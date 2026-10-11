# Security boundary

The extension is a client of the workspace-installed Rehearsal CLI. It never imports
Rehearsal implementation modules or implements database, migration, sanitization,
identity, Storage, restore, or cleanup behavior.

## Fail-closed rules

- Do not run in an untrusted workspace.
- Do not use a global Rehearsal installation.
- Read-only inspection never invokes a shell; it launches the validated workspace CLI
  with an argument array and `shell: false`.
- Do not parse human-formatted CLI output.
- Do not log raw stdout, stderr, environment variables, configuration contents, or
  absolute paths.
- Do not read credential, privacy-key, baseline-data, or source-policy files.
- Do not send telemetry or contact a hosted database. An explicitly approved install or
  update uses the project's package manager and may contact its configured registry.
- Treat unknown JSON versions, fields required by the current view, oversized output,
  timeouts, and malformed results as unavailable state—not permission to guess.

The process adapter passes a small infrastructure environment allowlist. Source and
identity credential variables are intentionally unavailable to this read-only prototype.
Cancellation stops the complete process group owned by the extension on macOS and Linux.

The project workbench has no network capability. Its only script is authorized by a fresh
content-security-policy nonce and can switch known rendered pages, filter and sort already
rendered metadata, update harmless view preferences, request validated loopback navigation,
request a local report export, or propose bounded configuration values. Messages cannot
provide shell text for immediate execution or launch a Rehearsal operation. Command links
contain an opaque, panel-lifetime token and an
allowlisted action ID—not a path or command string.
For a guided operation, the extension previews the exact fixed command in a modal, adds
stronger confirmation language where appropriate, then opens it in a project-scoped
integrated terminal. Cancellation closes only a terminal owned by this extension and never
signals an independently discovered Rehearsal operation.
Rehearsal core remains responsible for exact digests, target isolation, locks, local-only
validation, and destructive confirmations. The extension never inserts credentials into
arguments, terminal text, settings, logs, or webview HTML.

Configuration proposals accept only known literal fields. The extension shows an exact
diff, checks that the source was not dirty or changed during review, and requires explicit
approval before applying it. Ambiguous, expression-based, oversized, or out-of-workspace
configuration is refused. The complete saved file must still pass Rehearsal core validation
before it can affect a runtime.

Report security concerns through the private process in the core repository's
[`SECURITY.md`](https://github.com/Ddupasquier/rehearsal-db/blob/main/SECURITY.md).
