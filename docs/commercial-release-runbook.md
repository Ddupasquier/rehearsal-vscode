# Extension release runbook

The [commercial-readiness guide](commercial-readiness.md) owns the planned tier matrix.
Versions supplied with the [Starter license](../LICENSE) permit indefinite no-charge
personal and commercial development use of all included features, without a trial,
account or activation. Pro remains unimplemented. Historical previews retain their
bundled terms and checksums. This runbook grants no release or legal authority.

## Choose the release route

- **Starter technical distribution:** no paid cohort or payment setup is required.
  Preserve the approved Starter grant and support/privacy information. Marketplace publication separately needs
  owner approval, verified publisher identity, account security and recovery controls.
- **Pro paid launch:** additionally approve price, trial trigger/duration, update term,
  seller identity, checkout/refunds, support and the chosen entitlement/offline behavior.
  Verify expiry/license-loss recovery and continued Starter/CLI access before charging.
  The first entitlement rollout must also include the owner-only complimentary-grant
  flow in the edition guide; gifts must not require checkout or count as paid conversion.

Neither route changes the complete MIT CLI. Public GitHub distribution does not imply
Marketplace or paid-launch approval. Do not describe a planned tier as enforced today.

For public Markdown-only maintenance outside artifact qualification, use
`npm run docs:check`. Existing CI jobs run that proof once on Node 24 without
repackaging the extension. Runtime, configuration, dependencies, tooling, mixed or
uncertain changes retain full checks; manual and release verification keep their
existing coverage. Required check names and publication approvals remain unchanged.

## Exact-artifact verification and delivery

