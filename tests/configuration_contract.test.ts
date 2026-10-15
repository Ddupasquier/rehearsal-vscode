import { describe, expect, it } from "vitest";
import { parseConfigurationMetadata } from "../src/configuration_contract.js";
import {
  coreConfigurationControls,
  namedProfileControls,
} from "../src/configuration_view.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";

const metadata = () => ({
  schemaVersion: 1,
  path: "infrastructure/rehearsal/rehearsal.config.mjs",
  sourceSha256: "a".repeat(64),
  fields: [
    {
      path: "runtime.applicationUrl",
      kind: "local-url",
      value: "http://localhost:5175",
      provenance: "validated-active-configuration",
      confidence: "certain",
      reviewRequired: true,
    },
  ],
  profiles: [
    { name: "primary-only", targets: ["primary"], applicationUrl: null },
  ],
  patchContract: {
    schemaVersion: 1,
    input: "project-local-json-file",
    maximumBytes: 65536,
    writesConfiguration: false,
    executesProposedCommands: false,
    concurrentChanges: "refuse",
  },
  pathResolution:
    "Paths resolve from project root; imports from config folder.",
  manualFields: "Privacy/provider changes require source review.",
});
const idleMetadata = (activity: unknown = null, timeout: unknown = null) => ({
  ...metadata(),
  fields: [
    {
      ...metadata().fields[0],
      path: "application.activity.url",
      kind: "local-url",
      value: activity,
    },
    {
      ...metadata().fields[0],
      path: "lifecycle.openIdleTimeoutSeconds",
      kind: "nullable-integer",
      value: timeout,
    },
  ],
});
describe("configuration metadata contract", () => {
  it.each([
    null,
    "http://localhost:1024/activity",
    "http://[::1]:65535/activity",
    "https://127.0.0.1:5175/activity",
    "http://localhost:5175/".padEnd(500, "a"),
  ])(
    "accepts an explicitly declared bounded local activity endpoint: %s",
    (value) => {
      expect(
        parseConfigurationMetadata(idleMetadata(value)).fields[0]?.value,
      ).toBe(value);
    },
  );
  it.each([
    "http://localhost/activity",
    "http://localhost:1023/activity",
    "http://localhost:5175/activity?state=1",
    "http://localhost:5175/activity#state",
    "http://private-canary@localhost:5175/activity",
    "https://production.example/activity",
    "/activity",
    "http://localhost:5175/".padEnd(501, "a"),
  ])("rejects an unsafe or unsupported activity endpoint: %s", (value) => {
    expect(() => parseConfigurationMetadata(idleMetadata(value))).toThrow();
  });
  it.each([null, 30, 86400])(
    "accepts disabled or bounded foreground idle timeout: %s",
    (value) => {
      expect(
        parseConfigurationMetadata(idleMetadata(null, value)).fields[1]?.value,
      ).toBe(value);
    },
  );
  it.each([0, 29, 86401, 30.5, "30", Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid foreground idle timeout: %s",
    (value) => {
      expect(() =>
        parseConfigurationMetadata(idleMetadata(null, value)),
      ).toThrow();
    },
  );
  it("uses truthful opt-in labels and bounds without implying instrumentation or background scheduling", () => {
    const configurationMetadata = parseConfigurationMetadata(idleMetadata());
    const html = coreConfigurationControls({
      workspaceName: "Example",
      workspaceRoot: "/not-read",
      availability: "not_ready",
      configurationMetadata,
    });
    expect(html).toContain("Application activity endpoint (opt-in)");
    expect(html).toContain('name="application.activity.url"');
    expect(html).toContain('maxlength="500"');
    expect(html).toContain('min="30" max="86400"');
    expect(html).toContain("Empty disables automatic idle stop");
    expect(html).toContain("Rehearsal does not add instrumentation");
    expect(html).toContain(
      "Health responses, missing activity, and resource age are not proof of inactivity",
    );
    expect(html).toContain("No background daemon is installed");
    const legacy = coreConfigurationControls({
      workspaceName: "Example",
      workspaceRoot: "/not-read",
      availability: "not_ready",
      configurationMetadata: parseConfigurationMetadata(metadata()),
    });
    expect(legacy).not.toContain("Foreground idle timeout");
  });
  it("sends parent-graph proposals only when the explicit public capability is declared", () => {
    expect(
      parseConfigurationMetadata(metadata()).dependentTargetReview,
    ).toBeUndefined();
    expect(
      parseConfigurationMetadata({
        ...metadata(),
        patchContract: {
          ...metadata().patchContract,
          dependentTargetReview: "explicit-topologyConfigPath",
        },
      }).dependentTargetReview,
    ).toBe("explicit-topologyConfigPath");
    for (const dependentTargetReview of [null, false, true, "guess-parent"])
      expect(() =>
        parseConfigurationMetadata({
          ...metadata(),
          patchContract: { ...metadata().patchContract, dependentTargetReview },
        }),
      ).toThrow();
  });
  it("keeps exact nested path and proven profile evidence without guessing defaults", () => {
    const result = parseConfigurationMetadata(metadata());
    expect(result.path).toBe("infrastructure/rehearsal/rehearsal.config.mjs");
    expect(result.fields[0]?.value).toBe("http://localhost:5175");
    expect(result.profiles[0]?.applicationUrl).toBeNull();
  });
  it("takes profile target choices from public resources and refuses to invent a default target", () => {
    const configurationMetadata = {
      ...parseConfigurationMetadata(metadata()),
      profiles: [],
    };
    const partial: ProjectSnapshot = {
      workspaceName: "Fresh",
      workspaceRoot: "/not-read",
      availability: "not_ready",
      configurationMetadata,
      resources: {
        schemaVersion: 1,
        inspectedAt: "2026-10-15T12:00:00Z",
        engine: {
          state: "stopped",
          context: "default",
          disk: null,
          resources: [],
        },
        environments: [
          {
            target: "publication",
            projectId: "fixture-publication",
            provider: "postgresql",
            configPath: "publication.config.mjs",
            state: "unavailable",
            containerCount: 0,
            runningContainerCount: 0,
            volumeCount: 0,
            diskUsageBytes: null,
            cpuPercent: null,
            memoryUsageBytes: null,
            memoryLimitBytes: null,
            createdAt: null,
            lastActivityAt: null,
            retention: "persistent",
            cleanupEligibility: "inspection-unavailable",
            restartPolicies: [],
          },
        ],
        stale: { stoppedCount: 0, digest: null, targets: [] },
      },
    };
    expect(namedProfileControls(partial)).toContain(
      'name="target" value="publication"',
    );
    expect(namedProfileControls(partial)).not.toContain('value="primary"');
    const { resources: _resources, ...unknown } = partial;
    expect(namedProfileControls(unknown)).toContain(
      "Configured target choices are unavailable",
    );
    expect(namedProfileControls(unknown)).not.toContain(
      'id="named-profile-controls"',
    );
  });
  it("refuses unknown/private field paths, kind substitutions and remote/credential URLs", () => {
    const controls = [metadata(), metadata(), metadata(), metadata()];
    controls[0]!.fields[0]!.path = "environment.password";
    controls[1]!.fields[0]!.kind = "text";
    controls[2]!.fields[0]!.value = "https://production.example";
    controls[3]!.fields[0]!.value = "http://private-token@localhost:5175";
    for (const input of controls)
      expect(() => parseConfigurationMetadata(input)).toThrow();
  });
  it("refuses unsafe patch promises, absolute paths, duplicate fields and profile secret properties", () => {
    expect(() =>
      parseConfigurationMetadata({
        ...metadata(),
        path: "/private/config.mjs",
      }),
    ).toThrow();
    expect(() =>
      parseConfigurationMetadata({
        ...metadata(),
        path: "../other/rehearsal.config.mjs",
      }),
    ).toThrow();
    expect(() =>
      parseConfigurationMetadata({
        ...metadata(),
        fields: [metadata().fields[0], metadata().fields[0]],
      }),
    ).toThrow();
    expect(() =>
      parseConfigurationMetadata({
        ...metadata(),
        patchContract: {
          ...metadata().patchContract,
          executesProposedCommands: true,
        },
      }),
    ).toThrow();
    expect(() =>
      parseConfigurationMetadata({
        ...metadata(),
        profiles: [{ ...metadata().profiles[0], token: "secret" }],
      }),
    ).toThrow();
  });
  it("accepts bounded nullable policy values and exact lifecycle enums", () => {
    const input = metadata();
    const fields = [
      {
        path: "resources.staleAfterSeconds",
        kind: "nullable-integer",
        value: null,
      },
      { path: "resources.maximumBytes", kind: "nullable-integer", value: 1024 },
      {
        path: "containerRuntime.diskWarningPercent",
        kind: "integer",
        value: 100,
      },
      {
        path: "lifecycle.run",
        kind: "run-persistence",
        value: "stop-after-run",
      },
    ].map((field) => ({
      ...field,
      provenance: "validated-active-configuration",
      confidence: "certain",
      reviewRequired: true,
    }));
    expect(
      parseConfigurationMetadata({ ...input, fields }).fields,
    ).toHaveLength(4);
    expect(() =>
      parseConfigurationMetadata({
        ...input,
        fields: [{ ...fields[2], value: 101 }],
      }),
    ).toThrow();
    expect(() =>
      parseConfigurationMetadata({
        ...input,
        fields: [{ ...fields[3], value: "always-delete" }],
      }),
    ).toThrow();
  });
});
