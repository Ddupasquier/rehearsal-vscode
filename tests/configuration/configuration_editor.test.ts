import { describe, expect, it } from "vitest";
import {
  applyConfigurationProposal,
  configurationDiff,
  configurationProposalChanges,
  parseConfigurationProposal,
  parseStructuredConfigurationValues,
} from "../../src/configuration/configuration_editor.js";
import { editLiteralConfiguration } from "../../src/configuration/literal_configuration.js";
import { ConfigurationInputError } from "../../src/configuration/configuration_contract.js";

const source = `export default {
  application: {
    startCommand: "npm run dev",
    proofCommand: "npm test",
    readiness: { url: "http://localhost:5175", expectedStatus: 200 },
  },
  runtime: { applicationUrl: "http://localhost:5175", databasePort: 5432 },
  lifecycle: { run: "keep-until-stop", open: "keep-until-stop" },
  cleanup: { retainBaselineGenerations: 2 },
};
`;

describe("configuration proposals", () => {
  const numericMetadata = {
    schemaVersion: 1 as const,
    path: "rehearsal.config.mjs",
    sourceSha256: "a".repeat(64),
    profiles: [],
    pathResolution: "Project root",
    manualFields: "Manual review",
    fields: [
      {
        path: "resources.retainedEnvironmentCount",
        kind: "integer",
        value: 2,
        provenance: "validated-active-configuration" as const,
        confidence: "certain" as const,
        reviewRequired: true as const,
      },
    ],
  };
  it.each(["1", "1000"])(
    "accepts valid retained-environment boundary %s",
    (input) => {
      expect(
        parseStructuredConfigurationValues(
          { fields: { "resources.retainedEnvironmentCount": input } },
          numericMetadata,
        ),
      ).toEqual([
        { path: "resources.retainedEnvironmentCount", value: Number(input) },
      ]);
    },
  );
  it("preserves the optional URL representation for valid named-profile proposals", () => {
    const profile = { name: "Review", targets: ["primary"] };
    const metadata = {
      ...numericMetadata,
      fields: [
        {
          ...numericMetadata.fields[0]!,
          path: "profiles",
          kind: "profiles",
          value: [],
        },
      ],
    };
    expect(
      parseStructuredConfigurationValues(
        { fields: { profiles: JSON.stringify([profile]) } },
        metadata,
      ),
    ).toEqual([{ path: "profiles", value: [profile] }]);
  });
  it.each(["0", "1001", "1.5", "NaN", "9007199254740992", "PRIVATE_CANARY"])(
    "rejects invalid policy input %s with fixed field-specific recovery before editing",
    (input) => {
      try {
        parseStructuredConfigurationValues(
          { fields: { "resources.retainedEnvironmentCount": input } },
          numericMetadata,
        );
        throw new Error("Expected an input refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigurationInputError);
        expect(String(error)).toContain(
          "resources.retainedEnvironmentCount: Enter a whole number from 1 to 1000.",
        );
        expect(String(error)).toContain("review again");
        expect(String(error)).not.toContain("PRIVATE_CANARY");
      }
      expect(
        parseStructuredConfigurationValues(
          { fields: { "resources.retainedEnvironmentCount": "3" } },
          numericMetadata,
        ),
      ).toEqual([{ path: "resources.retainedEnvironmentCount", value: 3 }]);
    },
  );
  it("shows a profile insertion without mislabeling subsequent settings as changes", () => {
    const before =
      'export default {\n  schemaVersion: 1,\n  application: { startCommand: "npm run dev" },\n};\n';
    const after = before.replace(
      "  schemaVersion",
      '  profiles: [{ name: "Manual test", targets: ["primary"] }],\n  schemaVersion',
    );
    const diff = configurationDiff({
      path: "rehearsal.config.mjs",
      before,
      after,
    });
    expect(diff).toContain(
      '+  profiles: [{ name: "Manual test", targets: ["primary"] }],',
    );
    expect(
      diff
        .split("\n")
        .filter((line) => line.startsWith("-") && !line.startsWith("---")),
    ).toEqual([]);
    expect(diff).toContain('   application: { startCommand: "npm run dev" },');
    expect(
      configurationDiff({ path: "config.mjs", before: after, after: before }),
    ).toContain(
      '-  profiles: [{ name: "Manual test", targets: ["primary"] }],',
    );
  });
  it("bounds replacement context and keeps unchanged input free of invented changes", () => {
    const before = Array.from(
      { length: 100 },
      (_, index) => `setting-${index}`,
    ).join("\n");
    const after = before.replace("setting-50", "replacement");
    const diff = configurationDiff({ path: "config.mjs", before, after });
    expect(diff).toContain("-setting-50\n+replacement");
    expect(diff).toContain("@@ -48,7 +48,7 @@");
    expect(diff).not.toContain("setting-46");
    expect(diff).not.toContain("setting-54");
    expect(
      configurationDiff({ path: "config.mjs", before, after: before }),
    ).toBe("--- a/config.mjs\n+++ b/config.mjs\n");
  });
  it("proposes activity and foreground idle settings independently without guessing application instrumentation", () => {
    const metadata = {
      schemaVersion: 1 as const,
      path: "rehearsal.config.mjs",
      sourceSha256: "a".repeat(64),
      profiles: [],
      pathResolution: "Project root",
      manualFields: "Manual review",
      fields: [
        { path: "application.activity.url", kind: "local-url", value: null },
        {
          path: "lifecycle.openIdleTimeoutSeconds",
          kind: "nullable-integer",
          value: null,
        },
      ].map((field) => ({
        ...field,
        provenance: "validated-active-configuration" as const,
        confidence: "certain" as const,
        reviewRequired: true as const,
      })),
    };
    expect(
      parseStructuredConfigurationValues(
        {
          fields: {
            "application.activity.url": "http://localhost:5175/activity",
            "lifecycle.openIdleTimeoutSeconds": "60",
          },
        },
        metadata,
      ),
    ).toEqual([
      {
        path: "application.activity.url",
        value: "http://localhost:5175/activity",
      },
      { path: "lifecycle.openIdleTimeoutSeconds", value: 60 },
    ]);
    expect(
      parseStructuredConfigurationValues(
        {
          fields: {
            "application.activity.url": "",
            "lifecycle.openIdleTimeoutSeconds": "",
          },
        },
        metadata,
      ),
    ).toEqual([]);
    const configured = {
      ...metadata,
      fields: metadata.fields.map((field) => ({
        ...field,
        value:
          field.kind === "local-url" ? "http://localhost:5175/activity" : 60,
      })),
    };
    expect(
      parseStructuredConfigurationValues(
        {
          fields: {
            "application.activity.url": "",
            "lifecycle.openIdleTimeoutSeconds": "",
          },
        },
        configured,
      ),
    ).toEqual([
      { path: "application.activity.url", value: null },
      { path: "lifecycle.openIdleTimeoutSeconds", value: null },
    ]);
    for (const value of ["29", "86401", "30.5", "0", "NaN"])
      expect(() =>
        parseStructuredConfigurationValues(
          { fields: { "lifecycle.openIdleTimeoutSeconds": value } },
          metadata,
        ),
      ).toThrow();
    for (const value of [
      "http://localhost/activity",
      "http://localhost:1000/activity",
      "http://localhost:5175/activity?secret=1",
      "http://PRIVATE_CANARY@localhost:5175/activity",
    ]) {
      let failure: unknown;
      try {
        parseStructuredConfigurationValues(
          { fields: { "application.activity.url": value } },
          metadata,
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).not.toContain("PRIVATE_CANARY");
      expect(String(failure)).not.toContain(value);
    }
  });
  it("maps the exact proposed browser field for core review without inventing a readiness change", () => {
    const proposal = parseConfigurationProposal({
      applicationUrl: "http://127.0.0.1:6000/app",
    });
    expect(configurationProposalChanges(proposal)).toEqual([
      { path: "runtime.applicationUrl", value: "http://127.0.0.1:6000/app" },
    ]);
    expect(
      applyConfigurationProposal({ source, proposal }).changedFields,
    ).toEqual(
      configurationProposalChanges(proposal).map((change) => change.path),
    );
    expect(configurationProposalChanges({ protectEnvironment: false })).toEqual(
      [{ path: "runtime.protected", value: false }],
    );
    expect(configurationProposalChanges({})).toEqual([]);
    expect(() =>
      configurationProposalChanges({
        applicationUrl: "http://localhost:5175",
        surprise: "do-not-copy",
      } as Parameters<typeof configurationProposalChanges>[0]),
    ).toThrow("Unknown configuration proposal field");
  });
  it("skips absent readiness on full-form submissions and hides malformed profile contents", () => {
    const metadata = {
      schemaVersion: 1 as const,
      path: "rehearsal.config.mjs",
      sourceSha256: "a".repeat(64),
      profiles: [],
      pathResolution: "project root",
      manualFields: "manual",
      fields: [
        {
          path: "application.readiness.url",
          kind: "local-url",
          value: null,
          provenance: "validated-active-configuration" as const,
          confidence: "certain" as const,
          reviewRequired: true as const,
        },
        {
          path: "resources.maximumBytes",
          kind: "nullable-integer",
          value: null,
          provenance: "validated-active-configuration" as const,
          confidence: "certain" as const,
          reviewRequired: true as const,
        },
        {
          path: "runtime.displayName",
          kind: "text",
          value: "Old",
          provenance: "validated-active-configuration" as const,
          confidence: "certain" as const,
          reviewRequired: true as const,
        },
        {
          path: "profiles",
          kind: "profiles",
          value: [],
          provenance: "validated-active-configuration" as const,
          confidence: "certain" as const,
          reviewRequired: true as const,
        },
      ],
    };
    expect(
      parseStructuredConfigurationValues(
        {
          fields: {
            "application.readiness.url": "",
            "resources.maximumBytes": "",
            "runtime.displayName": "New",
          },
        },
        metadata,
      ),
    ).toEqual([{ path: "runtime.displayName", value: "New" }]);
    try {
      parseStructuredConfigurationValues(
        { fields: { profiles: "PRIVATE_CANARY_NOT_JSON" } },
        metadata,
      );
      throw new Error("Expected failure");
    } catch (error) {
      expect(String(error)).not.toContain("PRIVATE_CANARY");
    }
  });
  it("does not create a partial readiness owner when changing a non-web project's address", () => {
    const original = `export default { application: { startCommand: 'node app.mjs', proofCommand: 'npm test' }, runtime: { applicationUrl: 'http://localhost:5175', databasePort: 5432 } };`;
    const result = applyConfigurationProposal({
      source: original,
      proposal: { applicationUrl: "http://localhost:5176" },
    });
    expect(result.source).not.toContain("readiness");
    expect(result.changedFields).toEqual(["runtime.applicationUrl"]);
  });
  it("preserves a separately reviewed health endpoint when changing the browser address", () => {
    const original = source.replace(
      'url: "http://localhost:5175"',
      'url: "http://localhost:5175/health"',
    );
    const result = applyConfigurationProposal({
      source: original,
      proposal: parseConfigurationProposal({
        applicationUrl: "http://127.0.0.1:6000/app",
      }),
    });
    expect(result.source).toContain(
      'applicationUrl: "http://127.0.0.1:6000/app"',
    );
    expect(result.source).toContain(
      'readiness: { url: "http://localhost:5175/health", expectedStatus: 200 }',
    );
    expect(result.changedFields).toEqual(["runtime.applicationUrl"]);
    expect(original).toContain('applicationUrl: "http://localhost:5175"');
  });
  it("keeps browser, health, activity and provider declarations independent", () => {
    const original = `export default {
      application: {
        readiness: { url: "http://127.0.0.1:5176/health", expectedStatus: 204 },
        activity: { url: "http://127.0.0.1:5177/activity" },
      },
      runtime: { applicationUrl: "http://localhost:5175" },
      supabase: {
        // Provider callback: http://127.0.0.1:58341/auth/v1/callback
        authentication: {
          enableLocalSignup: true,
          environmentFile: ".env.rehearsal-service.local",
          providers: [{
            name: "github",
            clientIdEnvironmentVariable: "REHEARSAL_GITHUB_CLIENT_ID",
            clientSecretEnvironmentVariable: "REHEARSAL_GITHUB_CLIENT_SECRET",
          }],
        },
      },
    };`;
    const proposal = parseConfigurationProposal({
      applicationUrl: "HTTP://LOCALHOST:06000/app/../sandbox",
    });
    expect(configurationProposalChanges(proposal)).toEqual([
      {
        path: "runtime.applicationUrl",
        value: "http://localhost:6000/sandbox",
      },
    ]);
    const result = applyConfigurationProposal({ source: original, proposal });
    expect(result.changedFields).toEqual(["runtime.applicationUrl"]);
    expect(result.source).toBe(
      original.replace(
        'applicationUrl: "http://localhost:5175"',
        'applicationUrl: "http://localhost:6000/sandbox"',
      ),
    );
  });
  it.each([
    "http://localhost:5175/?",
    "http://localhost:5175/#",
    "http://localhost:5175/PRIVATE_CANARY\u007f",
    "http://localhost:5175/PRIVATE_CANARY\u2028",
  ])(
    "refuses an unsafe browser-address proposal before constructing an edit",
    (applicationUrl) => {
      expect(() => parseConfigurationProposal({ applicationUrl })).toThrow();
      expect(source).toContain('applicationUrl: "http://localhost:5175"');
    },
  );
  it.each([
    "readiness: null",
    "readiness: { url: null }",
    "readiness: { url: localReadinessUrl() }",
    "readiness: makeReadinessConfiguration()",
  ])("does not interpret or overwrite unrelated %s", (readiness) => {
    const original = `export default { application: { startCommand: "npm run dev", ${readiness} }, runtime: { applicationUrl: "http://localhost:5175" } };`;
    const result = applyConfigurationProposal({
      source: original,
      proposal: { applicationUrl: "http://[::1]:5176/app" },
    });
    expect(result.source).toContain(readiness);
    expect(result.source).toContain('applicationUrl: "http://[::1]:5176/app"');
    expect(result.changedFields).toEqual(["runtime.applicationUrl"]);
  });
  it("leaves both URLs unchanged for a blank or already-matching browser-address proposal", () => {
    for (const raw of [
      { applicationUrl: "" },
      { applicationUrl: "http://localhost:5175" },
    ]) {
      const result = applyConfigurationProposal({
        source,
        proposal: parseConfigurationProposal(raw),
      });
      expect(result.source).toBe(source);
      expect(result.changedFields).toEqual([]);
    }
  });
  it("keeps an explicitly reviewed readiness edit distinct from the browser address", () => {
    const metadata = {
      schemaVersion: 1 as const,
      path: "rehearsal.config.mjs",
      sourceSha256: "a".repeat(64),
      profiles: [],
      pathResolution: "Project root",
      manualFields: "Manual review",
      fields: ["runtime.applicationUrl", "application.readiness.url"].map(
        (path) => ({
          path,
          kind: "local-url",
          value: "http://localhost:5175",
          provenance: "validated-active-configuration" as const,
          confidence: "certain" as const,
          reviewRequired: true as const,
        }),
      ),
    };
    const changes = parseStructuredConfigurationValues(
      {
        fields: {
          "runtime.applicationUrl": "http://127.0.0.1:6000/app",
          "application.readiness.url": "http://127.0.0.1:6000/health",
        },
      },
      metadata,
    );
    expect(changes).toEqual([
      { path: "runtime.applicationUrl", value: "http://127.0.0.1:6000/app" },
      {
        path: "application.readiness.url",
        value: "http://127.0.0.1:6000/health",
      },
    ]);
    const edited = editLiteralConfiguration(source, changes);
    expect(edited).toContain('applicationUrl: "http://127.0.0.1:6000/app"');
    expect(edited).toContain(
      'readiness: { url: "http://127.0.0.1:6000/health", expectedStatus: 200 }',
    );
  });
  it("adds friendly-name and protection literals without changing technical identity", () => {
    const result = applyConfigurationProposal({
      source: source.replace(
        "databasePort: 5432",
        "projectId: 'immutable-rehearsal', databasePort: 5432",
      ),
      proposal: parseConfigurationProposal({
        environmentName: "Migration experiment",
        protectEnvironment: true,
      }),
    });
    expect(result.source).toContain('displayName: "Migration experiment"');
    expect(result.source).toContain("protected: true");
    expect(result.source).toContain("projectId: 'immutable-rehearsal'");
    expect(result.changedFields).toEqual([
      "runtime.displayName",
      "runtime.protected",
    ]);
  });
  it("updates both resource fields regardless of order and preserves comments", () => {
    const original = `export default { runtime: { protected: true, displayName: "A", projectId: "stable" } }; // runtime: { protected: false }`;
    const result = applyConfigurationProposal({
      source: original,
      proposal: { environmentName: "A longer name", protectEnvironment: false },
    });
    expect(result.source).toContain(
      'protected: false, displayName: "A longer name"',
    );
    expect(result.source).toContain("// runtime: { protected: false }");
  });
  it.each(["'", '"'])(
    "counts only actual environment-field changes with %s-quoted names and preserves unchanged literals",
    (quote) => {
      const original = `export default { runtime: { protected: false, displayName: ${quote}Manual sandbox${quote}, projectId: 'immutable-rehearsal' } }; // protected: true, displayName: 'not the owner'`;
      for (const { name, protection, expected } of [
        {
          name: "Renamed sandbox",
          protection: false,
          expected: ["runtime.displayName"],
        },
        {
          name: "Manual sandbox",
          protection: true,
          expected: ["runtime.protected"],
        },
        {
          name: "Renamed sandbox",
          protection: true,
          expected: ["runtime.displayName", "runtime.protected"],
        },
        { name: "Manual sandbox", protection: false, expected: [] },
      ]) {
        const result = applyConfigurationProposal({
          source: original,
          proposal: { environmentName: name, protectEnvironment: protection },
        });
        expect(result.changedFields).toEqual(expected);
        expect(result.source).toContain("projectId: 'immutable-rehearsal'");
        expect(result.source).toContain(
          "// protected: true, displayName: 'not the owner'",
        );
        if (!expected.includes("runtime.displayName"))
          expect(result.source).toContain(
            `displayName: ${quote}Manual sandbox${quote}`,
          );
        if (expected.length === 0) expect(result.source).toBe(original);
      }
    },
  );
  it("counts a missing environment literal as one insertion without adding unproposed fields", () => {
    for (const { source, proposal, expected, absent } of [
      {
        source:
          "export default { runtime: { displayName: 'Manual sandbox', projectId: 'immutable-rehearsal' } };",
        proposal: {
          environmentName: "Manual sandbox",
          protectEnvironment: false,
        },
        expected: ["runtime.protected"],
        absent: undefined,
      },
      {
        source:
          "export default { runtime: { protected: false, projectId: 'immutable-rehearsal' } };",
        proposal: {
          environmentName: "Manual sandbox",
          protectEnvironment: false,
        },
        expected: ["runtime.displayName"],
        absent: undefined,
      },
      {
        source:
          "export default { runtime: { projectId: 'immutable-rehearsal' } };",
        proposal: { environmentName: "Manual sandbox" },
        expected: ["runtime.displayName"],
        absent: "protected:",
      },
      {
        source:
          "export default { runtime: { projectId: 'immutable-rehearsal' } };",
        proposal: { protectEnvironment: false },
        expected: ["runtime.protected"],
        absent: "displayName:",
      },
    ]) {
      const result = applyConfigurationProposal({ source, proposal });
      expect(result.changedFields).toEqual(expected);
      expect(result.source).toContain("projectId: 'immutable-rehearsal'");
      if (absent) expect(result.source).not.toContain(absent);
    }
  });
  it("preserves escaped equal environment names when only protection changes", () => {
    const original = String.raw`export default {runtime:{displayName: 'Dylan\u0027s\x20sandbox', protected: false, projectId: 'immutable-rehearsal'}};`;
    const result = applyConfigurationProposal({
      source: original,
      proposal: {
        environmentName: "Dylan's sandbox",
        protectEnvironment: true,
      },
    });
    expect(result.changedFields).toEqual(["runtime.protected"]);
    expect(result.source).toBe(
      original.replace("protected: false", "protected: true"),
    );
  });
  it("keeps inline field comments and whitespace when an unchanged name accompanies a protection edit", () => {
    const original = `export default { runtime: {
      displayName: /* label rationale */ 'Manual sandbox',
      protected: /* data policy */ false,
      projectId: 'immutable-rehearsal',
    } };`;
    const result = applyConfigurationProposal({
      source: original,
      proposal: { environmentName: "Manual sandbox", protectEnvironment: true },
    });
    expect(result.changedFields).toEqual(["runtime.protected"]);
    expect(result.source).toBe(
      original.replace("/* data policy */ false", "/* data policy */ true"),
    );
  });
  it("does not bypass ambiguous environment fields when another proposed value matches", () => {
    for (const runtime of [
      "{ protected: false, displayName: getLabel(), projectId: 'stable' }",
      "{ protected: !false, displayName: 'Manual sandbox', projectId: 'stable' }",
      "{ protected: false, displayName: 'Manual sandbox', displayName: 'Other', projectId: 'stable' }",
    ])
      expect(() =>
        applyConfigurationProposal({
          source: `export default { runtime: ${runtime} };`,
          proposal: {
            environmentName: "Manual sandbox",
            protectEnvironment: false,
          },
        }),
      ).toThrow();
  });
  it("refuses complex or duplicate resource fields instead of guessing a config edit", () => {
    for (const runtime of [
      "{ ...settings, projectId: 'stable' }",
      "{ protected: true, protected: false }",
      "{ ['protected']: false }",
      "{ 'protected': false }",
      "{ protected: getProtection() }",
    ]) {
      expect(() =>
        applyConfigurationProposal({
          source: `export default { runtime: ${runtime} };`,
          proposal: { environmentName: "Name", protectEnvironment: true },
        }),
      ).toThrow();
    }
    expect(() =>
      parseConfigurationProposal({ protectEnvironment: "true" }),
    ).toThrow();
    expect(() =>
      parseConfigurationProposal({ environmentName: "X".repeat(101) }),
    ).toThrow();
  });
  it("validates and applies supported literals as one reviewed patch", () => {
    const proposal = parseConfigurationProposal({
      applicationUrl: "http://127.0.0.1:6000/app",
      startCommand: "npm run rehearsal:dev",
      proofCommand: "npm run rehearsal:test",
      runPersistence: "stop-after-run",
      openPersistence: "stop-on-application-exit",
      retainBaselineGenerations: "4",
    });
    const result = applyConfigurationProposal({ source, proposal });
    expect(result.changedFields).toEqual([
      "runtime.applicationUrl",
      "application.startCommand",
      "application.proofCommand",
      "lifecycle.run",
      "lifecycle.open",
      "cleanup.retainBaselineGenerations",
    ]);
    expect(result.source).toContain(
      'applicationUrl: "http://127.0.0.1:6000/app"',
    );
    expect(result.source).toContain('url: "http://localhost:5175"');
    expect(result.source).toContain("retainBaselineGenerations: 4");
  });

  it("rejects hosted addresses and unsupported expression-based fields", () => {
    expect(() =>
      parseConfigurationProposal({
        applicationUrl: "https://example.com",
      }),
    ).toThrow("loopback");
    expect(() =>
      applyConfigurationProposal({
        source: source.replace(
          'startCommand: "npm run dev"',
          "startCommand: process.env.START_COMMAND",
        ),
        proposal: { startCommand: "npm run dev" },
      }),
    ).toThrow("editable application.startCommand literal");
  });

  it("treats dollar sequences in reviewed command literals as data", () => {
    const result = applyConfigurationProposal({
      source,
      proposal: { startCommand: "node -e '$& $1 $$'" },
    });
    expect(result.source).toContain(`startCommand: "node -e '$& $1 $$'"`);
  });
});
