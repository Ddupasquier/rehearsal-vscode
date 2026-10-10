# Editor-facing CLI audit

Validated against an exact local `@rehearsal-db/core@0.1.0-rc.2` candidate built from
core commit `6316b7f2f2361ba9e91b07ca130760c57590910e`. Candidate SHA-256:
`f4be2f5e00f0083b12fc8fce3aab6b50e05645e905c5e47fd88c255d19753219`.
This identifies the tested candidate; it does not claim that the registry's earlier
artifact with the same prerelease version has identical bytes.

## Result

The public CLI is sufficient for a read-only project overview without private imports or
human-output parsing. The prototype can show package version, current operation activity,
readiness checks, configuration, targets, baseline metadata, candidate migrations,
approval digest, structured local-runtime state, and the loopback application URL.

The three original contract blockers are resolved in core:

- [structured runtime state](https://github.com/Ddupasquier/rehearsal-db/issues/112);
- [structured operation/busy state](https://github.com/Ddupasquier/rehearsal-db/issues/113);
- [mutating-operation cancellation contract](https://github.com/Ddupasquier/rehearsal-db/issues/114).

Mutating editor actions remain intentionally out of scope. The extension cancels only its
own read-only inspection process group. It does not infer ownership of an operation
started elsewhere and does not expose a database or runtime mutation.

## MVP matrix

| Need                 | Public command            | Accepted fields                                              | Exit behavior                                 |
| -------------------- | ------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| Installed version    | `--version --json`        | `name`, `version`                                            | `0`; resolution failure means missing package |
| Operation activity   | `activity --json`         | `schemaVersion`, `state`, sanitized operation metadata       | `0` or versioned error                        |
| Readiness            | `doctor --json`           | envelope plus `data.state`, `data.checks[]`                  | `0` ready, `1` not ready, `2–10` error        |
| Config and local URL | `explain --json`          | `data.config`, `data.environment`                            | `0` or versioned error                        |
| Baseline             | `inspect baseline --json` | generation, timestamp, counts, verification                  | `0` or versioned error                        |
| Candidates           | `candidates --json`       | filenames, per-target set, exact SHA-256                     | `0` or versioned error                        |
| Runtime              | `status --json`           | per-target `runtimeStatus`; human `data.output` is discarded | `0` or versioned error                        |

All normal envelopes use `schemaVersion: 1`, `rehearsalVersion`, `command`, `status`,
timing, warnings, and data. Error envelopes use the same schema version plus a stable
category, code, suggestions, and exit code mapping. The version result is a separate
two-field contract.

## Invocation contract

- Resolve the workspace-local manifest, or a repository-local hoisted manifest for a
  nested workspace, and use its declared bin. Never use `npx`, PATH lookup, a global
  package, a shell, or private package imports. Never search above the repository root.
- Use the workspace folder as `cwd` and pass `--config=<relative-path>` when configured.
- Pass only a documented infrastructure environment allowlist.
- Bound stdout and stderr independently to 1 MiB.
- Use 5 seconds for version and 60 seconds for inspection commands.
- Cancel the extension-owned process group with `SIGTERM`, then `SIGKILL` after a short
  grace period. Never signal an existing Rehearsal operation reported by `activity`.
- Treat cancellation and timeout as adapter states; a killed process cannot promise a JSON
  envelope.
- Never log raw process output. Reduce absolute configuration paths to workspace-relative
  paths before display.

## Scenarios covered

- package missing;
- missing, malformed, root, nested, explicit, and competing configurations;
- ready and not-ready projects;
- idle, busy, stale, and invalid operation-state contracts;
- stopped, running, unavailable, unhealthy, and mixed runtime contracts;
- zero and nonzero candidate shapes;
- schema mismatch, unsafe endpoint, contradictory state, and malformed JSON;
- output bounds and timeout;
- cancellation and extension-owned child cleanup;
- independent multi-root state;
- exact-candidate PostgreSQL Test Lab state plus the clean-room library's missing-config
  state, both in isolated temporary copies.

## Direct Extension Development Host observation

On 2026-10-10, the prototype was exercised in an isolated macOS Extension Development
Host using VS Code 1.141.0 arm64. The host opened temporary copies of Test Lab's
PostgreSQL and clean-room library projects; it did not start either runtime.

- Both workspace folders rendered independently in Dark Modern, Light Modern, and
  Default High Contrast. Two VS Code zoom-in steps preserved readable navigation and
  state, with expected text truncation and tooltips in the narrow tree.
- Keyboard-only commands focused the Projects view, traversed its roots and rows,
  refreshed both projects, and activated an item to show its exact read-only CLI
  equivalent.
- macOS VoiceOver recognized the view as a Projects table, exposed the hierarchy, and
  announced concise labels for both `Ready for rehearsal, 15 passed · 0 failed` and
  `Setup needs attention, 0 passed · 1 failed`. VoiceOver activation of the attention
  row displayed `npx rehearsal doctor` without running it.
- The direct host exposed and verified two launch-boundary corrections: the extension
  runs its workspace CLI through Electron in Node mode, and core preserves that mode
  only for its own nested runtime manager. Project-owned commands still receive the
  restricted project environment.

Opening the local application and external documentation links was intentionally not
part of this read-only observation. No browser or running database behavior is inferred
from it.

## Packaged installation observation

The committed prototype was packaged as a 14-file, 56.05 KB VSIX with SHA-256
`9ba6209dbdf931d7a225cfc2ee7068d859b6eb9fe7b970749838e5b3bc0dd453`. The archive
contains the runtime JavaScript, extension manifest, documentation, license, and two
media assets; it excludes source files, tests, declaration files, and source maps.

The exact VSIX was installed into isolated VS Code user-data and extensions directories
as `rehearsal-db.rehearsal-vscode@0.0.1`, then launched without
`--extensionDevelopmentPath`. Its commands appeared in the Command Palette, and its
Projects view independently rendered the candidate-backed PostgreSQL Test Lab fixture
as ready and the clean-room library fixture as needing setup. This verifies packaged
discovery and rendering; Marketplace publication, update delivery, and external-link
navigation remain untested.

The same core artifact completed Test Lab's full candidate-acceptance workflow for both
PostgreSQL and Supabase targets, including onboarding, source preparation, baselines,
lifecycle, cleanup, identity, application, and unrelated-container isolation. That
acceptance validates the core candidate used by the extension; Test Lab is not part of
the extension product or runtime dependency.
