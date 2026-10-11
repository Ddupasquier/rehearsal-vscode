# Commercial preview readiness

## Recommended first offer

Sell a small, manually fulfilled early-access preview before building billing or a license
service. The free MIT Rehearsal CLI remains complete; customers pay for the polished VS
Code workflow, preview updates, and priority feedback handling.

Working hypothesis to validate—not a public commitment:

- 14-day evaluation;
- USD $49 per developer as a founding one-time license;
- 12 months of preview updates;
- best-effort support with no SLA; and
- a 14-day refund window stated by the checkout provider.

Limit the first cohort to 25 developers. Record purchase, activation, first successful
rehearsal, repeat use, support time, refund requests, and the reason each buyer paid. Do not
collect project contents, database data, credentials, or automatic telemetry.

## Distribution

For the first cohort, deliver the exact reviewed VSIX and SHA-256 after payment. A private
VSIX installation does not auto-update, so every delivery must state the version, checksum,
supported core range, update instructions, and support route. Do not email a rebuilt file
under the same version.

Marketplace publication can follow once the publisher identity, public support contact,
checkout/entitlement route, refund terms, and update process are approved. Marketplace
metadata may label an extension `Free` or `Trial`; it does not replace checkout or license
management.

## Release gate

Before accepting money:

- obtain a legal review of `LICENSE`, privacy language, refund terms, and seller identity;
- choose a customer-facing support email and payment/merchant-of-record provider;
- run `npm run check`, Test Lab integration, commercial packaging verification, and one
  reviewed real-consumer flow against the exact artifacts;
- record the exact VSIX/core checksums and preserve the tested files;
- confirm installation, upgrade, uninstall, offline use, expired evaluation behavior, and
  recovery without the extension; and
- publish no claims that exceed the tested macOS/Linux, desktop VS Code, PostgreSQL, and
  Supabase boundary.

The commercial preview is not a stable release, enterprise product, compliance claim,
hosted service, or production support contract.
