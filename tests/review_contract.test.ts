import { describe, expect, it } from "vitest";
import {
  parseAuthenticationReview,
  parseBaselineScopeReview,
  parseBaselineInspectionData,
  parseReviewTargets,
} from "../src/review_contract.js";
import type { ExplainData } from "../src/contracts.js";
import { parseEnvelope, parseJson } from "../src/contracts.js";

const scope = () => ({
  schemaVersion: 1,
  provider: "supabase",
  policy: { version: 2, sha256: "a".repeat(64), state: "baseline-bound" },
  tables: [
    {
      schema: "public",
      name: "widgets",
      included: true,
      rowCount: 1_000_000,
      columnCount: 2,
      relationshipCount: 1,
      identityColumnCount: 1,
      transformations: {
        KEEP: 1,
        PSEUDONYMIZE: 1,
        REPLACE: 0,
        EXCLUDE: 0,
        DERIVE: 0,
      },
      privateValue: "do-not-render",
    },
    {
      schema: "private",
      name: "widgets",
      included: false,
      rowCount: 0,
      columnCount: 1,
      relationshipCount: 0,
      identityColumnCount: 0,
      transformations: {
        KEEP: 0,
        PSEUDONYMIZE: 0,
        REPLACE: 0,
        EXCLUDE: 1,
        DERIVE: 0,
      },
    },
  ],
  relationships: {
    declaredCount: 1,
    excludedReferenceCount: 1,
    verification: "declared-not-runtime-verified",
  },
  storage: {
    assetCount: 2,
    bytes: 30,
    buckets: [{ name: "avatars", assetCount: 2, bytes: 30 }],
  },
  decisions: {
    sourcePermission: "configured-not-contacted",
    identityHandling: "reviewed-policy-configured",
    replacement: "separate-core-confirmation",
  },
  privacy: {
    rowValuesIncluded: false,
    credentialsIncluded: false,
    sourceContacted: false,
  },
});
const auth = () => ({
  schemaVersion: 1,
  target: "supabase",
  providers: [
    {
      name: "google",
      enabled: true,
      source: "declarative",
      supported: true,
      secret: "must-not-copy",
    },
    { name: "github", enabled: false, source: "template", supported: true },
    { name: "email", enabled: null, source: "unavailable", supported: true },
    { name: "custom", enabled: true, source: "template", supported: false },
  ],
  callback: "http://127.0.0.1:58321/auth/v1/callback",
  identityAssociation: "reviewed-policy-configured",
  mfa: {
    totpEnrollment: true,
    totpVerification: true,
    enforcement: "application-owned-not-verified",
  },
  verification: "configuration-only",
  privacy: {
    credentialsIncluded: false,
    environmentFilesRead: false,
    authenticationAttempted: false,
  },
});
describe("public baseline scope review", () => {
  it.each([1, 2])(
    "retains strict privacy attestations through normalized v%s baseline JSON roundtrips",
    (version) => {
      const raw = scope();
      raw.policy.version = version;
      const normalized = parseBaselineScopeReview(raw);
      expect(
        parseBaselineScopeReview(JSON.parse(JSON.stringify(normalized))),
      ).toEqual(normalized);
      expect(normalized.privacy).toEqual({
        rowValuesIncluded: false,
        credentialsIncluded: false,
        sourceContacted: false,
      });
      const baseline = {
        generationId: "generation-1",
        createdAt: "2026-10-13T12:00:00Z",
        migrationCutoff: "20261001000000",
        rowCount: 1_000_000,
        tableCount: 1,
        migrationCount: 2,
        verification: "checksums_verified",
        sanitizationPolicySha256: "a".repeat(64),
        review: raw,
      };
      const parsed = parseBaselineInspectionData(baseline);
      expect(JSON.stringify(parsed.review)).not.toContain("do-not-render");
      expect(
        parseBaselineInspectionData(JSON.parse(JSON.stringify(parsed))),
      ).toEqual(parsed);
    },
  );
  it("roundtrips scope and authentication reviews through the public JSON envelope boundary", () => {
    const wire = JSON.stringify({
      schemaVersion: 1,
      rehearsalVersion: "0.1.0-rc.4",
      command: "inspect baseline",
      status: "success",
      data: { review: scope(), authenticationReview: auth() },
    });
    const envelope = parseEnvelope<{
      review: unknown;
      authenticationReview: unknown;
    }>(parseJson(wire), "inspect baseline");
    if (envelope.status === "error")
      throw new Error("Unexpected error envelope.");
    const normalized = {
      review: parseBaselineScopeReview(envelope.data.review),
      authenticationReview: parseAuthenticationReview(
        envelope.data.authenticationReview,
      ),
    };
    const replay = parseEnvelope<typeof normalized>(
      parseJson(JSON.stringify({ ...envelope, data: normalized })),
      "inspect baseline",
    );
    if (replay.status === "error")
      throw new Error("Unexpected error envelope.");
    expect(parseBaselineScopeReview(replay.data.review)).toEqual(
      normalized.review,
    );
    expect(parseAuthenticationReview(replay.data.authenticationReview)).toEqual(
      normalized.authenticationReview,
    );
    expect(JSON.stringify(normalized)).not.toMatch(
      /do-not-render|must-not-copy/u,
    );
  });
  it.each([undefined, null, "[REDACTED]", "false", true, {}])(
    "refuses unavailable or unsafe credential attestations: %s",
    (value) => {
      const raw = scope();
      (raw.privacy as Record<string, unknown>).credentialsIncluded = value;
      expect(() => parseBaselineScopeReview(raw)).toThrow(/unsafe/u);
      const authentication = auth();
      (authentication.privacy as Record<string, unknown>).credentialsIncluded =
        value;
      expect(() => parseAuthenticationReview(authentication)).toThrow(
        /unsafe/u,
      );
    },
  );
  it("preserves million-row, multi-schema, exclusion/Storage evidence without private values", () => {
    const result = parseBaselineScopeReview(scope());
    expect(result.tables[0]?.rowCount).toBe(1_000_000);
    expect(result.tables[1]?.schema).toBe("private");
    expect(result.storage.bytes).toBe(30);
    expect(JSON.stringify(result)).not.toContain("do-not-render");
  });
  it("binds scope and generations to the active baseline instead of accepting stale policy", () => {
    const baseline = {
      generationId: "generation-1",
      createdAt: "2026-10-13T12:00:00Z",
      migrationCutoff: "20261001000000",
      rowCount: 1_000_000,
      tableCount: 1,
      migrationCount: 2,
      verification: "checksums_verified",
      sanitizationPolicySha256: "a".repeat(64),
      review: scope(),
    };
    expect(parseBaselineInspectionData(baseline).rowCount).toBe(1_000_000);
    expect(
      parseBaselineInspectionData(baseline).sourceSchemaSha256,
    ).toBeUndefined();
    expect(
      parseBaselineInspectionData({ ...baseline, sourceSchemaSha256: null })
        .sourceSchemaSha256,
    ).toBeNull();
    expect(
      parseBaselineInspectionData({
        ...baseline,
        sourceSchemaSha256: "c".repeat(64),
      }).sourceSchemaSha256,
    ).toBe("c".repeat(64));
    expect(() =>
      parseBaselineInspectionData({
        ...baseline,
        sourceSchemaSha256: "PRIVATE_SCHEMA_CANARY",
      }),
    ).toThrow("Source schema hash");
    expect(() =>
      parseBaselineInspectionData({
        ...baseline,
        sanitizationPolicySha256: "b".repeat(64),
      }),
    ).toThrow(/contradict/u);
    expect(() =>
      parseBaselineInspectionData({ ...baseline, rowCount: 1 }),
    ).toThrow(/contradict/u);
    expect(() =>
      parseBaselineInspectionData({ ...baseline, generations: [] }),
    ).toThrow(/contradict/u);
    expect(() =>
      parseBaselineInspectionData({
        ...baseline,
        rowCount: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(/safe integer/u);
  });
  it("fails closed on unknown target providers and invalid configuration fingerprints", () => {
    const plan = {
      config: {
        schemaVersion: 1,
        path: "rehearsal.config.mjs",
        project: "sample",
        sha256: "a".repeat(64),
      },
      environment: {
        target: "supabase",
        applicationUrl: "http://localhost:5175",
      },
    } as ExplainData;
    expect(parseReviewTargets(plan)[0]?.configurationSha256).toBe(
      "a".repeat(64),
    );
    expect(() =>
      parseReviewTargets({
        ...plan,
        environment: { ...plan.environment, target: "unknown" },
      }),
    ).toThrow(/unsupported/u);
    expect(() =>
      parseReviewTargets({
        ...plan,
        config: { ...plan.config, sha256: "not-a-hash" },
      }),
    ).toThrow(/SHA-256/u);
  });
  it.each(["baseline.review", "baselineReview"] as const)(
    "refuses %s provider evidence that contradicts the reviewed target",
    (location) => {
      const reviewed = scope();
      const inspected = parseBaselineInspectionData({
        generationId: "generation-provider-control",
        createdAt: "2026-10-16T00:00:00Z",
        migrationCutoff: "20261001000000",
        rowCount: 1_000_000,
        tableCount: 1,
        migrationCount: 2,
        verification: "checksums_verified",
        sanitizationPolicySha256: reviewed.policy.sha256,
        ...(location === "baseline.review" ? { review: reviewed } : {}),
      });
      const plan: ExplainData = {
        config: {
          schemaVersion: 1,
          path: "rehearsal.config.mjs",
          project: "provider-control",
        },
        environment: {
          target: "supabase",
          applicationUrl: "http://localhost:5175",
        },
        baseline: inspected,
        ...(location === "baselineReview" ? { baselineReview: reviewed } : {}),
      };
      // Positive control: the scope and baseline are valid for this provider.
      expect(parseReviewTargets(plan)[0]?.provider).toBe("supabase");
      // Only the separately supplied target/provider changes; hashes and rows
      // still match, so those checks cannot substitute for provider binding.
      expect(() =>
        parseReviewTargets({
          ...plan,
          environment: { ...plan.environment, target: "postgresql" },
        }),
      ).toThrow(/provider|contradict/iu);
    },
  );
  it("binds independently inspected scope to its separately reviewed provider", () => {
    const reviewed = scope();
    const baseline = {
      generationId: "generation-independent-provider",
      createdAt: "2026-10-16T00:00:00Z",
      migrationCutoff: "20261001000000",
      rowCount: 1_000_000,
      tableCount: 1,
      migrationCount: 2,
      verification: "checksums_verified",
      sanitizationPolicySha256: reviewed.policy.sha256,
      review: reviewed,
    };
    expect(
      parseBaselineInspectionData(baseline, "supabase").review,
    ).toBeDefined();
    expect(() => parseBaselineInspectionData(baseline, "postgresql")).toThrow(
      /provider.*contradict/iu,
    );
    // Legacy baseline metadata has no scope-provider claim to cross-bind.
    const { review: _review, ...legacy } = baseline;
    expect(
      parseBaselineInspectionData(legacy, "postgresql").review,
    ).toBeUndefined();
  });
  it("binds the named primary target to the top-level provider without flattening dependents", () => {
    const plan: ExplainData = {
      config: {
        schemaVersion: 1,
        path: "rehearsal.config.mjs",
        project: "fixture",
      },
      environment: {
        target: "postgresql",
        applicationUrl: "http://localhost:5175",
      },
    };
    const primary = { name: "primary", plan };
    const dependent = {
      name: "publication",
      plan: {
        ...plan,
        environment: { ...plan.environment, target: "supabase" },
      },
    };
    expect(
      parseReviewTargets({ ...plan, targets: [primary, dependent] }).map(
        (target) => target.provider,
      ),
    ).toEqual(["postgresql", "supabase"]);
    expect(() => parseReviewTargets({ ...plan, targets: [dependent] })).toThrow(
      /primary/iu,
    );
    expect(() =>
      parseReviewTargets({ ...plan, targets: [dependent, primary] }),
    ).toThrow(/primary/iu);
    expect(() =>
      parseReviewTargets({
        ...plan,
        targets: [{ name: "primary", plan: dependent.plan }],
      }),
    ).toThrow(/provider.*contradict/iu);
  });
  it("accepts empty baseline aggregates without manufacturing hidden data", () => {
    const input = scope();
    input.tables = [];
    input.relationships.declaredCount = 0;
    input.relationships.excludedReferenceCount = 0;
    input.storage = { assetCount: 0, bytes: 0, buckets: [] };
    expect(parseBaselineScopeReview(input).tables).toEqual([]);
  });
  it.each(["rowValuesIncluded", "credentialsIncluded", "sourceContacted"])(
    "rejects unsafe %s",
    (field) => {
      const input = scope();
      (input.privacy as Record<string, unknown>)[field] = true;
      expect(() => parseBaselineScopeReview(input)).toThrow(/unsafe/u);
    },
  );
  it("rejects conflicting table/relationship/Storage totals and unbounded scope", () => {
    const input = scope();
    input.tables[0]!.transformations.KEEP = 2;
    expect(() => parseBaselineScopeReview(input)).toThrow(/contradict/u);
    const rows = scope();
    rows.tables[1]!.rowCount = 1;
    expect(() => parseBaselineScopeReview(rows)).toThrow(/contradict/u);
    const assets = scope();
    assets.storage.bytes = 31;
    expect(() => parseBaselineScopeReview(assets)).toThrow(/contradict/u);
    expect(() =>
      parseBaselineScopeReview({
        ...scope(),
        tables: Array.from({ length: 10_001 }, () => scope().tables[0]),
      }),
    ).toThrow(/bounded/u);
  });
});
describe("public authentication review", () => {
  it("keeps normalized false attestations idempotent without claiming missing MFA evidence", () => {
    const normalized = parseAuthenticationReview({
      ...auth(),
      mfa: { ...auth().mfa, totpEnrollment: null, totpVerification: null },
    });
    expect(
      parseAuthenticationReview(JSON.parse(JSON.stringify(normalized))),
    ).toEqual(normalized);
    expect(normalized.mfa.totpEnrollment).toBeNull();
    expect(normalized.privacy).toEqual({
      credentialsIncluded: false,
      environmentFilesRead: false,
      authenticationAttempted: false,
    });
  });
  it("distinguishes enabled, disabled, unknown and unsupported providers and strips secrets", () => {
    const result = parseAuthenticationReview(auth());
    expect(result.providers.map(({ enabled }) => enabled)).toEqual([
      true,
      false,
      null,
      true,
    ]);
    expect(result.providers[3]?.supported).toBe(false);
    expect(JSON.stringify(result)).not.toContain("must-not-copy");
    expect(result.verification).toBe("configuration-only");
  });
  it.each([
    "https://production.example/auth/v1/callback",
    "http://token@localhost:58321/auth/v1/callback",
    "http://localhost:58321/auth/v1/callback?token=secret",
  ])("refuses unsafe callback %s", (callback) => {
    expect(() => parseAuthenticationReview({ ...auth(), callback })).toThrow(
      /local public callback/u,
    );
  });
  it("accepts IPv6 local callbacks and explicit unavailable state", () => {
    expect(
      parseAuthenticationReview({
        ...auth(),
        callback: "http://[::1]:58321/auth/v1/callback",
      }).callback,
    ).toBe("http://[::1]:58321/auth/v1/callback");
    expect(
      parseAuthenticationReview({ ...auth(), callback: null }).callback,
    ).toBeNull();
  });
  it("refuses fabricated MFA enforcement, duplicate providers and contradictory detection", () => {
    expect(() =>
      parseAuthenticationReview({
        ...auth(),
        mfa: { ...auth().mfa, enforcement: "verified" },
      }),
    ).toThrow(/unsupported/u);
    const input = auth();
    input.providers[0]!.enabled = false;
    expect(() => parseAuthenticationReview(input)).toThrow(/contradicts/u);
    expect(() =>
      parseAuthenticationReview({
        ...auth(),
        providers: [auth().providers[0], auth().providers[0]],
      }),
    ).toThrow(/duplicated/u);
  });
});

describe("baseline format compatibility", () => {
  const baseline = {
    generationId: "generation-3",
    createdAt: null,
    migrationCutoff: "20261001000000",
    rowCount: 1,
    tableCount: 1,
    migrationCount: 1,
    verification: "checksums_verified",
  };
  it.each([1, 2, 3])(
    "accepts verified baseline format%s without reinterpreting prior formats",
    (formatVersion) => {
      expect(
        parseBaselineInspectionData({
          ...baseline,
          formatVersion,
          ...(formatVersion === 3
            ? {
                nativeMigrations: {
                  schemaVersion: 1,
                  kind: "prisma",
                  version: "7.10.1",
                  provider: "postgresql",
                  lockSha256: "a".repeat(64),
                  toolchainSha256: "b".repeat(64),
                },
              }
            : {}),
        }).formatVersion,
      ).toBe(formatVersion);
    },
  );
  it.each([0, 4, "3", null])(
    "refuses unknown baseline format%j",
    (formatVersion) => {
      expect(() =>
        parseBaselineInspectionData({ ...baseline, formatVersion }),
      ).toThrow();
    },
  );
});

describe("native baseline provenance", () => {
  const nativeMigrations = {
    schemaVersion: 1,
    kind: "prisma",
    version: "7.10.1",
    provider: "postgresql",
    lockSha256: "a".repeat(64),
    toolchainSha256: "b".repeat(64),
  };
  const baseline = {
    generationId: "generation-3",
    createdAt: null,
    migrationCutoff: "20261001000000",
    rowCount: 1,
    tableCount: 1,
    migrationCount: 1,
    verification: "checksums_verified",
    formatVersion: 3,
    nativeMigrations,
  };
  it("retains producer metadata without claiming it is the current execution toolchain", () => {
    expect(
      parseBaselineInspectionData(baseline, "postgresql").nativeMigrations,
    ).toEqual(nativeMigrations);
  });
  it("requires native metadata only for format3, including retained generations", () => {
    for (const raw of [
      { ...baseline, nativeMigrations: undefined },
      { ...baseline, formatVersion: 2 },
      { ...baseline, nativeMigrations: { ...nativeMigrations, extra: true } },
      {
        ...baseline,
        generations: [
          {
            ...baseline,
            active: true,
            storageAssetCount: 0,
            nativeMigrations: undefined,
          },
        ],
      },
    ])
      expect(() => parseBaselineInspectionData(raw)).toThrow();
    expect(() => parseBaselineInspectionData(baseline, "supabase")).toThrow();
  });
});
