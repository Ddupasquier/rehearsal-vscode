import { describe, expect, it } from "vitest";
import {
  editLiteralConfiguration,
  hasLiteralConfigurationPath,
  matchesLiteralConfigurationValue,
} from "../../src/configuration/literal_configuration.js";
describe("literal configuration editing", () => {
  it("compares exact scalar values without executing source or normalizing strings", () => {
    const source = `// displayName: 'bait', protected: true\nexport default defineRehearsalConfig({runtime: { displayName: 'Manual sandbox', protected: false, projectId: 'stable' }});`;
    expect(
      matchesLiteralConfigurationValue(
        source,
        "runtime.displayName",
        "Manual sandbox",
      ),
    ).toBe(true);
    expect(
      matchesLiteralConfigurationValue(source, "runtime.protected", false),
    ).toBe(true);
    expect(
      matchesLiteralConfigurationValue(
        source,
        "runtime.displayName",
        "Different",
      ),
    ).toBe(false);
    expect(
      matchesLiteralConfigurationValue(source, "runtime.protected", true),
    ).toBe(false);
    expect(
      matchesLiteralConfigurationValue(source, "runtime.missing", false),
    ).toBe(false);
    expect(
      matchesLiteralConfigurationValue(source, "runtime.displayName", false),
    ).toBe(false);
  });
  it.each([
    [String.raw`'Dylan\'s sandbox'`, "Dylan's sandbox"],
    [String.raw`"Dylan\u0027s sandbox"`, "Dylan's sandbox"],
    [String.raw`'Manual\x20sandbox'`, "Manual sandbox"],
    [String.raw`'Manual\u0020sandbox'`, "Manual sandbox"],
    [String.raw`'Manual\u{20}sandbox'`, "Manual sandbox"],
    [String.raw`'Sandbox \u{1f680}'`, "Sandbox 🚀"],
    [String.raw`'C:\\sandbox'`, String.raw`C:\sandbox`],
    [String.raw`'Name\q'`, "Nameq"],
    ["'Manu\\\nal sandbox'", "Manual sandbox"],
  ])("decodes supported string %s without evaluating it", (literal, value) => {
    const source = `export default {runtime:{displayName: ${literal}}};`;
    expect(
      matchesLiteralConfigurationValue(source, "runtime.displayName", value),
    ).toBe(true);
  });
  it("fails closed on ambiguous owners, expressions and malformed or legacy numeric escapes", () => {
    for (const source of [
      "export default {runtime: {displayName: getName()}};",
      "export default {runtime: {displayName: 'A', displayName: 'A'}};",
      "export default {runtime: {...options, displayName: 'A'}};",
      "export default {runtime: {displayName: 'A'}} || other;",
      String.raw`export default {runtime: {displayName: '\u{110000}'}};`,
      String.raw`export default {runtime: {displayName: '\x4'}};`,
      String.raw`export default {runtime: {displayName: '\u004'}};`,
      String.raw`export default {runtime: {displayName: '\1'}};`,
      "export default {runtime: {displayName: 'A\nB'}};",
    ])
      expect(() =>
        matchesLiteralConfigurationValue(source, "runtime.displayName", "A"),
      ).toThrow();
  });
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
  it("refuses exported expression suffixes and additional wrapper arguments", () => {
    const object = "{ runtime: { applicationUrl: 'http://localhost:5175' } }";
    for (const expression of [
      `${object}.runtime`,
      `${object}['runtime']`,
      `${object}()`,
      `${object} && otherConfig`,
      `${object} || otherConfig`,
      `${object} ?? otherConfig`,
      `${object} ? otherConfig : anotherConfig`,
      `${object}, otherConfig`,
      `${object}\n(otherConfig)`,
      `defineRehearsalConfig(${object}).runtime`,
      `defineRehearsalConfig(${object})(otherConfig)`,
      `defineRehearsalConfig(${object}) || otherConfig`,
      `defineRehearsalConfig(${object}, otherConfig)`,
      `defineRehearsalConfig(${object}, ...otherConfigs)`,
      `defineRehearsalConfig(${object}`,
    ]) {
      const source = `export default ${expression};`;
      expect(() =>
        editLiteralConfiguration(source, [
          { path: "runtime.applicationUrl", value: "http://localhost:5176" },
        ]),
      ).toThrow();
      expect(() =>
        hasLiteralConfigurationPath(source, "runtime.applicationUrl"),
      ).toThrow();
    }
  });
  it("preserves supported expression endings, comments and trailing declarations", () => {
    const object = "{ runtime: { applicationUrl: 'http://localhost:5175' } }";
    for (const source of [
      `export default ${object}`,
      `export default ${object} /* reviewed owner */; // kept\n`,
      `export default ${object}; const later = 'unchanged';`,
      `export default ${object}\nconst later = 'unchanged';`,
      `export default defineRehearsalConfig(/* kept */ ${object} /* kept */);`,
      `export default defineRehearsalConfig(${object},);\nconst later = 'unchanged';`,
      `export default defineRehearsalConfig(${object})\nexport const later = 'unchanged';`,
    ]) {
      expect(
        hasLiteralConfigurationPath(source, "runtime.applicationUrl"),
      ).toBe(true);
      const result = editLiteralConfiguration(source, [
        { path: "runtime.applicationUrl", value: "http://localhost:5176" },
      ]);
      expect(result).toBe(
        source.replace("'http://localhost:5175'", '"http://localhost:5176"'),
      );
    }
  });
  it("refuses regular-expression token bait and other unsupported standalone slash tokens", () => {
    const object = "{ runtime: { applicationUrl: 'http://localhost:5175' } }";
    for (const source of [
      "const bait=/export default {runtime:{applicationUrl:'old'}};/;const config={runtime:{applicationUrl:'http://localhost:5175'}};export {config as default};",
      `const ratio = 10 / 2; export default ${object};`,
      `const expression = /not-a-config/; export default ${object};`,
    ]) {
      expect(() =>
        editLiteralConfiguration(source, [
          { path: "runtime.applicationUrl", value: "http://localhost:5176" },
        ]),
      ).toThrow();
      expect(() =>
        hasLiteralConfigurationPath(source, "runtime.applicationUrl"),
      ).toThrow();
    }
  });
  it.each(["\n", "\r", "\r\n", "\u2028", "\u2029"])(
    "ends line comments at JavaScript terminator %j without hiding an export suffix",
    (lineEnding) => {
      const object = "{ runtime: { applicationUrl: 'http://localhost:5175' } }";
      const invalid = `export default ${object} // comment${lineEnding} || otherConfig;`;
      expect(() =>
        editLiteralConfiguration(invalid, [
          { path: "runtime.applicationUrl", value: "http://localhost:5176" },
        ]),
      ).toThrow();
      expect(() =>
        hasLiteralConfigurationPath(invalid, "runtime.applicationUrl"),
      ).toThrow();
      for (const source of [
        `// kept prefix${lineEnding}export default ${object};`,
        `export default ${object} // kept suffix${lineEnding}const later = 'kept';`,
      ]) {
        expect(
          hasLiteralConfigurationPath(source, "runtime.applicationUrl"),
        ).toBe(true);
        expect(
          editLiteralConfiguration(source, [
            { path: "runtime.applicationUrl", value: "http://localhost:5176" },
          ]),
        ).toBe(
          source.replace("'http://localhost:5175'", '"http://localhost:5176"'),
        );
      }
    },
  );
});
