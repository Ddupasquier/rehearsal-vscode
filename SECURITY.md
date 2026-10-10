# Security boundary

The extension is a client of the workspace-installed Rehearsal CLI. It never imports
Rehearsal implementation modules or implements database, migration, sanitization,
identity, Storage, restore, or cleanup behavior.

## Fail-closed rules

- Do not run in an untrusted workspace.
- Do not use a global Rehearsal installation.
- Do not invoke a shell.
- Do not parse human-formatted CLI output.
- Do not log raw stdout, stderr, environment variables, configuration contents, or
  absolute paths.
- Do not read credential, privacy-key, baseline-data, or source-policy files.
- Do not send telemetry or contact a hosted service.
- Treat unknown JSON versions, fields required by the current view, oversized output,
  timeouts, and malformed results as unavailable state—not permission to guess.

The process adapter passes a small infrastructure environment allowlist. Source and
identity credential variables are intentionally unavailable to this read-only prototype.
Cancellation stops the complete process group owned by the extension on macOS and Linux.

Report security concerns through the private process in the core repository's
[`SECURITY.md`](https://github.com/Ddupasquier/rehearsal-db/blob/main/SECURITY.md).
