# Architecture decisions

## Product identity

| Decision      | Product-candidate contract                                                |
| ------------- | ------------------------------------------------------------------------- |
| Repository    | Separate sibling repository: `rehearsal-vscode`                           |
| Visibility    | Private commercial preview until publication receives separate approval   |
| Display name  | Rehearsal                                                                 |
| Extension ID  | `rehearsal-db.rehearsal`                                                  |
| Publisher     | `rehearsal-db` is reserved in metadata; no Marketplace account is assumed |
| Product owner | Rehearsal project, administered by Ddupasquier                            |
| License       | Commercial preview per user; Rehearsal core remains MIT                   |
| Version       | `0.1.1` commercial preview candidate                                      |

Packaging a reviewed commercial-preview candidate is authorized. Marketplace publication,
publisher/account creation, public pricing, payment setup, and distribution still require
their own reviewed release decision.

## Technical foundation

- TypeScript with strict checking and CommonJS output for the desktop extension host.
- VS Code `^1.96.0` using standard Tree View, commands, progress, notifications, links,
  and resource-scoped settings.
- No UI framework. A native Tree View discovers projects; a narrowly scripted
  `WebviewPanel` owns the product workspace after the Tree prototype proved the contract.
  Its nonce-authorized navigation script only switches among seven rendered destinations
  and reports the selected page to the extension. It also manages bounded filters, view
  preferences, local-address input, comparison, report-export requests, and configuration
  proposals. Restricted `command:` links use opaque, panel-lifetime tokens; absolute
  workspace paths never enter webview HTML.
- Vitest for pure contract, process, and state-model tests. Test Lab supplies the real
  installed-package acceptance workspace.
- macOS and Linux are supported for the prototype. WSL is experimental. Native Windows,
  browser-based VS Code, Codespaces, SSH, and Dev Containers are not claimed yet.

## Editor experience and accessibility

- Standard VS Code Tree View, commands, progress, links, theme icons, focus handling, and
  keyboard navigation carry entry into the product. The project workbench adds a
  persistent, keyboard-accessible navigation shell for Overview, Project setup,
  Migrations, Environments, Data & auth, Configuration, and Activity & reports. It uses
  semantic HTML and VS Code theme tokens
  with the Rehearsal mint accent; it has no custom focus model, network request, or
  independent project-state authority. Technical evidence is progressively disclosed.
- Every icon has a plain-language label. Status is never communicated by color alone.
- Guided actions remain available from the keyboard. Read-only refreshes stay inside the
  adapter; approved operations open their exact public command in a project-scoped
  integrated terminal.
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

The extension requires `@rehearsal-db/core@0.1.0-rc.4` or newer for the versioned
activity/runtime inspection contract. Older projects stop after the package version
check: no unsupported command is attempted. The workspace and Tree View show an update
action using the detected package manager. The exact dependency command and affected
manifest/lockfile boundary are shown in a modal before execution.

Each workspace owns narrow file watchers for its root manifest, supported lockfiles,
installed Rehearsal manifest, and known configuration locations. Related package-manager
writes are coalesced into one trailing read-only refresh. This keeps the Tree View and an
open workbench current when Rehearsal is updated in another terminal, without polling,
running package-manager code, watching unrelated dependencies, or requiring a window
reload. Removing a workspace disposes its watchers and pending refresh.

The first view invokes only these public commands:

- `--version --json`
- `activity --json`
- `discover --json` when the installed manifest advertises Project Profile schema 1
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

Project discovery remains a core responsibility. A discovery-capable package classifies
each entry as detected, suggested, or requiring a human decision and supplies bounded
evidence, confidence, proposed field states, and a safety attestation. The extension
validates that contract and rejects any result that reports project-code execution,
environment-file access, database contact, or container-engine startup.

Before a capable package is installed, a small extension bootstrap reads only bounded
`package.json` metadata, lockfile names, known config filenames, and conventional
migration directories through `vscode.workspace.fs`. It does not follow symlinks or
execute code. The bootstrap is labeled as limited in the UI and never grows into a
second comprehensive discovery engine.

The project workbench renders only the already-normalized `ProjectSnapshot` used by the
Tree View. It receives no raw CLI envelope, environment, credential, row, source URL, or
absolute workspace path. Its content-security policy allows only the packaged stylesheet,
logo, and a per-render nonce-authorized interaction script. Messages are parsed as a closed
union. They may update harmless local view preferences, open a validated loopback URL,
request a redacted report export, or submit a bounded configuration proposal; they cannot
provide a command line, filesystem path, credential, or Rehearsal operation.

Refresh cancellation terminates only the read-only CLI process group launched by this
extension. Each inspection command has a resource-scoped 15–300 second timeout (90
seconds by default), and timeout messages identify the command that exceeded it. Global
multi-root refresh runs at most two projects concurrently.

Operational actions do not create a second runtime engine. The extension builds only an
allowlisted public command, previews the exact command in a modal for every terminal action,
adds stronger language for dependency writes and risky runtime changes, then runs it in a
workspace-scoped integrated terminal. Activity cancellation closes only an owned terminal;
it never signals an operation merely discovered through core's activity contract. Rehearsal core
continues to own exact-plan digests, confirmation flags, operation locks, local-only
validation, cancellation, rollback, and cleanup. Candidate execution is bound to the
digest already returned by `candidates --json`; a stale digest therefore fails closed.
Configuration creation and baseline/source decisions remain in core's interactive guide.

Known literal configuration fields may be edited through the workbench. The editor accepts
only bounded loopback URLs, commands, lifecycle enums, and retention counts; requires one
unambiguous literal per field; shows an exact diff; refuses dirty or concurrently changed
documents; and asks for modal approval before applying and saving. It does not parse or
rewrite arbitrary JavaScript expressions. Core remains the authority that validates the
complete file before any later operation.

## Trust, privacy, and storage

- Untrusted workspaces show one explanatory item and run nothing.
- `rehearsal.configPath` is resource-scoped and must resolve inside its workspace folder.
- `rehearsal.inspectionTimeoutSeconds` is resource-scoped, bounded to 15–300 seconds, and
  changes only read-only inspection timeouts.
- The extension stores no credentials, raw rows, baseline contents, source URLs, or CLI
  responses.
- Resource-scoped workbench preferences contain only filters, sorting, selected display
  target/profile, and a validated loopback URL. A bounded 20-entry activity list stores
  action label, timestamps, outcome, and exit code only. Workspace identities are hashed
  before use as storage keys.
- The output channel records only bounded lifecycle summaries and stable error codes.
- Telemetry is absent. Settings Sync may carry only the optional relative config path and
  bounded inspection timeout.

## Commercial boundary

The extension supports a manually fulfilled 14-day evaluation and per-user commercial
preview without telemetry, an account, or a hosted license service. The accepted order is
the entitlement record. License failure or expiration never changes Rehearsal core and
cannot block CLI recovery. Automated checkout, entitlement enforcement, Marketplace
publication, pricing, and refunds remain separately reviewed operational decisions.
