import { describeMigrationCutoff } from "../migrations/native_migration_contract.js";
import type { ProjectSnapshot } from "../workspace/project_snapshot.js";

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const count = (value: number): string => value.toLocaleString("en-US");
const state = (value: boolean | null): string =>
  value === null ? "Not determined" : value ? "Enabled" : "Disabled";

export const renderBaselineScopeReview = (
  snapshot: ProjectSnapshot,
): string => {
  const review = snapshot.baseline?.review;
  if (!review)
    return `<div class="empty-state"><strong>${snapshot.baseline ? "Detailed scope is unavailable in this core release" : "No verified baseline yet"}</strong><p>${snapshot.baseline ? "Update Rehearsal to a core that returns baseline scope evidence, or review the tracked policies directly. Missing Storage and relationship facts are not treated as zero." : "Complete guided setup and review your safe local inputs. Rehearsal will show the reviewed policy and aggregate shape after baseline verification."}</p></div>`;
  const included = review.tables.filter((table) => table.included);
  const schemas = [...new Set(review.tables.map((table) => table.schema))];
  const decisions = [
    [
      "Source permission",
      review.decisions.sourcePermission === "local-inputs-only"
        ? "Local inputs only; no source connection was made."
        : "Source preparation is configured. This local review did not contact or authorize a source.",
    ],
    [
      "Identity handling",
      review.decisions.identityHandling === "reviewed-policy-configured"
        ? "An identity policy is configured. Each association still requires its reviewed core plan."
        : "No copied-account association policy is configured.",
    ],
    [
      "Baseline replacement",
      "Replacing the baseline requires a separate core confirmation; this review does not change it.",
    ],
  ];
  return `<div class="readiness-summary">
      <span>${count(included.length)} included tables</span>
      <span>${count(review.tables.length - included.length)} excluded tables</span>
      <span>${count(schemas.length)} schemas</span>
    </div>
    <dl class="detail-list"><div><dt>Provider</dt><dd>${review.provider}</dd></div><div><dt>Policy</dt><dd>Version ${review.policy.version} · baseline-bound</dd></div><div><dt>Policy SHA-256</dt><dd><code>${review.policy.sha256}</code></dd></div><div><dt>Migration boundary</dt><dd>${escape(describeMigrationCutoff(snapshot.baseline?.migrationCutoff))}</dd></div><div><dt>Relationships</dt><dd>${count(review.relationships.declaredCount)} declared; runtime enforcement is not asserted by inspection</dd></div><div><dt>Storage</dt><dd>${count(review.storage.assetCount)} files · ${count(review.storage.bytes)} bytes · ${count(review.storage.buckets.length)} buckets</dd></div></dl>
    ${review.relationships.excludedReferenceCount ? `<p class="surface-copy" role="note">Review needed: ${count(review.relationships.excludedReferenceCount)} declared references point to excluded tables. Review the policy and runtime relationship proof before replacement.</p>` : ""}
    <details class="technical-details"><summary>Review allowed and excluded tables</summary><div class="version-list">${review.tables.map((table) => `<article class="version-row"><span><strong>${escape(`${table.schema}.${table.name}`)}</strong><small>${table.included ? "Included" : "Excluded"} · ${count(table.columnCount)} declared columns</small></span><span><b>${count(table.rowCount)} baseline rows</b><small>${count(table.transformations.KEEP)} kept · ${count(table.transformations.PSEUDONYMIZE)} pseudonymous · ${count(table.transformations.REPLACE)} replaced · ${count(table.transformations.EXCLUDE)} excluded · ${count(table.transformations.DERIVE)} derived</small></span></article>`).join("")}</div></details>
    ${review.storage.buckets.length ? `<details class="technical-details"><summary>Review Storage buckets</summary><div class="version-list">${review.storage.buckets.map((bucket) => `<article class="version-row"><strong>${escape(bucket.name)}</strong><span>${count(bucket.assetCount)} files · ${count(bucket.bytes)} bytes</span></article>`).join("")}</div></details>` : ""}
    <details class="technical-details"><summary>Your privacy decisions</summary><dl class="detail-list">${decisions.map(([label, detail]) => `<div><dt>${label}</dt><dd>${detail}</dd></div>`).join("")}</dl><p>Transformation recipes, owner identifiers, private rows, credentials and source URLs are never displayed here. Scope changes belong in the reviewed policies and native preparation plan, not an unchecked table toggle.</p></details>`;
};

export const renderAuthenticationReview = (
  snapshot: ProjectSnapshot,
): string => {
  const review = snapshot.authenticationReview;
  if (!review)
    return `<div class="empty-state"><strong>Detailed authentication review is unavailable</strong><p>Configured provider names: ${escape(snapshot.environment?.authenticationProviders.join(", ") || "None declared")}. Update to a core that exposes provider-state evidence or review the local provider configuration. No login result is inferred.</p></div>`;
  if (review.target === "postgresql")
    return `<div class="empty-state"><strong>Authentication belongs to your application</strong><p>This PostgreSQL target has no native Supabase Auth service. Use your application's normal provider connection, server-only credentials and local callback. Rehearsal does not invent a login provider.</p></div>`;
  return `<div class="auth-grid">${review.providers.map((provider) => `<article class="control-card"><small>${escape(provider.name === "email" ? "Email / password" : provider.name)}</small><strong>${state(provider.enabled)}</strong><p>${provider.source === "declarative" ? "Detected in reviewed declarative configuration." : provider.source === "template" ? "Detected from public boolean settings in the local Supabase template." : "No unambiguous public declaration was available; missing evidence is not disabled."}</p>${provider.supported ? "" : "<p>Unsupported by Rehearsal’s reviewed provider connection contract. Configure and verify it separately; no equivalent behavior is guessed.</p>"}</article>`).join("")}
    <article class="control-card"><small>Provider callback</small><strong>${escape(review.callback ?? "Not determined")}</strong><p>Core derives this endpoint from the local Auth API. Register it in the provider console; it is not the application's browser or readiness URL. Review application return paths separately. Secrets stay server-owned and never enter this view.</p></article>
    <article class="control-card"><small>Copied-account association</small><strong>${review.identityAssociation === "reviewed-policy-configured" ? "Policy configured" : "Not configured"}</strong><p>Sign in through your normal application first. Core owns the exact identity plan, conflict refusal, idempotence, rollback and any confirmed transfer.</p></article>
    <article class="control-card"><small>TOTP / MFA</small><strong>Enrollment: ${state(review.mfa.totpEnrollment)}<br>Verification: ${state(review.mfa.totpVerification)}</strong><p>These are configuration facts. Your application and RLS must still enforce MFA and account blocks; inspection does not prove enforcement.</p></article></div>
    <details class="technical-details"><summary>Fresh-session verification checklist</summary><ol><li>Open the verified local sandbox and sign in using the ordinary application flow.</li><li>Review and confirm the native identity-association plan only when a policy is configured.</li><li>Repeat association to verify idempotence; verify copied ownership, history and signed files.</li><li>Use a fresh session to check token refresh, role/RLS isolation, account blocking and real AAL1/AAL2 enforcement.</li><li>Restart without reset and verify persistence. After an explicitly approved reset, verify that old sessions are invalidated.</li></ol><p>Real provider consent, chooser and login are manual checks unless separately observed. Merely enabling a provider does not mark any step passed.</p></details>`;
};
