import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { previewThemeOverrides as themeOverrides } from "./preview-themes.js";
import type { ProjectDiscoveryData } from "../src/contracts.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import {
  parseAuthenticationReview,
  parseBaselineScopeReview,
} from "../src/review_contract.js";
import { parseMigrationReviewPlan } from "../src/migration_review.js";
import { parseConfigurationMetadata } from "../src/configuration_contract.js";
import {
  parseEnvironmentClassification,
  parseEnvironmentProvenance,
} from "../src/resource_contract.js";
import {
  parseOperationProgressSnapshot,
  renderOperationProgress,
} from "../src/operation_progress.js";
import {
  WORKSPACE_ACTION_IDS,
  type WorkspaceActionId,
} from "../src/action_catalog.js";
import {
  renderWorkspaceDocument,
  WORKSPACE_PAGES,
  type WorkspacePage,
} from "../src/workspace_view.js";

const repositoryRoot = resolve(__dirname, "..");
const host = "127.0.0.1";
const requestedPort = Number.parseInt(
  process.argv.find((argument) => argument.startsWith("--port="))?.slice(7) ??
    "4178",
  10,
);

if (
  !Number.isSafeInteger(requestedPort) ||
  requestedPort < 1 ||
  requestedPort > 65_535
) {
  throw new Error("Preview port must be an integer between 1 and 65535.");
}

const profile: ProjectDiscoveryData = {
  schemaVersion: 1 as const,
  project: { name: "rehearsal-test-lab", packageManifest: "present" as const },
  detected: [
    {
      category: "detected" as const,
      id: "package.manager",
      label: "Package manager",
      value: "npm",
      evidence: [
        {
          kind: "file" as const,
          source: "package-lock.json",
          detail: "npm lockfile is present.",
        },
      ],
    },
    {
      category: "detected" as const,
      id: "database.provider",
      label: "Database target",
      value: "PostgreSQL",
      evidence: [
        {
          kind: "file" as const,
          source: "docker-compose.yml",
          detail: "A local PostgreSQL service is declared.",
        },
      ],
    },
  ],
  suggested: [
    {
      category: "suggested" as const,
      id: "application.startCommand",
      label: "Application start command",
      value: "npm run dev",
      confidence: "high" as const,
      configPath: "application.startCommand",
      review: "Review the command before use.",
      evidence: [
        {
          kind: "manifest" as const,
          source: "package.json",
          detail: "The dev script starts the project application.",
        },
      ],
    },
  ],
  decisions: [
    {
      category: "decision" as const,
      id: "privacy.productionData",
      label: "Production data scope",
      value: "Requires review",
      question: "Which production-shaped rows may be copied?",
      reason: "Permission cannot be inferred.",
      evidence: [],
    },
  ],
  configuration: {
    state: "present_unvalidated" as const,
    activePath: "rehearsal.config.mjs",
    discoveredPaths: ["rehearsal.config.mjs"],
    fields: [
      {
        path: "application.startCommand",
        status: "suggested" as const,
        value: "npm run dev",
        sourceItemIds: ["application.startCommand"],
      },
      {
        path: "application.url",
        status: "present_unvalidated" as const,
        value: "http://localhost:5175",
        sourceItemIds: [],
      },
    ],
  },
  safety: {
    projectCodeExecuted: false,
    environmentFilesRead: false,
    databaseContacted: false,
    containerEngineStarted: false,
  },
};

