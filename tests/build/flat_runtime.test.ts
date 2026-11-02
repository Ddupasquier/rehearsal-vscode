import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { SourceMap } from "node:module";
import { planFlatRuntime } from "../../scripts/build/flat-runtime.js";

const fixture = (): Map<string, string> => {
  const files = new Map<string, string>();
  for (const [name, content] of [
    ["extension", 'exports.answer = require("./feature/value.js").answer;'],
    ["feature/value", "exports.answer = 42;"],
  ]) {
    files.set(
      `${name}.js`,
      `${content}\n//# sourceMappingURL=${name?.split("/").at(-1)}.js.map\n`,
    );
    files.set(`${name}.d.ts`, "export declare const answer: number;\n");
    files.set(
      `${name}.js.map`,
      JSON.stringify({
        version: 3,
        file: `${name?.split("/").at(-1)}.js`,
        sourceRoot: "",
        sources: [
          `${name?.includes("/") ? "../../../" : "../../"}src/${name}.ts`,
        ],
        names: [],
        mappings: "AAAA",
      }),
    );
  }
  return files;
};

describe("compatible flat extension output", () => {
  it("loads the moved module through the unchanged installed entry point and preserves later columns", async () => {
    const input = fixture();
    const output = await planFlatRuntime(input);
    expect([...output.keys()].every((name) => !name.includes("/"))).toBe(true);
    const exports: Record<string, unknown> = {};
    vm.runInNewContext(output.get("extension.js")!, {
      exports,
      require: (name: string) => {
        expect(name).toBe("./value.js");
        const dependency = {};
        vm.runInNewContext(output.get("value.js")!, { exports: dependency });
        return dependency;
      },
    });
    expect(exports.answer).toBe(42);
    const before = input.get("extension.js")!;
    const after = output.get("extension.js")!;
    expect(after.length).toBe(before.length);
    expect(after.slice(before.indexOf(").answer"))).toBe(
      before.slice(before.indexOf(").answer")),
    );
    const map = JSON.parse(output.get("value.js.map")!);
    expect(map.sources).toEqual(["../../src/feature/value.ts"]);
    expect(new SourceMap(map).findEntry(0, 0)).toMatchObject({
      originalSource: "../../src/feature/value.ts",
      originalLine: 0,
      originalColumn: 0,
    });
  });

  it("rewrites declaration re-exports and import types consistently", async () => {
    const input = fixture();
    input.set(
      "extension.d.ts",
      'export * from "./feature/value.js"; type Value = import("./feature/value.js").answer; import value = require("./feature/value.js");',
    );
    const output = await planFlatRuntime(input);
    expect(output.get("extension.d.ts")).toMatch(
      /export \* from "\.\/value.js"\s*;/u,
    );
    expect(output.get("extension.d.ts")).toMatch(
      /import\("\.\/value.js"\s*\)/u,
    );
    expect(output.get("extension.d.ts")).toMatch(
      /require\("\.\/value.js"\s*\)/u,
    );
  });

  it.each([
    ["missing target", 'require("./missing.js")'],
    ["escaped target", 'require("../outside.js")'],
    ["dynamic require", "require(name)"],
    ["dynamic import", "import(name)"],
    ["absolute target", 'require("/outside.js")'],
    ["file URL", 'require("file:///outside.js")'],
    [
      "shadowed require",
      'function f(require) { return require("./feature/value.js"); }',
    ],
    ["aliased require", "const load = require;"],
    ["module-relative filesystem access", "exports.path = __dirname;"],
  ])("refuses %s before changing the input", async (_label, code) => {
    const input = fixture();
    input.set("extension.js", code);
    const snapshot = [...input];
    await expect(planFlatRuntime(input)).rejects.toThrow();
    expect([...input]).toEqual(snapshot);
  });

  it("refuses case-insensitive filename collisions", async () => {
    const input = fixture();
    input.set("other/Value.js", "exports.answer = 0;");
    await expect(planFlatRuntime(input)).rejects.toThrow();
  });

  it.each(["sourceRoot", "file", "sources"])(
    "refuses unexpected source map %s",
    async (key) => {
      const input = fixture();
      const map = JSON.parse(input.get("feature/value.js.map")!);
      map[key] = key === "sources" ? ["../../../../outside.ts"] : "unexpected";
      input.set("feature/value.js.map", JSON.stringify(map));
      await expect(planFlatRuntime(input)).rejects.toThrow();
    },
  );
});
