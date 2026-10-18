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
8. Have the owner review the diff, exact evidence, release copy, license/privacy/support
   documents and the chosen route's additional requirements.
9. Only after separate delivery approval, commit and distribute or publish the exact
   tested file. Marketplace and paid-launch authorization remain distinct.

Never rebuild after approval and present new bytes under an old checksum. Never put
signing keys, payment secrets, customer details or license records in Git.
