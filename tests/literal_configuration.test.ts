import { describe, expect, it } from "vitest";
import { editLiteralConfiguration } from "../src/literal_configuration.js";
describe("literal configuration editing", () => {
  it("edits only the exported owner, ignores comments and strings, and preserves unrelated fields", () => {
    const source = `import { defineRehearsalConfig } from '@rehearsal-db/core';\n// runtime: { applicationUrl: 'wrong' }\nexport default defineRehearsalConfig({ application: { startCommand: 'npm run dev', readiness: { url: 'http://localhost:5175' } }, runtime: { applicationUrl: 'http://localhost:5175', projectId: 'stable' } });`;
    const result = editLiteralConfiguration(source, [
      { path: "runtime.applicationUrl", value: "http://[::1]:5176/auth" },
    ]);
    expect(result).toContain(`// runtime: { applicationUrl: 'wrong' }`);
    expect(result).toContain(`projectId: 'stable'`);
    expect(result).toContain('applicationUrl: "http://[::1]:5176/auth"');
    expect(result).toContain("startCommand: 'npm run dev'");
  });
  it("inserts missing owners and supports repeat named profile changes", () => {
    let source = `export default { runtime: { projectId: 'stable' } };`;
    source = editLiteralConfiguration(source, [
      { path: "resources.maximumBytes", value: 1024 },
      {
        path: "profiles",
        value: [{ name: "Fresh baseline", targets: ["primary"] }],
      },
    ]);
    const result = editLiteralConfiguration(source, [
      { path: "resources.maximumBytes", value: null },
      { path: "profiles", value: [{ name: "Full QA", targets: ["primary"] }] },
    ]);
    expect(result).toContain("maximumBytes: null");
    expect(result).toContain('name: "Full QA"');
  });
  it("refuses expressions, spreads, duplicate and computed keys, named exports and malformed source", () => {
    for (const source of [
      "export default { ...defaults, runtime: {} };",
      "export default { runtime: { applicationUrl: getUrl() } };",
      "export default { runtime: {}, runtime: {} };",
      "export default { runtime: { ['applicationUrl']: 'url' } };",
      "const config = {}; export default config;",
      "export default { runtime: { applicationUrl: 'unfinished } };",
      "export default { runtime: { applicationUrl: `template` } };",
    ])
      expect(() =>
        editLiteralConfiguration(source, [
          { path: "runtime.applicationUrl", value: "http://localhost:5175" },
        ]),
      ).toThrow();
  });
});