const readySnapshot: ProjectSnapshot = {
  workspaceName: "Rehearsal Test Lab · synthetic preview",
  workspaceRoot: "/preview-only",
  availability: "ready",
  version: "0.1.0-rc.4",
  packageLocation: "node_modules/@rehearsal-db/core",
  configPath: "rehearsal.config.mjs",
  activity: {
    schemaVersion: 1,
    state: "idle",
    operation: null,
    recent: [
      {
        kind: "run",
        rehearsalVersion: "0.1.0-rc.4",
        progress: parseOperationProgressSnapshot({
          schemaVersion: 1,
          operationId: "7".repeat(64),
          state: "completed",
          startedAt: "2026-10-13T18:00:00.000Z",
          updatedAt: "2026-10-13T18:01:00.000Z",
          elapsedMilliseconds: 60_000,
          currentStage: null,
          completedStages: [
            {
              id: 1,
              phase: "runtime-lifecycle",
              target: "primary",
              state: "completed",
              startedAt: "2026-10-13T18:00:00.000Z",
              endedAt: "2026-10-13T18:00:40.000Z",
              durationMilliseconds: 40_000,
            },
            {
              id: 2,
              phase: "application-proof",
              target: "primary",
              state: "completed",
              startedAt: "2026-10-13T18:00:40.000Z",
              endedAt: "2026-10-13T18:01:00.000Z",
              durationMilliseconds: 20_000,
            },
          ],
          events: [
            {
              sequence: 1,
              code: "operation.started",
              phase: null,
              target: null,
              at: "2026-10-13T18:00:00.000Z",
            },
            {
              sequence: 2,
              code: "stage.started",
              phase: "runtime-lifecycle",
              target: "primary",
              at: "2026-10-13T18:00:00.000Z",
            },
            {
              sequence: 3,
              code: "stage.completed",
              phase: "runtime-lifecycle",
              target: "primary",
              at: "2026-10-13T18:00:40.000Z",
            },
            {
              sequence: 4,
              code: "stage.started",
              phase: "application-proof",
              target: "primary",
              at: "2026-10-13T18:00:40.000Z",
            },
            {
              sequence: 5,
              code: "stage.completed",
              phase: "application-proof",
              target: "primary",
              at: "2026-10-13T18:01:00.000Z",
            },
            {
              sequence: 6,
              code: "operation.completed",
              phase: null,
              target: null,
              at: "2026-10-13T18:01:00.000Z",
            },
          ],
          truncated: { stages: false, events: false },
        }),
      },
    ],
  },
  readiness: {
    state: "READY",
    passed: 4,
    failed: 0,
    checks: [
      {
        id: "node",
        label: "Node.js 24",
        status: "pass",
        detail: "Supported runtime detected.",
      },
      {
        id: "config",
        label: "Rehearsal configuration",
        status: "pass",
        detail: "Project configuration is present.",
      },
      {
        id: "baseline",
        label: "Verified baseline",
        status: "pass",
        detail: "Immutable baseline checksums are valid.",
      },
      {
        id: "docker",
        label: "Container engine",
        status: "pass",
        detail: "Docker remains stopped until an operation needs it.",
      },
    ],
  },
  baseline: {
    generationId: "20261011T000000Z-aaaaaaaaaaaa",
    createdAt: "2026-10-11T00:00:00.000Z",
    tableCount: 8,
    rowCount: 10_003,
    migrationCount: 4,
    verification: "checksums_verified",
    formatVersion: 2,
    migrationCutoff: "20261010000100",
    migrationHistorySha256: "b".repeat(64),
    sanitizationPolicySha256: "c".repeat(64),
    dataSha256: "d".repeat(64),
    review: parseBaselineScopeReview({
      schemaVersion: 1,
      provider: "postgresql",
      policy: { version: 2, sha256: "c".repeat(64), state: "baseline-bound" },
      tables: [
        ...[
          "widgets",
          "owners",
          "observations",
          "history",
          "assets",
          "tags",
          "widget_tags",
          "feature_flags",
        ].map((name, index) => ({
          schema: index > 5 ? "app" : "public",
          name,
          included: true,
          rowCount: [2, 1, 9000, 900, 3, 5, 10, 82][index],
          columnCount: 3,
          relationshipCount: 1,
          identityColumnCount: 1,
          transformations: {
            KEEP: 1,
            PSEUDONYMIZE: 1,
            EXCLUDE: 1,
            REPLACE: 0,
            DERIVE: 0,
          },
        })),
        {
          schema: "private",
          name: "raw_events",
          included: false,
          rowCount: 0,
          columnCount: 1,
          relationshipCount: 0,
          identityColumnCount: 0,
          transformations: {
            KEEP: 0,
            PSEUDONYMIZE: 0,
            EXCLUDE: 1,
            REPLACE: 0,
            DERIVE: 0,
          },
        },
      ],
      relationships: {
        declaredCount: 8,
        excludedReferenceCount: 0,
        verification: "declared-not-runtime-verified",
      },
      storage: {
        assetCount: 0,
        bytes: 0,
        buckets: [],
      },
      decisions: {
        sourcePermission: "local-inputs-only",
        identityHandling: "no-association-policy",
        replacement: "separate-core-confirmation",
      },
      privacy: {
        rowValuesIncluded: false,
        credentialsIncluded: false,
        sourceContacted: false,
      },
    }),
    generations: [
      {
        generationId: "20261011T000000Z-aaaaaaaaaaaa",
        createdAt: "2026-10-11T00:00:00Z",
        active: true,
        formatVersion: 2,
        rowCount: 10_003,
        tableCount: 8,
        migrationCount: 4,
        migrationCutoff: "20261010000100",
        storageAssetCount: 0,
      },
      {
        generationId: "20261010T000000Z-bbbbbbbbbbbb",
        createdAt: "2026-10-10T00:00:00Z",
        active: false,
        formatVersion: 2,
        rowCount: 9_987,
        tableCount: 8,
        migrationCount: 3,
        migrationCutoff: "20261009000100",
        storageAssetCount: 0,
      },
    ],
  },
  candidates: {
    count: 1,
    digest: "a".repeat(64),
    files: [
      {
        version: "20261011000100",
        name: "add_safe_index",
        filename: "20261011000100_add_safe_index.sql",
        sha256: "a".repeat(64),
        target: "primary",
      },
    ],
    targets: [
      { name: "primary", configPath: "supabase/config.toml", count: 1 },
    ],
  },
  runtime: {
    state: "running",
    targets: [
      {
        name: "primary",
        state: "running",
        reason: null,
        runtimeTarget: "postgresql",
        baselineGenerationId: "20261011T000000Z-aaaaaaaaaaaa",
        candidateSha256: "a".repeat(64),
        verifiedRuntimeAvailable: true,
        endpoint: {
          kind: "postgresql",
          host: "127.0.0.1",
          port: 55432,
          database: "postgres",
        },
      },
    ],
  },
  resources: {
    schemaVersion: 1,
    inspectedAt: "2026-10-13T18:37:00.000Z",
    engine: {
      state: "running",
      context: "colima",
      disk: {
        backend: "colima",
        totalBytes: 100 * 1024 ** 3,
        usedBytes: 28 * 1024 ** 3,
        availableBytes: 72 * 1024 ** 3,
        usedPercent: 28,
      },
      resources: [
        {
          type: "Images",
          totalCount: 24,
          activeCount: 14,
          size: "18.2GB",
          reclaimable: "6.4GB (35%)",
        },
        {
          type: "Local volumes",
          totalCount: 12,
          activeCount: 6,
          size: "9.2GB",
          reclaimable: "8.7GB (94%)",
        },
      ],
    },
    environments: [
      {
        target: "primary",
        projectId: "rehearsal-test-lab-postgresql-rehearsal",
        displayName: "Migration playground",
        protected: false,
        provider: "postgresql",
        configPath: "/preview-only/rehearsal.config.mjs",
        state: "running",
        containerCount: 1,
        runningContainerCount: 1,
        volumeCount: 1,
        diskUsageBytes: 44_440_000,
        cpuPercent: 1.25,
        memoryUsageBytes: 192 * 1024 ** 2,
        memoryLimitBytes: 2 * 1024 ** 3,
        createdAt: "2026-10-13T17:30:00.000Z",
        lastActivityAt: "2026-10-13T18:37:00.000Z",
        retention: "persistent",
        cleanupEligibility: "running",
        restartPolicies: ["no"],
        classification: parseEnvironmentClassification(
          {
            schemaVersion: 1,
            role: "configured-environment",
            dataPersistence: "preserved-on-stop",
            presence: { state: "created", reason: "owned-resources-observed" },
            receipt: {
              state: "compatible",
              reason: "supported-receipt-format-and-provider",
              scope: "format-and-provider-only",
            },
            review: {
              state: "due",
              reason: "observable-cutoff-exceeded",
              staleAfterSeconds: 3600,
              lastObservableActivityAt: "2026-10-13T17:30:00Z",
            },
          },
          "2026-10-13T18:37:00.000Z",
        )!,
        // Synthetic UI evidence only: no real runtime or receipt is inspected here.
        provenance: parseEnvironmentProvenance({
          schemaVersion: 1,
          inspectorVersion: "0.1.0-rc.4",
          verification: "recorded-not-reverified",
          configuredPorts: [
            { service: "database", host: "127.0.0.1", port: 55432 },
            { service: "application", host: "localhost", port: 5175 },
          ],
          runtime: {
            rehearsalVersion: "0.1.0-rc.3",
            versionReason: null,
            baselineGenerationId: "20261011T000000Z-aaaaaaaaaaaa",
            baselineDataSha256: "d".repeat(64),
            candidateSha256: "a".repeat(64),
            migrationReason: null,
          },
          runtimeReason: null,
        })!,
      },
    ],
    catalog: {
      schemaVersion: 1,
      images: [
        {
          id: `sha256:${"1".repeat(64)}`,
          service: "postgres",
          tags: ["public.ecr.aws/supabase/postgres:17.4.1"],
          digests: [
            `public.ecr.aws/supabase/postgres@sha256:${"a".repeat(64)}`,
          ],
          createdAt: "2026-09-01T00:00:00Z",
          bytes: 1_200_000_000,
          state: "candidate",
          reason:
            "Older official Supabase version with no container references. Eligible for exact-preview cleanup.",
          references: [],
        },
        {
          id: `sha256:${"2".repeat(64)}`,
          service: "storage-api",
          tags: ["public.ecr.aws/supabase/storage-api:v1.40.0"],
          digests: [],
          createdAt: "2026-09-15T00:00:00Z",
          bytes: 240_000_000,
          state: "candidate",
          reason:
            "Older official Supabase version with no container references. Eligible for exact-preview cleanup.",
          references: [],
        },
        {
          id: `sha256:${"3".repeat(64)}`,
          service: "postgres",
          tags: ["postgres:17-alpine"],
          digests: [],
          createdAt: "2026-10-01T00:00:00Z",
          bytes: 310_000_000,
          state: "in-use",
          reason:
            "Referenced by a running container. Preserved until the owning environment is discarded.",
          references: [
            {
              id: "example-primary-container",
              name: "migration-playground",
              running: true,
              ownership: "project",
            },
          ],
        },
        {
          id: `sha256:${"4".repeat(64)}`,
          service: "storage-api",
          tags: ["public.ecr.aws/supabase/storage-api:v1.41.0"],
          digests: [],
          createdAt: "2026-10-10T00:00:00Z",
          bytes: 250_000_000,
          state: "current",
          reason: "Newest cached service version is retained for reuse.",
          references: [],
        },
      ],
      volumes: [
        {
          name: "migration-playground-db-data",
          target: "primary",
          ownership: "project",
          purpose: "database",
          bytes: 44_440_000,
          createdAt: "2026-10-01T00:00:00Z",
          lastActivityAt: "2026-10-13T18:37:00Z",
          state: "attached",
          protected: false,
          containerCount: 1,
          reason:
            "Persistent database data. Remove it only through this environment's reviewed discard.",
        },
        {
          name: "example-app-storage",
          target: null,
          ownership: "other",
          purpose: "storage",
          bytes: 1_600_000_000,
          createdAt: "2026-09-01T00:00:00Z",
          lastActivityAt: null,
          state: "detached",
          protected: true,
          containerCount: 0,
          reason:
            "Owned by another project. Rehearsal will not delete this volume.",
        },
      ],
      otherContainers: [
        {
          id: "example-other-container",
          name: "another-project-api",
          running: true,
          ownership: "other",
          reason:
            "Another project's service contributes to shared capacity. Read only.",
        },
      ],
    },
    stale: { stoppedCount: 0, digest: null, targets: [] },
  },
  applicationUrl: "http://localhost:5175",
  reviewTargets: [
    {
      name: "primary",
      provider: "postgresql",
      configurationSha256: "e".repeat(64),
      baseline: {
        generationId: "20261011T000000Z-aaaaaaaaaaaa",
        formatVersion: 2,
        migrationCutoff: "20261010000100",
        migrationHistorySha256: "b".repeat(64),
        sanitizationPolicySha256: "c".repeat(64),
        dataSha256: "d".repeat(64),
        rowCount: 10003,
        tableCount: 8,
        migrationCount: 4,
        storageAssetCount: 0,
        storageBytes: 0,
      },
    },
  ],
  authenticationReview: parseAuthenticationReview({
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
  }),
  migrationReview: parseMigrationReviewPlan({
    schemaVersion: 1,
    candidateSha256: "a".repeat(64),
    candidateCount: 1,
    selection: "complete-ordered-suffix",
    targets: [
      {
        name: "primary",
        provider: "postgresql",
        baselineGenerationId: "20261011T000000Z-aaaaaaaaaaaa",
        candidateSha256: "a".repeat(64),
        entries: ["20261010000100", "20261011000100"].map((version, index) => ({
          id: `primary:${version}`,
          target: "primary",
          version,
          name: index ? "add_safe_index" : "create_widgets",
          filename: `${version}_${index ? "add_safe_index" : "create_widgets"}.sql`,
          sha256: (index ? "a" : "b").repeat(64),
          order: index,
          timestamp: version,
          status: index ? "candidate" : "represented_by_baseline",
          required: index === 1,
          dependsOn: index ? ["primary:20261010000100"] : [],
          warnings: index ? ["sql_safety_not_inferred"] : [],
          selectionReason: index
            ? "Required ordered suffix; skipping this migration would invalidate the exact candidate approval."
            : "Immutable baseline history; cannot be reordered or edited.",
        })),
      },
    ],
    safety: {
      readsSqlBodiesForSafety: false,
      executesSql: false,
      startsEngine: false,
    },
  }),
  configurationMetadata: parseConfigurationMetadata({
    schemaVersion: 1,
    path: "rehearsal.config.mjs",
    sourceSha256: "e".repeat(64),
    fields: [
      {
        path: "runtime.applicationUrl",
        kind: "local-url",
        value: "http://localhost:5175",
        provenance: "validated-active-configuration",
        confidence: "certain",
        reviewRequired: true,
      },
      ...[
        {
          path: "application.readiness.url",
          kind: "local-url",
          value: "http://localhost:5175/health",
        },
        { path: "application.activity.url", kind: "local-url", value: null },
        {
          path: "lifecycle.openIdleTimeoutSeconds",
          kind: "nullable-integer",
          value: null,
        },
        {
          path: "lifecycle.open",
          kind: "open-persistence",
          value: "keep-until-stop",
        },
      ].map((field) => ({
        ...field,
        provenance: "validated-active-configuration",
        confidence: "certain",
        reviewRequired: true,
      })),
    ],
    profiles: [
      {
        name: "primary-only",
        targets: ["primary"],
        applicationUrl: "http://localhost:5175",
      },
    ],
    patchContract: {
      schemaVersion: 1,
      input: "project-local-json-file",
      maximumBytes: 65536,
      writesConfiguration: false,
      executesProposedCommands: false,
      concurrentChanges: "refuse",
      dependentTargetReview: "explicit-topologyConfigPath",
    },
    pathResolution:
      "Rehearsal paths resolve from the project root; JavaScript imports resolve from the configuration folder.",
    manualFields:
      "Review privacy and identity decisions explicitly; nothing is guessed.",
  }),
  environment: {
    target: "postgresql",
    projectId: "rehearsal-test-lab",
    ports: { database: 58642 },
    authenticationProviders: [],
    authenticationCallback: null,
    hostedAccess: "disabled",
    outboundNetwork: "deny",
  },
  lifecycle: {
    run: "keep-until-stop",
    open: "keep-until-stop",
    dataOnStop: "preserved",
  },
  configuration: {
    application: {
      startCommand: "npm run dev",
      proofCommand: "npm run test",
      readinessUrl: "http://localhost:5175/health",
    },
    cleanup: { retainBaselineGenerations: 2 },
  },
  discovery: { source: "core", profile },
};