1. Freeze one reviewed core artifact and one extension commit candidate. Record the
   selected release route and its separately approved terms. Prepare capability and
   roadmap copy before this freeze: update the README summary and compatibility guide
   where behavior changes, and prepare the matching
   [suite capability catalog](https://github.com/Ddupasquier/rehearsal-db/blob/main/docs/capabilities.md)
   and [public roadmap](https://github.com/Ddupasquier/rehearsal-db/blob/main/docs/roadmap.md)
   changes. Keep candidate additions labelled unreleased until publication is verified.
2. Run `npm run check` and `npm run commercial:verify`. The latter checks bundled
   documents and metadata, not checkout, legal approval or entitlement behavior.
3. Run `npm run test:lab -- /absolute/path/to/core.tgz` and complete applicable
   real-consumer checks without changing that consumer's tracked files. Retain separate
   native/accessibility, security and manual gates; do not replace them with a green build.
4. Package once with `npm run package:vsix -- --out /absolute/path/to/rehearsal-VERSION.vsix`.
5. Verify that exact file with `npm run verify:vsix -- /absolute/path/to/rehearsal-VERSION.vsix`.
   Append the previous reviewed VSIX as the second path to verify an upgrade.
6. Confirm clean install, upgrade, rollback, uninstall and offline behavior. For Pro,
   also test the approved trial/entitlement failure paths and non-destructive recovery;
   unimplemented behavior remains a blocker for that launch, not passing evidence.
   Include complimentary issuance/import, repeat and invalid imports, explicit version/
   expiry rights, honest offline/revocation behavior and private issuer-key isolation.
7. Record extension/core versions, SHA-256 values, supported platforms, limitations and
   acceptance paths. Preserve the tested files and the previous reviewed rollback artifact.
   **README and documentation updates are required release deliverables.** Review the
   README, compatibility/installation guides, capability catalog, roadmap and release
   notes with every release, including releases whose feature scope is unchanged.
   Each shipped claim must match the exact qualified artifact; queued, planned and
   paused work retains its own status.
8. Have the owner review the diff, exact evidence, release copy, license/privacy/support
   documents and the chosen route's additional requirements.
9. Only after separate delivery approval, commit and distribute or publish the exact
   tested file. Marketplace and paid-launch authorization remain distinct.
   Verify actual availability and artifact identity in the selected public channel,
   then coordinate updates to the catalog's published version, verification date,
   release links and the [public installation guide](https://github.com/Ddupasquier/rehearsal-db/blob/main/docs/vscode.md).
   A GitHub-only release stays distinct from Marketplace availability. Publish these
   availability updates as documentation changes; never rebuild the frozen VSIX to
   refresh its README. Update only the component and scope actually released.
   **Do not mark the release complete until its documentation updates are published
   and the public README, capability, installation and roadmap pages are verified.**
   Publication of the VSIX alone does not complete the release.

Never rebuild after approval and present new bytes under an old checksum. Never put
signing keys, payment secrets, customer details or license records in Git.

## Native extension update recovery

The existing opt-in updater verifier takes an exact private candidate, an older reviewed
canonical public VSIX, the reviewed official target VSIX, and an existing Code runtime.
Supply absolute canonical artifact paths inside approved development storage and all
four SHA-256 values. On this machine, run it through the suite launcher:

```sh
../run editor node --import tsx scripts/native/verify-automatic-updates.ts \
  --candidate=/absolute/candidate.vsix --candidate-sha=CANDIDATE_SHA256 \
  --previous=/absolute/previous.vsix --previous-sha=PREVIOUS_SHA256 \
  --target=/absolute/official-target.vsix --target-sha=TARGET_SHA256 \
  --code=/absolute/Code/bin/code --electron=/absolute/Code/code \
  --electron-sha=ELECTRON_SHA256 --code-version=EXACT_CODE_VERSION
```

Use the actual paired application paths on macOS: `Contents/Resources/app/bin/code`
and the bundle's `CFBundleExecutable` under `Contents/MacOS/` (for example, `Code`).
This command installs only into generated private Code directories; it does not
download/install Code, target the normal editor profile,
install a CLI package or start a database. The historical installer lane downloads its
target through the unchanged official verified downloader. macOS retains its normal
memory-pressure guard. Linux requires an existing working display and sandbox setup;
native Windows remains outside this verifier's scope.

A preflight pressure refusal allocates no test fixture or report and launches no native
Code host; retry explicitly after pressure returns to normal. A later pressure refusal
retains already allocated fixture/recovery state.

By default, the three sequential native hosts keep their evidence separate:

- The exact candidate activates from its installed payload. Real child-process
  reservations exercise recovery/refusal; real native warning buttons open Extensions
  and Settings and return to Rehearsal. Synthetic future metadata is used only for the
  blocked warning, before artifact download.
- Candidate installer modules run against the actual older installed version/path and
  install the official newer target. The installed extension's own automatic options
  stay off to prevent a competing updater. Explicit fixture permission exercises the
  installer component, not the complete saved-opt-in/startup flow.
- Restarting only that disposable profile loads the exact official target and proves
  recovery of a deliberately abandoned dispatched reservation. This crash-state fixture
  does not claim that VS Code actually crashed during the preceding install.

For a missing proof, `--lanes=candidate` runs only the candidate host;
`--lanes=historical` runs the install and restart hosts in the same disposable profile.
`--lanes=all` is the default. Reports count only the selected hosts actually completed;
they do not import earlier passes. Retain separately verified evidence with the same
artifact hashes and runtime pin for omitted lanes. A failed or missing required lane
still blocks qualification.

Reports and silent screenshots go under `test-results/automatic-updates-231.*`.
After preflight, the verifier creates its report parent in a fresh checkout and
refuses a redirected path; no prior test run or temporary-directory fallback is needed.
Every installed payload file must match its selected frozen VSIX, allowing only Code's
manifest installation metadata. Clean owned processes may be retired after validated
finalization; fixtures are removed only after the complete verifier succeeds. Dirty,
missing or unconfirmed finalization retains the host and profile, and failed fixture
state remains available for recovery.
A private candidate sharing a public version has a distinct checksum and is never a
replacement public artifact. This verifier does not establish a complete candidate
activation upgrade, native accessibility, CLI automatic updates or database behavior.
Qualification and publication still follow the existing exact-artifact release steps.

## Maintained packaging dependency

VSCE 4.0.0 currently resolves Azure Identity's affected MSAL Node 6.x range.
The exact development-only `@azure/msal-node` 7.1.1 override addresses
[GHSA-xcx6-jx8p-x3h5](https://github.com/AzureAD/microsoft-authentication-library-for-js/security/advisories/GHSA-xcx6-jx8p-x3h5)
without downgrading the packager or suppressing the dependency audit. It affects
development/publishing tooling only; VSCE is this repository's sole consumer and
dependencies are excluded from the VSIX. The override is flat because npm 10's
clean installer rejects the nested VSCE/Identity override's otherwise valid npm 11
lockfile. Keep the ordinary clean install and audit checks on Node 22/24/26.

MSAL 7 changes interactive browser response-mode handling. VSCE's current Azure
credential chain is noninteractive and does not use that removed option. Verify
the installed dependency graph, network-disabled synthetic client-secret path,
existing packaging/installed-artifact checks and full audit when changing this
pin. This does not certify real Microsoft authentication or grant publisher access.
Remove the override when the maintained VSCE/Azure Identity range accepts
a fixed version, after reviewing the resulting lockfile and running those checks.
