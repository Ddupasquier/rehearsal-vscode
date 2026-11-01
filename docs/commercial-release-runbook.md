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

## Exact-artifact verification and delivery

1. Freeze one reviewed core artifact and one extension commit candidate. Record the
   selected release route and its separately approved terms.
2. Run `npm run check` and `npm run commercial:verify`. The latter checks bundled
   documents and metadata, not checkout, legal approval or entitlement behavior.
3. Run `npm run test:lab -- /absolute/private/fixture-manifest.json` against the
   exact installed Core package in a fresh parent-owned Lab fixture. The existing
   Lab `release-consumers` mode prepares and invokes this check in its two fresh
   rounds when supplied the exact reviewed `editor_commit`; its upgrade round
   retains separate coverage. The [adapter fixture contract](architecture.md#fresh-fixture-adapter-verification)
   owns the input and trust boundary. Complete applicable real-consumer checks
   without changing that consumer's tracked files. Retain separate
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
8. Have the owner review the diff, exact evidence, release copy, license/privacy/support
   documents and the chosen route's additional requirements.
9. Only after separate delivery approval, commit and distribute or publish the exact
   tested file. Marketplace and paid-launch authorization remain distinct.

Never rebuild after approval and present new bytes under an old checksum. Never put
signing keys, payment secrets, customer details or license records in Git.

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
