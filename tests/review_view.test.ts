import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import {
  parseAuthenticationReview,
  parseBaselineScopeReview,
} from "../src/review_contract.js";
import {
  renderAuthenticationReview,
  renderBaselineScopeReview,
} from "../src/review_view.js";

const snapshot = (): ProjectSnapshot => ({
  workspaceName: "example",
  workspaceRoot: "/private/example",
  availability: "ready",
});
describe("baseline and auth review presentation", () => {
  it("gives usable legacy/empty guidance without guessed facts", () => {
    expect(renderBaselineScopeReview(snapshot())).toContain(
      "No verified baseline yet",
    );
    expect(renderAuthenticationReview(snapshot())).toContain("unavailable");
    expect(renderAuthenticationReview(snapshot())).not.toContain(
      "login passed",
    );
  });
  it("shows privacy policy decisions and exclusion warnings with no row/recipe values", () => {
    const review = parseBaselineScopeReview({
      schemaVersion: 1,
      provider: "supabase",
      policy: { version: 2, sha256: "a".repeat(64), state: "baseline-bound" },
      tables: [
        {
          schema: "app",
          name: "widgets",
          included: true,
          rowCount: 5,
          columnCount: 1,
          relationshipCount: 1,
          identityColumnCount: 0,
          transformations: {
            KEEP: 0,
            PSEUDONYMIZE: 1,
            REPLACE: 0,
            EXCLUDE: 0,
            DERIVE: 0,
          },
        },
      ],
      relationships: {
        declaredCount: 1,
        excludedReferenceCount: 1,
        verification: "declared-not-runtime-verified",
      },
      storage: { assetCount: 0, bytes: 0, buckets: [] },
      decisions: {
        sourcePermission: "configured-not-contacted",
        identityHandling: "no-association-policy",
        replacement: "separate-core-confirmation",
      },
      privacy: {
        rowValuesIncluded: false,
        credentialsIncluded: false,
        sourceContacted: false,
      },
    });
    const html = renderBaselineScopeReview({
      ...snapshot(),
      baseline: {
        generationId: "generation",
        createdAt: null,
        rowCount: 5,
        tableCount: 1,
        migrationCount: 1,
        verification: "checksums_verified",
        review,
      },
    });
    expect(html).toContain("app.widgets");
    expect(html).toContain("references point to excluded tables");
    expect(html).toContain("did not contact or authorize a source");
    expect(html).toContain("separate core confirmation");
    expect(html).toMatch(
      /<div class="readiness-summary">\s+<span>1 included tables<\/span>\s+<span>0 excluded tables<\/span>\s+<span>1 schemas<\/span>\s+<\/div>/u,
    );
    expect(html).not.toContain("/private");
  });
  it("makes provider, MFA and identity review distinct from login proof", () => {
    const review = parseAuthenticationReview({
      schemaVersion: 1,
      target: "supabase",
      providers: [
        { name: "google", enabled: false, source: "template", supported: true },
      ],
      callback: null,
      identityAssociation: "not-configured",
      mfa: {
        totpEnrollment: true,
        totpVerification: null,
        enforcement: "application-owned-not-verified",
      },
      verification: "configuration-only",
      privacy: {
        credentialsIncluded: false,
        environmentFilesRead: false,
        authenticationAttempted: false,
      },
    });
    const html = renderAuthenticationReview({
      ...snapshot(),
      authenticationReview: review,
    });
    expect(html).toContain("Disabled");
    expect(html).toContain("Not determined");
    expect(html).toContain("account blocking");
    expect(html).toContain("reset");
    expect(html).toContain("does not prove enforcement");
    expect(html).toContain(
      "Core derives this endpoint from the local Auth API",
    );
    expect(html).toContain("Review application return paths separately");
    expect(html).not.toContain("login passed");
  });
  it("does not pretend PostgreSQL provides native Supabase authentication", () => {
    const review = parseAuthenticationReview({
      schemaVersion: 1,
      target: "postgresql",
      providers: [],
      callback: null,
      identityAssociation: "not-configured",
      mfa: {
        totpEnrollment: null,
        totpVerification: null,
        enforcement: "application-owned-not-verified",
      },
      verification: "configuration-only",
      privacy: {
        credentialsIncluded: false,
        environmentFilesRead: false,
        authenticationAttempted: false,
      },
    });
    expect(
      renderAuthenticationReview({
        ...snapshot(),
        authenticationReview: review,
      }),
    ).toContain("no native Supabase Auth service");
  });
});
