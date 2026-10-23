# Security boundary

The extension is a client of the workspace-installed Rehearsal CLI. It never imports
Rehearsal implementation modules or implements database, migration, sanitization,
identity, Storage, restore, or cleanup behavior.

## Extension identity boundary

The canonical package from 0.1.19 is `rehearsal-db.rehearsal-db`, displayed in Marketplace
as **Rehearsal DB**. The workbench remains Rehearsal. Automatic update metadata,
asset names (`rehearsal-db-<version>.vsix`) and embedded publisher/name must all agree
with this canonical identity; legacy `rehearsal-db.rehearsal` archives are refused.
Public legacy 0.1.18 remains immutable and available, but its old asset-name filter
does not silently install the canonical identity.

Activation fails closed whenever VS Code still reports the legacy extension ID.
`isActive: false` does not prove an installed extension is disabled, so it cannot
authorize coexistence. The supported migration is explicit: finish active commands,
save work, uninstall the legacy extension, reload and install the verified canonical
package. This release does not silently uninstall/disable another extension, inspect
or copy its private Memento state, or alter project config, keys, baselines or database
data. Shared user settings remain unchanged; review those settings before migration.
See the [manual migration guide](README.md#move-from-a-preview-through-0118).

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
- Optional update advisories are a separate, consent-gated exception to network-free
  passive inspection: fixed public npm/GitHub metadata URLs, no credentials/cookies or
  project data, no metadata redirects and bounded response/time limits. Metadata-only
  daily checks run at project opening. An independent automatic-update opt-in also
  enables daily release checks while the editor stays open; disabling both automatic
  options stops that timer. No runtime polling or separate daemon is installed. Unknown,
  offline, candidate/custom or drifting installations never grant install authority.
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

Migration diagnoses are accepted only through the closed, versioned core contract and
must belong to a matching failed operation receipt. The extension does not classify SQL
or parse provider output itself. An **Open exact migration input** message contains only
that operation ID, never a webview-provided path or position. The host rechecks the
current panel, workspace and trust, resolves only the recorded safe project-local path,
and rejects symlink components, non-regular/oversized files, invalid UTF-8, changed file
identity or bytes, and a dirty or different editor buffer. SQL is shown only by the
explicit native-editor action, not included in diagnostics, exports or saved view state.
No line/column, rollback, successful cleanup, SQL rewrite or retry is inferred from a
failed migration or its attempted-input attribution.

The source candidate's optional static Migration Insights is a different contract, not
a fabricated failed-execution receipt. Only explicit manifest capability
`migrationInsights: 1` plus `migrationReview: 1` enables `inspect insights --json` in a
trusted idle refresh. The closed parser binds its schema, inspector version, complete
candidate digest/count, ordered targets, baseline generations and every filename/hash
to the separately validated current plan. Fixed rule/severity/remediation mappings,
unknown coverage, limits and read-only safety declarations are checked; SQL-bearing or
expanded findings are refused. Only this optional response has an 8 MiB transport and
parse cap; ordinary command limits remain 1 MiB. An unavailable optional analysis does
not deny ordinary Starter controls, and an actual core version/activity drift still
invalidates the normal snapshot.

Static finding links contain only an opaque exact-report ID, never an inbound path or
position. `migration_source.ts` owns the shared confined exact-byte reader;
`migration_failure_source.ts` retains the existing execution-provenance wrapper. The
static handler independently rechecks panel/workspace/trust, current ready idle snapshot,
file identity/hash and clean document text. A reported 1-based UTF-16 lexical position
must exist in that exact document; positions are never clamped or inferred. No autofix,
SQL execution, database contact, approval bypass or new paid-feature gate is added.

Native model text may differ from disk bytes only by the explicit one-leading-BOM and
line-ending projection documented in [architecture](docs/architecture.md#optional-static-migration-insights-source-candidate).
Raw disk SHA/identity is still verified twice and dirty buffers remain refused. Document
BOMs are not broadly stripped; additional decoding differences fail closed. Scanner
positions are already BOM-decoded and are never shifted again. This also avoids false
refusals for existing failure-input opening without inventing failure positions.

Freshness does not change the minimum compatibility contract. A newer public version
may be offered without labeling the installed compatible version broken. Exact-version
core updates need explicit approval or a current, separate automatic CLI-update opt-in
in machine-scoped user settings. Project settings cannot supply that consent. Both routes
recheck trust, unchanged installation metadata and idle public activity before terminal
execution. Proven npm updates preserve the existing dependency group and exact pin.
Automatic CLI updates also disable install scripts, refuse dirty dependency documents
and require confirmed shell execution plus project-scoped cross-window coordination.
Unsupported/ambiguous provenance and new compatibility series stay manual-only;
inspection never overwrites them. Revoked consent cancels queued automatic work.

Manual extension updates open the fixed reviewed GitHub release. The independent
automatic extension-update opt-in permits downloading its official VSIX and checksum,
with only the allowlisted GitHub HTTPS release-asset redirect. Bounded archive checks,
SHA-256, embedded publisher/name/version and engine compatibility are verified before
VS Code receives the private local file. An exclusive cross-window installation lock,
fresh idle checks and revocable consent guard dispatch. A checksum from the same release
is integrity evidence, not independent publisher authentication. No force reload or
database operation is requested; VS Code may require a later restart to load the update.

Report security concerns through the private process in the core repository's
[`SECURITY.md`](https://github.com/Ddupasquier/rehearsal-db/blob/main/SECURITY.md).
