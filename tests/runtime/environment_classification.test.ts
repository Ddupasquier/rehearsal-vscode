import { describe, expect, it } from "vitest";
import { WORKSPACE_ACTION_IDS } from "../../src/workspace/action_catalog.js";
import { parseEnvironmentClassification } from "../../src/runtime/resource_contract.js";
import { parseResourceInventoryData } from "../../src/contracts.js";
import { resourceManagerMarkup } from "../../src/runtime/resource_manager_view.js";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  normalizeWorkspacePreferences,
} from "../../src/workspace/workspace_preferences.js";
import {
  renderWorkspaceDocument,
  type WorkspaceViewAssets,
} from "../../src/workspace/workspace_view.js";

const observedAt = "2026-10-15T12:00:00Z";
const classification = {
  schemaVersion: 1,
  role: "configured-environment",
  dataPersistence: "preserved-on-stop",
  presence: { state: "created", reason: "owned-resources-observed" },
  receipt: {
    state: "incompatible",
    reason: "receipt-invalid",
    scope: "format-and-provider-only",
  },
  review: {
    state: "due",
    reason: "observable-cutoff-exceeded",
    staleAfterSeconds: 3600,
    lastObservableActivityAt: "2026-10-15T09:00:00Z",
  },
};
const rawInventory = () => ({
  schemaVersion: 1,
  inspectedAt: observedAt,
  engine: { state: "running", context: "default", disk: null, resources: [] },
  environments: [
    {
      target: "primary",
      projectId: "fixture-rehearsal",
      provider: "postgresql",
      configPath: "rehearsal.config.mjs",
      state: "running",
      containerCount: 1,
      runningContainerCount: 1,
      volumeCount: 1,
      diskUsageBytes: null,
      cpuPercent: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
      createdAt: null,
      lastActivityAt: "2026-10-15T09:00:00Z",
      retention: "persistent",
      cleanupEligibility: "running",
      restartPolicies: ["no"],
      classification,
    },
  ],
  catalog: { schemaVersion: 1, images: [], volumes: [], otherContainers: [] },
  stale: { stoppedCount: 0, digest: null, targets: [] },
});

