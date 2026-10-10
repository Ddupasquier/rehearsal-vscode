# Architecture decisions

## Product identity

| Decision              | Prototype contract                                                             |
| --------------------- | ------------------------------------------------------------------------------ |
| Repository            | Separate sibling repository: `rehearsal-vscode`                                |
| Visibility            | Private while value and commercial terms are unproven                          |
| Display name          | Rehearsal                                                                      |
| Proposed extension ID | `rehearsal-db.rehearsal`                                                       |
| Publisher             | `rehearsal-db` is reserved in metadata only; no Marketplace account is created |
| Product owner         | Rehearsal project, administered by Ddupasquier                                 |
| License               | `UNLICENSED` private prototype; Rehearsal core remains MIT                     |
| Version               | `0.0.1` private prototype                                                      |

No Marketplace listing, publisher account, VSIX distribution, pricing, license service,
or payment account is authorized by these decisions.

## Technical foundation

- TypeScript with strict checking and CommonJS output for the desktop extension host.
- VS Code `^1.96.0` using standard Tree View, commands, progress, notifications, links,
  and resource-scoped settings.
- No framework and no webview in the first prototype.
- Vitest for pure contract, process, and state-model tests. Test Lab supplies the real
  installed-package acceptance workspace.
- macOS and Linux are supported for the prototype. WSL is experimental. Native Windows,
  browser-based VS Code, Codespaces, SSH, and Dev Containers are not claimed yet.

## Editor experience and accessibility

- Standard VS Code Tree View, commands, progress, links, theme icons, focus handling, and
  keyboard navigation carry the first experience. The extension adds no custom color
  palette, font, focus model, or screen-reader surface.
- Every icon has a plain-language label. Status is never communicated by color alone.
- Equivalent CLI commands remain available from the keyboard and item activation.
- English is the only reviewed prototype language. User-facing strings must remain easy
  to extract before a public localization commitment.
- Development checkouts update through Git only. Automatic updates begin only after a
  separately approved Marketplace or private-distribution decision.

## Runtime boundary

Each trusted workspace folder receives its own controller, cancellation signal, package
resolution, explicit working directory, optional configuration path, and state tree.
One folder cannot lend its package, configuration, result, or process to another.

The adapter first checks `node_modules/@rehearsal-db/core/package.json` inside the
workspace folder. For a nested workspace it may follow normal package-manager hoisting
up to—but never above—the containing Git repository. It validates the manifest and
declared `rehearsal` bin, then launches that bin with the extension host's Node
executable. It uses argument arrays and `shell: false`.

The first view invokes only these public commands:

- `--version --json`
- `activity --json`
- `doctor --json`
- `candidates --json`
- `inspect baseline --json`
- `explain --json`
- `status --json`

The adapter accepts only JSON schema version 1. It never consumes `data.output`. It reads
the public `activity` contract before inspecting the project and again after the parallel
read-only queries. When an operation is busy, stale, or invalid, the view omits project
details that could be inconsistent and presents only the safe activity state. Runtime
state comes exclusively from `status.data.runtimeStatus` for each configured target.

Refresh cancellation terminates only the read-only CLI process group launched by this
extension. Rehearsal core documents cancellation for future mutating actions, but this
prototype exposes no start, stop, reset, restore, migration, identity, or cleanup action.

## Trust, privacy, and storage

- Untrusted workspaces show one explanatory item and run nothing.
- `rehearsal.configPath` is resource-scoped and must resolve inside its workspace folder.
- The extension stores no credentials, raw rows, baseline contents, source URLs, or CLI
  responses.
- The output channel records only bounded lifecycle summaries and stable error codes.
- Telemetry is absent. Settings Sync may carry only the optional relative config path.

## Commercial boundary

The prototype is intentionally free of licensing code. A paid edition requires separate
evidence that the workflow saves time or catches meaningful risk, followed by explicit
approval of distribution, evaluation, pricing, offline behavior, refunds, privacy, and
support. License failure must never weaken Rehearsal core or block recovery.