const { baseline: readyBaselineForPreview, ...readyWithoutBaseline } =
  readySnapshot;
void readyBaselineForPreview;

/** Synthetic visual-state controls only; no engine, project files or receipts are read. */
const environmentStatePreview = (
  kind: "not-created" | "incompatible" | "engine-stopped",
): ProjectSnapshot => {
  const unavailable = kind === "engine-stopped";
  const absent = kind === "not-created";
  const entry = readySnapshot.resources!.environments[0]!;
  return {
    ...readySnapshot,
    workspaceName: `${kind} · synthetic preview`,
    runtime: {
      state: unavailable ? "unavailable" : "stopped",
      targets: readySnapshot.runtime!.targets.map((target) => ({
        ...target,
        state: unavailable ? "unavailable" : "stopped",
        reason: unavailable
          ? "container_engine_unavailable"
          : "runtime_not_running",
        verifiedRuntimeAvailable: false,
        endpoint: null,
      })),
    },
    resources: {
      ...readySnapshot.resources!,
      engine: {
        ...readySnapshot.resources!.engine,
        state: unavailable ? "stopped" : "running",
        disk: unavailable ? null : readySnapshot.resources!.engine.disk,
        resources: unavailable ? [] : readySnapshot.resources!.engine.resources,
      },
      catalog: unavailable
        ? null
        : {
            ...readySnapshot.resources!.catalog!,
            volumes: absent ? [] : readySnapshot.resources!.catalog!.volumes,
          },
      environments: [
        {
          ...entry,
          state: unavailable ? "unavailable" : absent ? "absent" : "stopped",
          containerCount: unavailable || absent ? 0 : 1,
          runningContainerCount: 0,
          volumeCount: unavailable || absent ? 0 : 1,
          diskUsageBytes: null,
          cpuPercent: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          createdAt: unavailable || absent ? null : entry.createdAt,
          lastActivityAt: unavailable || absent ? null : entry.lastActivityAt,
          cleanupEligibility: unavailable
            ? "inspection-unavailable"
            : absent
              ? "not-present"
              : "preview-required",
          provenance:
            kind === "incompatible"
              ? {
                  ...entry.provenance!,
                  runtime: null,
                  runtimeReason: "receipt-invalid",
                }
              : entry.provenance!,
          classification: parseEnvironmentClassification({
            schemaVersion: 1,
            role: "configured-environment",
            dataPersistence: "preserved-on-stop",
            presence: unavailable
              ? { state: "unknown", reason: "ownership-inspection-unavailable" }
              : absent
                ? {
                    state: "not-created",
                    reason: "no-owned-resources-observed",
                  }
                : { state: "created", reason: "owned-resources-observed" },
            receipt:
              kind === "incompatible"
                ? {
                    state: "incompatible",
                    reason: "receipt-invalid",
                    scope: "format-and-provider-only",
                  }
                : {
                    state: "compatible",
                    reason: "supported-receipt-format-and-provider",
                    scope: "format-and-provider-only",
                  },
            review: {
              state: unavailable ? "unknown" : "not-due",
              reason: unavailable
                ? "ownership-inspection-unavailable"
                : "not-running",
              staleAfterSeconds: 3600,
              lastObservableActivityAt: null,
            },
          })!,
        },
      ],
      stale: {
        stoppedCount: kind === "incompatible" ? 1 : 0,
        digest: kind === "incompatible" ? "8".repeat(64) : null,
        targets: kind === "incompatible" ? ["primary"] : [],
      },
    },
  };
};

