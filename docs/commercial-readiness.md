# Commercial readiness and planned tiers

This guide owns the approved product model: a complete free MIT CLI, a useful free
VS Code Starter, and future optional paid Pro editor productivity. The current
[Starter license](../LICENSE) aligns rights for versions distributed with it; the Pro
boundary remains a plan, not a claim that paid features or a paid launch are ready.

## Planned tier matrix

| Tier                      | Included workflow                                                                                                                                                                                                      | Boundary                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Free CLI                  | The complete Rehearsal engine and all supported commands.                                                                                                                                                              | MIT-licensed; no extension purchase, account or entitlement required.                                                                                      |
| Free VS Code Starter      | All editor features included in the Starter-licensed version, including setup, migration/resource review, configuration tools, profiles, comparisons, reports, runtime controls, authentication guidance and recovery. | Indefinite no-charge personal and commercial development use; no account, purchase, card, trial or activation. Safety and recovery are never paid unlocks. |
| Optional paid VS Code Pro | Future separately identified, additive editor productivity, such as richer saved review workspaces or expanded comparative/history workflows beyond the included Starter features.                                     | Not implemented or approved feature-by-feature. It cannot restrict already-granted Starter versions or make core database capabilities exclusive to Pro.   |
| Later Team / Enterprise   | Shared organizational workflows and administration, if validated demand supports them.                                                                                                                                 | Deferred; no current collaboration, governance, compliance or enterprise-support promise.                                                                  |

Free basics and the complete CLI are protected principles. Advanced Pro bundles are
candidates, not a final feature-by-feature paywall allocation or approval to remove or
restrict existing features.

**Every feature included in a Starter-licensed version is covered by its free grant.**
There is no trial clock, license activation, entitlement check or paid-feature switch.
The owner approved this Starter alignment; it does not approve future Pro terms, a
paywall, pricing, billing or publication. Existing accepted-order rights and support
remain in effect. Historical VSIX artifacts keep their bundled terms and immutable
checksums; publish a new reviewed Starter artifact rather than relabelling old bytes.

Any future Pro expiry, payment failure or offline state must preserve Starter workflows,
safe shutdown and CLI recovery; it must never delete or lock database data. Exact
entitlement, offline and downgrade behavior still needs design and acceptance tests.

## Required complimentary Pro access

The first Pro entitlement release must let the owner give selected people or organizations
Pro access without checkout, a payment card or a trial countdown. The intended flow is:

1. Open a private **Grant access** tool and enter the recipient.
2. Review Pro rights, named users/seats, covered versions/updates and any expiry. Allow
   non-expiring grants; that does not automatically promise every future major update.
3. Confirm issuance. The recipient imports one license file to activate the granted rights,
   without a purchase or a new billing account.

Use the normal verified entitlement with complimentary provenance, not a debug switch,
shared unlock code or allowlist in project configuration. Keep owner-only issuance,
signing keys and the minimal grant/reissue/revocation ledger private and outside Git.
Keep recipient details and license material out of URLs, logs and Settings Sync.
The distributed client must not be able to mint grants. Product access never grants
database credentials, organizational administration or permission to bypass safety checks.

Recipient names are not identity proof: choose and disclose bearer versus identity-bound
activation before implementation. Define seat, replacement, expiry and revocation behavior
honestly; an offline perpetual grant cannot be instantly revoked by changing a remote
record. Invalid or repeated imports must preserve existing valid access. Record gifts
separately from actual purchases and revenue.

This is a required capability in [the entitlement ticket](https://github.com/Ddupasquier/rehearsal-db/issues/85),
not an implemented issuer or a new license grant. Legal terms and the exact entitlement
design still need review. No hosted billing service is required just to give access.

## Decisions still required

- Pro price and purchase model; trial trigger and duration.
- Included update term, refunds, seller/support ownership and checkout provider.
- Whether enforcement is needed, how it works offline, and recovery after license loss.
- Future Pro license terms and accurate distribution metadata for the selected route.

Validate why developers would pay and whether they return to the workflow before adding
Team/Enterprise or hosted billing infrastructure. Use voluntary feedback and separately
approved customer records, not automatic telemetry, project contents or database data.

## Distribution and release gates

**Starter technical distribution** can proceed independently of a paid cohort. The
Starter grant requires no payment service or future Pro seller/refund decision. Public
GitHub prereleases already exist; a new Starter artifact needs its own exact release
approval. Marketplace publication still needs separate approval,
publisher/account recovery controls, reviewed license/privacy/support information and
tested installation, upgrade, rollback, uninstall and offline behavior. A Marketplace
`Free` or `Trial` label is metadata, not an entitlement system.

**Pro paid launch** additionally needs approved commercial terms, price, seller identity,
checkout/refund and support arrangements. Confirm the selected evaluation, entitlement,
expiry and offline behavior against exact artifacts before accepting money. No payment
flow or enforcement system is implemented by this document.

Both routes retain security review, `npm run check`, applicable Test Lab and real-consumer
acceptance, exact VSIX/core checksums, explicit limitations and owner release approval.
Every delivery identifies its version, supported core range, update and rollback path,
license and support route. Never replace an approved artifact with rebuilt bytes under
its old checksum. Follow the [release runbook](commercial-release-runbook.md).

Do not claim support beyond tested platforms/providers, or present the preview as a
stable release, hosted service, backup, compliance certification or production SLA.