describe("strict environment classification and controls", () => {
  it("normalizes optional metadata without confusing creation, operational state, receipt compatibility or review age", () => {
    expect(parseEnvironmentClassification(classification, observedAt)).toEqual(
      classification,
    );
    expect(parseEnvironmentClassification(undefined)).toBeUndefined();
    const inventory = parseResourceInventoryData(rawInventory());
    expect(inventory.environments[0]?.state).toBe("running");
    expect(inventory.environments[0]?.classification?.presence.state).toBe(
      "created",
    );
    expect(
      parseResourceInventoryData(JSON.parse(JSON.stringify(inventory))),
    ).toEqual(inventory);
  });
  it("keeps explicit legacy/engine unknowns and disabled review valid", () => {
    expect(
      parseEnvironmentClassification({
        ...classification,
        presence: {
          state: "unknown",
          reason: "ownership-inspection-unavailable",
        },
        receipt: {
          ...classification.receipt,
          state: "unknown",
          reason: "provider-not-recorded",
        },
        review: {
          state: "unknown",
          reason: "ownership-inspection-unavailable",
          staleAfterSeconds: null,
          lastObservableActivityAt: null,
        },
      })?.presence.state,
    ).toBe("unknown");
    expect(
      parseEnvironmentClassification({
        ...classification,
        review: {
          state: "disabled",
          reason: "cutoff-disabled",
          staleAfterSeconds: null,
          lastObservableActivityAt: null,
        },
      })?.review.state,
    ).toBe("disabled");
  });
  it("refuses unsupported helper claims, arbitrary fields, contradictory reasons and invalid/future cutoff evidence", () => {
    for (const invalid of [
      null,
      { ...classification, schemaVersion: 2 },
      { ...classification, role: "disposable-helper" },
      { ...classification, dataPersistence: "delete-on-stop" },
      { ...classification, credentials: "PRIVATE_CANARY" },
      {
        ...classification,
        presence: { ...classification.presence, state: "not-created" },
      },
      {
        ...classification,
        receipt: { ...classification.receipt, state: "compatible" },
      },
      {
        ...classification,
        receipt: {
          ...classification.receipt,
          state: "compatible",
          reason: "provider-not-recorded",
        },
      },
      {
        ...classification,
        receipt: { ...classification.receipt, scope: "database-verified" },
      },
      {
        ...classification,
        review: { ...classification.review, staleAfterSeconds: 0 },
      },
      {
        ...classification,
        review: { ...classification.review, lastObservableActivityAt: null },
      },
      {
        ...classification,
        review: {
          ...classification.review,
          lastObservableActivityAt: "2026-10-16T09:00:00Z",
        },
      },
      {
        ...classification,
        review: {
          ...classification.review,
          lastObservableActivityAt: "2026-10-15T11:30:00Z",
        },
      },
    ])
      expect(() =>
        parseEnvironmentClassification(invalid, observedAt),
      ).toThrow();
    const raw = rawInventory();
    expect(() =>
      parseResourceInventoryData({
        ...raw,
        environments: [
          { ...raw.environments[0], containerCount: 0, volumeCount: 0 },
        ],
      }),
    ).toThrow("contradicts observed resources");
    expect(() =>
      parseResourceInventoryData({
        ...raw,
        environments: [{ ...raw.environments[0], state: "unavailable" }],
      }),
    ).toThrow("contradicts observed resources");
  });
  it("renders selectable review states without allowing a selection to perform an operation", () => {
    const html = resourceManagerMarkup(
      parseResourceInventoryData(rawInventory()),
      DEFAULT_WORKSPACE_PREFERENCES,
    );
    expect(html).toContain(
      'data-state="running created review-due incompatible"',
    );
    expect(html).toContain('value="created"');
    expect(html).toContain('value="review-due"');
    expect(html).toContain('value="incompatible"');
    expect(html).toContain("Long-running review due");
    expect(html).toContain("Incompatible receipt");
    expect(html).toContain("not a disposable helper");
    expect(html).toContain("Stop/start preserves data");
    expect(html).toContain("reviewed reset/run can replace data and volumes");
    expect(html).toContain("not writer-version compatibility");
    expect(html).toContain("nothing stops automatically");
    for (const resourceState of [
      "created",
      "not-created",
      "review-due",
      "incompatible",
    ])
      expect(
        normalizeWorkspacePreferences({ resourceState }).resourceState,
      ).toBe(resourceState);
  });
  it("refuses a not-running review on live/mixed observations and recent review without a running container", () => {
    const raw = rawInventory();
    const stoppedReview = {
      state: "not-due",
      reason: "not-running",
      staleAfterSeconds: 3600,
      lastObservableActivityAt: null,
    };
    for (const [state, runningContainerCount] of [
      ["running", 1],
      ["mixed", 1],
      ["stopped", 1],
      ["running", 0],
      ["mixed", 0],
    ])
      expect(() =>
        parseResourceInventoryData({
          ...raw,
          environments: [
            {
              ...raw.environments[0],
              state,
              runningContainerCount,
              classification: { ...classification, review: stoppedReview },
            },
          ],
        }),
      ).toThrow("contradicts observed resources");
    expect(
      parseResourceInventoryData({
        ...raw,
        environments: [
          {
            ...raw.environments[0],
            state: "stopped",
            runningContainerCount: 0,
            classification: { ...classification, review: stoppedReview },
          },
        ],
      }).environments[0]?.classification?.review.reason,
    ).toBe("not-running");
    const recentReview = {
      state: "not-due",
      reason: "recent-observable-activity",
      staleAfterSeconds: 3600,
      lastObservableActivityAt: "2026-10-15T11:30:00Z",
    };
    expect(() =>
      parseResourceInventoryData({
        ...raw,
        environments: [
          {
            ...raw.environments[0],
            runningContainerCount: 0,
            classification: { ...classification, review: recentReview },
          },
        ],
      }),
    ).toThrow("contradicts observed resources");
    expect(
      parseResourceInventoryData({
        ...raw,
        environments: [
          {
            ...raw.environments[0],
            classification: { ...classification, review: recentReview },
          },
        ],
      }).environments[0]?.classification?.review.state,
    ).toBe("not-due");
  });
  it("rejects contradictory receipt/provenance pairs while preserving optional and provider-unknown legacy evidence", () => {
    const raw = rawInventory();
    const receipt = (reason: string) => ({
      state:
        reason === "supported-receipt-format-and-provider"
          ? "compatible"
          : ["receipt-invalid", "receipt-binding-mismatch"].includes(reason)
            ? "incompatible"
            : "unknown",
      reason,
      scope: "format-and-provider-only",
    });
    const base = {
      schemaVersion: 1,
      inspectorVersion: "0.1.0-rc.5",
      verification: "recorded-not-reverified",
      configuredPorts: [],
      runtime: null,
      runtimeReason: "receipt-invalid",
    };
    const valid = {
      ...base,
      runtimeReason: null,
      runtime: {
        rehearsalVersion: null,
        versionReason: "not-recorded",
        baselineGenerationId: "20261015T120000Z-aaaaaaaaaaaa",
        baselineDataSha256: "a".repeat(64),
        candidateSha256: null,
        migrationReason: "receipt-unavailable",
      },
    };
    const paired = (provenance: unknown, reason: string) => ({
      ...raw,
      environments: [
        {
          ...raw.environments[0],
          provenance,
          classification: { ...classification, receipt: receipt(reason) },
        },
      ],
    });
    for (const [provenance, reason] of [
      [base, "supported-receipt-format-and-provider"],
      [base, "provider-not-recorded"],
      [
        { ...base, runtimeReason: "receipt-unavailable" },
        "supported-receipt-format-and-provider",
      ],
      [valid, "receipt-invalid"],
      [valid, "receipt-unavailable"],
      [valid, "receipt-binding-mismatch"],
      [
        {
          ...valid,
          runtime: {
            ...valid.runtime,
            migrationReason: "receipt-does-not-match-baseline",
          },
        },
        "supported-receipt-format-and-provider",
      ],
    ] as const)
      expect(() =>
        parseResourceInventoryData(paired(provenance, reason)),
      ).toThrow("contradicts recorded provenance");
    expect(
      parseResourceInventoryData(paired(base, "receipt-invalid"))
        .environments[0]?.classification?.receipt.state,
    ).toBe("incompatible");
    expect(
      parseResourceInventoryData(
        paired(
          { ...base, runtimeReason: "receipt-unavailable" },
          "receipt-unavailable",
        ),
      ).environments[0]?.classification?.receipt.state,
    ).toBe("unknown");
    expect(
      parseResourceInventoryData(paired(valid, "provider-not-recorded"))
        .environments[0]?.classification?.receipt.state,
    ).toBe("unknown");
    expect(
      parseResourceInventoryData(
        paired(valid, "supported-receipt-format-and-provider"),
      ).environments[0]?.classification?.receipt.state,
    ).toBe("compatible");
    expect(
      parseResourceInventoryData(
        paired(
          {
            ...valid,
            runtime: {
              ...valid.runtime,
              migrationReason: "receipt-does-not-match-baseline",
            },
          },
          "receipt-binding-mismatch",
        ),
      ).environments[0]?.classification?.receipt.state,
    ).toBe("incompatible");
    expect(
      parseResourceInventoryData(raw).environments[0]?.provenance,
    ).toBeUndefined();
    const { classification: _omitted, ...legacyEntry } = raw.environments[0]!;
    expect(
      parseResourceInventoryData({
        ...raw,
        environments: [{ ...legacyEntry, provenance: valid }],
      }).environments[0]?.classification,
    ).toBeUndefined();
  });
  it("does not label a created runtime not-created merely because its verified receipt is unavailable", () => {
    const inventory = parseResourceInventoryData(rawInventory());
    const assets = {
      resourceSource: "vscode-webview://fixture",
      stylesheetUri: "vscode-webview://fixture/workspace.css",
      logoUri: "vscode-webview://fixture/logo.svg",
      actionUris: Object.fromEntries(
        WORKSPACE_ACTION_IDS.map((action) => [
          action,
          `command:fixture.${action}`,
        ]),
      ),
      scriptNonce: "fixture-nonce",
    } as WorkspaceViewAssets;
    const html = renderWorkspaceDocument(
      {
        workspaceName: "Fixture",
        workspaceRoot: "/not-exposed",
        availability: "ready",
        resources: inventory,
        runtime: {
          state: "running",
          targets: [
            {
              name: "primary",
              runtimeTarget: "postgresql",
              state: "running",
              reason: null,
              verifiedRuntimeAvailable: false,
              endpoint: null,
            },
          ],
        },
      },
      assets,
      "runtime",
    );
    expect(html).toContain("verified receipt unavailable · created");
    expect(html).not.toContain("verified receipt unavailable · not created");
  });
});