const snapshots: Readonly<Record<string, ProjectSnapshot>> = {
  "/": readySnapshot,
  "/not-created": environmentStatePreview("not-created"),
  "/incompatible": environmentStatePreview("incompatible"),
  "/engine-stopped": environmentStatePreview("engine-stopped"),
  "/profiles": {
    ...readySnapshot,
    workspaceName: "Two-target project · synthetic preview",
    candidates: {
      ...readySnapshot.candidates!,
      targets: [
        ...readySnapshot.candidates!.targets,
        { name: "publication", configPath: "database/publication", count: 0 },
      ],
    },
    runtime: {
      ...readySnapshot.runtime!,
      state: "mixed",
      targets: [
        ...readySnapshot.runtime!.targets,
        {
          ...readySnapshot.runtime!.targets[0]!,
          name: "publication",
          state: "stopped",
          reason: "runtime_not_running",
          endpoint: null,
          baselineGenerationId: "20261011T000000Z-bbbbbbbbbbbb",
        },
      ],
    },
    resources: {
      ...readySnapshot.resources!,
      environments: [
        ...readySnapshot.resources!.environments,
        {
          ...readySnapshot.resources!.environments[0]!,
          target: "publication",
          projectId: "preview-publication-rehearsal",
          displayName: "Publication review sandbox",
          state: "stopped",
          runningContainerCount: 0,
          diskUsageBytes: 12_000_000,
          cpuPercent: null,
          memoryUsageBytes: null,
          cleanupEligibility: "preview-required",
          classification: parseEnvironmentClassification({
            schemaVersion: 1,
            role: "configured-environment",
            dataPersistence: "preserved-on-stop",
            presence: { state: "created", reason: "owned-resources-observed" },
            receipt: {
              state: "unknown",
              reason: "provider-not-recorded",
              scope: "format-and-provider-only",
            },
            review: {
              state: "not-due",
              reason: "not-running",
              staleAfterSeconds: 3600,
              lastObservableActivityAt: null,
            },
          })!,
          provenance: parseEnvironmentProvenance({
            schemaVersion: 1,
            inspectorVersion: "0.1.0-rc.4",
            verification: "recorded-not-reverified",
            configuredPorts: [
              { service: "database", host: "127.0.0.1", port: 55433 },
              { service: "application", host: "localhost", port: 5175 },
            ],
            runtime: {
              rehearsalVersion: null,
              versionReason: "not-recorded",
              baselineGenerationId: "20261011T000000Z-bbbbbbbbbbbb",
              baselineDataSha256: "b".repeat(64),
              candidateSha256: null,
              migrationReason: "receipt-unavailable",
            },
            runtimeReason: null,
          })!,
        },
      ],
      catalog: {
        ...readySnapshot.resources!.catalog!,
        volumes: [
          ...readySnapshot.resources!.catalog!.volumes,
          {
            ...readySnapshot.resources!.catalog!.volumes[0]!,
            name: "preview-publication-db-data",
            target: "publication",
            bytes: 12_000_000,
          },
        ],
      },
    },
    migrationReview: {
      ...readySnapshot.migrationReview!,
      targets: [
        ...readySnapshot.migrationReview!.targets,
        {
          name: "publication",
          provider: "postgresql",
          baselineGenerationId: "20261011T000000Z-bbbbbbbbbbbb",
          candidateSha256: "f".repeat(64),
          entries: [
            {
              ...readySnapshot.migrationReview!.targets[0]!.entries[0]!,
              id: "publication:20261010000100",
              target: "publication",
            },
          ],
        },
      ],
    },
    configurationMetadata: {
      ...readySnapshot.configurationMetadata!,
      profiles: [
        ...readySnapshot.configurationMetadata!.profiles,
        {
          name: "Publication review",
          targets: ["publication"],
          applicationUrl: null,
        },
        {
          name: "Whole application",
          targets: ["primary", "publication"],
          applicationUrl: "http://localhost:5175",
        },
      ],
    },
  },
  "/application-unconfigured": {
    ...readySnapshot,
    candidates: {
      ...readySnapshot.candidates!,
      count: 0,
      files: [],
      targets: readySnapshot.candidates!.targets.map((target) => ({
        ...target,
        count: 0,
      })),
    },
    configuration: {
      ...readySnapshot.configuration!,
      application: {
        ...readySnapshot.configuration!.application,
        startCommand: "",
        readinessUrl: null,
      },
    },
    migrationReview: {
      ...readySnapshot.migrationReview!,
      candidateCount: 0,
      targets: readySnapshot.migrationReview!.targets.map((target) => ({
        ...target,
        entries: target.entries.map((entry) =>
          entry.required
            ? {
                ...entry,
                status: "applied_to_current_runtime" as const,
                required: false,
                warnings: [],
                selectionReason:
                  "Already applied to this prepared disposable runtime; the immutable baseline remains unchanged.",
              }
            : entry,
        ),
      })),
    },
  },
  "/progress": {
    workspaceName: "Rehearsal Test Lab",
    workspaceRoot: "/preview-only",
    availability: "operation_active",
    version: "0.1.0-rc.4",
    activity: {
      schemaVersion: 1,
      state: "busy",
      recent: readySnapshot.activity!.recent!,
      operation: {
        kind: "run",
        startedAt: "2026-10-13T18:30:00.000Z",
        rehearsalVersion: "0.1.0-rc.4",
        progress: parseOperationProgressSnapshot({
          schemaVersion: 1,
          operationId: "8".repeat(64),
          state: "running",
          startedAt: "2026-10-13T18:30:00.000Z",
          updatedAt: "2026-10-13T18:31:10.000Z",
          elapsedMilliseconds: 70_000,
          currentStage: {
            id: 2,
            phase: "application-proof",
            target: "primary",
            state: "running",
            startedAt: "2026-10-13T18:30:45.000Z",
            endedAt: null,
            durationMilliseconds: 25_000,
          },
          completedStages: [
            {
              id: 1,
              phase: "runtime-lifecycle",
              target: "primary",
              state: "completed",
              startedAt: "2026-10-13T18:30:00.000Z",
              endedAt: "2026-10-13T18:30:45.000Z",
              durationMilliseconds: 45_000,
            },
          ],
          events: [
            {
              sequence: 1,
              code: "operation.started",
              phase: null,
              target: null,
              at: "2026-10-13T18:30:00.000Z",
            },
            {
              sequence: 2,
              code: "stage.started",
              phase: "runtime-lifecycle",
              target: "primary",
              at: "2026-10-13T18:30:00.000Z",
            },
            {
              sequence: 3,
              code: "stage.completed",
              phase: "runtime-lifecycle",
              target: "primary",
              at: "2026-10-13T18:30:45.000Z",
            },
            {
              sequence: 4,
              code: "stage.started",
              phase: "application-proof",
              target: "primary",
              at: "2026-10-13T18:30:45.000Z",
            },
          ],
          truncated: { stages: false, events: false },
        }),
      },
    },
  },
  "/progress-unavailable": {
    workspaceName: "Rehearsal Test Lab",
    workspaceRoot: "/preview-only",
    availability: "operation_attention",
    version: "0.1.0-rc.4",
    activity: {
      schemaVersion: 1,
      state: "invalid",
      operation: null,
      recent: null,
    },
  },
  "/auth": {
    ...readySnapshot,
    workspaceName: "Example Supabase application",
    environment: {
      ...readySnapshot.environment!,
      target: "supabase",
      authenticationProviders: ["google", "github"],
      authenticationCallback: "http://127.0.0.1:58321/auth/v1/callback",
    },
    authenticationReview: parseAuthenticationReview({
      schemaVersion: 1,
      target: "supabase",
      providers: [
        {
          name: "google",
          enabled: true,
          source: "declarative",
          supported: true,
        },
        {
          name: "github",
          enabled: true,
          source: "declarative",
          supported: true,
        },
        { name: "email", enabled: false, source: "template", supported: true },
        {
          name: "custom",
          enabled: null,
          source: "unavailable",
          supported: false,
        },
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
    }),
    runtime: {
      state: "running",
      targets: [
        {
          ...readySnapshot.runtime!.targets[0]!,
          runtimeTarget: "supabase",
          endpoint: { kind: "http", url: "http://127.0.0.1:58321" },
        },
      ],
    },
    reviewTargets: readySnapshot.reviewTargets!.map((target) => ({
      ...target,
      provider: "supabase" as const,
      baseline: target.baseline
        ? { ...target.baseline, storageAssetCount: 3, storageBytes: 6000 }
        : null,
    })),
    baseline: {
      ...readySnapshot.baseline!,
      review: {
        ...readySnapshot.baseline!.review!,
        provider: "supabase",
        storage: {
          assetCount: 3,
          bytes: 6000,
          buckets: [{ name: "example-assets", assetCount: 3, bytes: 6000 }],
        },
      },
      generations: readySnapshot.baseline!.generations!.map((generation) => ({
        ...generation,
        storageAssetCount: generation.active ? 3 : 2,
      })),
    },
    resources: {
      ...readySnapshot.resources!,
      environments: readySnapshot.resources!.environments.map(
        (environment) => ({
          ...environment,
          provider: "supabase",
          containerCount: 7,
          runningContainerCount: 7,
        }),
      ),
    },
    migrationReview: {
      ...readySnapshot.migrationReview!,
      targets: readySnapshot.migrationReview!.targets.map((target) => ({
        ...target,
        provider: "supabase",
      })),
    },
  },
  "/loading": {
    workspaceName: "Rehearsal Test Lab",
    workspaceRoot: "/preview-only",
    availability: "loading",
  },
  "/outdated": {
    workspaceName: "BlendCalc",
    workspaceRoot: "/preview-only",
    availability: "package_outdated",
    version: "0.1.0-rc.2",
    compatibility: {
      state: "outdated",
      installedVersion: "0.1.0-rc.2",
      minimumVersion: "0.1.0-rc.4",
    },
    discovery: { source: "bootstrap", profile },
  },
  "/missing": {
    workspaceName: "New project",
    workspaceRoot: "/preview-only",
    availability: "package_missing",
    discovery: { source: "bootstrap", profile },
  },
  "/not-ready": {
    ...readyWithoutBaseline,
    availability: "not_ready",
    readiness: {
      state: "NOT READY",
      passed: 12,
      failed: 1,
      checks: [
        {
          id: "baseline",
          label: "Verified baseline",
          status: "fail",
          detail: "A safe local baseline has not been created yet.",
          remediation: "Open guided setup and review the baseline inputs.",
        },
      ],
    },
  },
  "/timeout": {
    workspaceName: "Large project",
    workspaceRoot: "/preview-only",
    availability: "error",
    version: "0.1.0-rc.4",
    activity: { schemaVersion: 1, state: "idle", operation: null },
    error: {
      code: "timeout",
      message: "The Rehearsal project check took longer than 90 seconds.",
      suggestions: [
        "Retry the read-only inspection.",
        "Increase Rehearsal: Inspection Timeout Seconds for this workspace if the project needs longer.",
        "Run Rehearsal Doctor for a focused readiness check.",
      ],
    },
    discovery: { source: "bootstrap", profile },
  },
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${requestedPort}`);
  if (url.pathname === "/workspace.css") {
    response.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
    const stylesheet = await readFile(
      resolve(repositoryRoot, "media/workspace.css"),
      "utf8",
    );
    response.end(
      `${stylesheet}\n${themeOverrides(url.searchParams.get("theme"))}`,
    );
    return;
  }
  if (url.pathname === "/rehearsal.png") {
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(
      await readFile(resolve(repositoryRoot, "media/rehearsal-readme.png")),
    );
    return;
  }
  const snapshot = snapshots[url.pathname];
  if (!snapshot) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Unknown Rehearsal preview state.");
    return;
  }
  const origin = `http://${host}:${requestedPort}`;
  const requestedPage = url.searchParams.get("page");
  const activePage = WORKSPACE_PAGES.includes(requestedPage as WorkspacePage)
    ? (requestedPage as WorkspacePage)
    : "overview";
  const actionUris = Object.fromEntries(
    WORKSPACE_ACTION_IDS.map((action) => [action, `#preview-${action}`]),
  ) as Record<WorkspaceActionId, string>;
  const stylesheetUrl = new URL("/workspace.css", origin);
  const theme = url.searchParams.get("theme");
  if (theme) stylesheetUrl.searchParams.set("theme", theme);
  const extensionVersion: string = JSON.parse(
    await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
  ).version;
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  let document = renderWorkspaceDocument(
    snapshot,
    {
      resourceSource: origin,
      stylesheetUri: stylesheetUrl.toString(),
      logoUri: `${origin}/rehearsal.png`,
      actionUris,
      scriptNonce: "preview-navigation-nonce",
      extensionVersion,
      extensionRelease:
        url.searchParams.get("extension-update") === "available"
          ? {
              status: "checked",
              // Synthetic next patch, not a claim about a published release.
              latestVersion: extensionVersion.replace(/\d+$/u, (patch) =>
                String(Number(patch) + 1),
              ),
              checkedAt: 1_792_303_200_000,
              channel: "preview",
            }
          : undefined,
    },
    activePage,
    undefined,
    [],
    url.pathname === "/loading" ? "loading" : "idle",
  );
  if (url.pathname === "/progress" && url.searchParams.get("live") === "1") {
    const progress = snapshot.activity!.operation!.progress!;
    const updates = Array.from({ length: 6 }, (_, index) => ({
      type: "operationProgressUpdated",
      html: renderOperationProgress({
        ...snapshot,
        activity: {
          ...snapshot.activity!,
          operation: {
            ...snapshot.activity!.operation!,
            progress: {
              ...progress,
              updatedAt: new Date(
                Date.parse(progress.updatedAt) + (index + 1) * 2000,
              ).toISOString(),
              elapsedMilliseconds:
                progress.elapsedMilliseconds + (index + 1) * 2000,
              currentStage: progress.currentStage
                ? {
                    ...progress.currentStage,
                    durationMilliseconds:
                      progress.currentStage.durationMilliseconds +
                      (index + 1) * 2000,
                  }
                : null,
            },
          },
        },
      }),
    }));
    const serialized = JSON.stringify(updates).replaceAll("<", "\\u003c");
    document = document.replace(
      "</body>",
      `
      <aside class="preview-live-controls">
        <strong>UI fixture only · no database operations</strong>
        <button id="preview-live-start" type="button">Start live progress test</button>
        <button id="preview-live-next" type="button">Next progress update</button>
        <output id="preview-live-result" aria-live="off">0 updates · summary preserved · 0 removed nodes</output>
      </aside>
      <script nonce="preview-navigation-nonce">
        (() => {
          const updates = ${serialized};
          const root = document.getElementById('operation-progress');
          const summary = root?.querySelector('details summary');
          const result = document.getElementById('preview-live-result');
          let count = 0, removed = 0;
          const observe = new MutationObserver(records => {
            removed += records.reduce((total, record) => total + record.removedNodes.length, 0);
            report();
          });
          const report = () => { result.textContent = count + ' updates · summary ' + (root?.querySelector('details summary') === summary ? 'preserved' : 'REPLACED') + ' · ' + removed + ' removed nodes'; };
          if(root) observe.observe(root,{childList:true,subtree:true});
          const next = () => { if(count < updates.length) window.postMessage(updates[count++], location.origin); report(); };
          document.getElementById('preview-live-next').addEventListener('click',next);
          document.getElementById('preview-live-start').addEventListener('click',event => {
            event.currentTarget.disabled = true;
            const timer = setInterval(() => { next(); if(count >= updates.length) clearInterval(timer); },2000);
          },{once:true});
        })();
      </script></body>`,
    );
  }
  response.end(document);
});

server.listen(requestedPort, host, () => {
  console.log(`Rehearsal workspace preview: http://${host}:${requestedPort}`);
  console.log(
    "States: /, /auth, /progress, /progress-unavailable, /loading, /outdated, /missing, /not-ready, /timeout",
  );
  console.log(
    "Themes: add ?theme=light, ?theme=dark-modern, ?theme=contrast or ?theme=contrast-light",
  );
  console.log("Press Ctrl+C to stop.");
});

const stop = (): void => {
  server.close(() => process.exit(0));
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
