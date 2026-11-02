/** Keep the installed VSIX layout compatible while source modules have domain folders. */
import { readdir, readFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parsers as javascript } from "prettier/plugins/babel";
import { parsers as typescript } from "prettier/plugins/typescript";

type Node = Record<string, unknown> & { type?: string };
const refusal = (): never => {
  throw new Error(
    "Compiled runtime cannot preserve the public flat module layout.",
  );
};
const object = (value: unknown): value is Node =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parse = async (text: string, declaration: boolean): Promise<unknown> => {
  const parser = declaration ? typescript.typescript : javascript.babel;
  if (!parser) return refusal();
  return parser.parse(text, {
    parser: declaration ? "typescript" : "babel",
  } as Parameters<typeof parser.parse>[1]);
};

const rewrite = async (
  source: string,
  original: string,
  files: ReadonlyMap<string, string>,
): Promise<string> => {
  const declaration = original.endsWith(".d.ts");
  const edits = new Map<number, { end: number; replacement: string }>();
  const literal = (node: unknown): void => {
    if (!object(node) || typeof node.value !== "string") return refusal();
    const value = node.value;
    if (
      path.posix.isAbsolute(value) ||
      /^[A-Za-z]:/u.test(value) ||
      value.includes("\\") ||
      value.startsWith("file:") ||
      value.includes("\0")
    )
      return refusal();
    if (!value.startsWith(".")) return;
    if (
      !/^\.{1,2}\//u.test(value) ||
      value.includes("\\") ||
      value.includes("\0")
    )
      return refusal();
    const target = path.posix.normalize(
      path.posix.join(path.posix.dirname(original), value),
    );
    if (
      target.startsWith("../") ||
      path.posix.isAbsolute(target) ||
      !target.endsWith(".js")
    )
      return refusal();
    if (!files.has(target) || !files.has(target.replace(/\.js$/u, ".d.ts")))
      return refusal();
    const start =
      typeof node.start === "number"
        ? node.start
        : (node.range as number[] | undefined)?.[0];
    const end =
      typeof node.end === "number"
        ? node.end
        : (node.range as number[] | undefined)?.[1];
    if (
      start === undefined ||
      end === undefined ||
      start < 0 ||
      end <= start ||
      end > source.length
    )
      return refusal();
    const before = source.slice(start, end);
    const after = JSON.stringify(`./${path.posix.basename(target)}`);
    if (/\r|\n/u.test(before) || after.length > before.length) return refusal();
    // Preserve every subsequent generated column and the existing source-map mappings.
    edits.set(start, { end, replacement: after.padEnd(before.length, " ") });
  };
  const walk = (value: unknown, parent?: Node): void => {
    if (Array.isArray(value)) {
      value.forEach((child) => walk(child, parent));
      return;
    }
    if (!object(value)) return;
    if (
      value.type === "Identifier" &&
      ["__dirname", "__filename"].includes(String(value.name))
    )
      return refusal();
    if (value.type === "Identifier" && value.name === "require") {
      if (parent?.type !== "CallExpression" || parent.callee !== value)
        return refusal();
    }
    if (
      value.type === "CallExpression" &&
      object(value.callee) &&
      value.callee.type === "Identifier" &&
      value.callee.name === "require"
    ) {
      if (!Array.isArray(value.arguments) || value.arguments.length !== 1)
        return refusal();
      literal(value.arguments[0]);
    }
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
        "ImportExpression",
        "TSImportType",
      ].includes(value.type ?? "") &&
      value.source
    )
      literal(value.source);
    if (value.type === "TSExternalModuleReference") literal(value.expression);
    for (const [key, child] of Object.entries(value)) {
      if (!["loc", "tokens", "comments", "extra"].includes(key))
        walk(child, value);
    }
  };
  walk(await parse(source, declaration));
  let result = source;
  for (const [start, { end, replacement }] of [...edits].sort(
    ([a], [b]) => b - a,
  ))
    result = result.slice(0, start) + replacement + result.slice(end);
  await parse(result, declaration);
  return result;
};

/** Pure planning: validate every module and source map before replacing any build output. */
export const planFlatRuntime = async (
  files: ReadonlyMap<string, string>,
): Promise<Map<string, string>> => {
  const output = new Map<string, string>();
  const names = new Set<string>();
  for (const original of files.keys()) {
    if (
      original !== path.posix.normalize(original) ||
      original.startsWith("../") ||
      path.posix.isAbsolute(original) ||
      original.includes("\\") ||
      !/\.(?:js(?:\.map)?|d\.ts)$/u.test(original)
    )
      return refusal();
    const name = path.posix.basename(original);
    if (names.has(name.toLowerCase())) return refusal();
    names.add(name.toLowerCase());
  }
  if (!files.has("extension.js")) return refusal();
  for (const [original, content] of files) {
    const name = path.posix.basename(original);
    if (original.endsWith(".js.map")) {
      const map: unknown = JSON.parse(content);
      if (
        !object(map) ||
        map.version !== 3 ||
        map.file !== path.posix.basename(original, ".map") ||
        map.sourceRoot !== "" ||
        !Array.isArray(map.sources) ||
        map.sources.length !== 1 ||
        typeof map.sources[0] !== "string" ||
        !Array.isArray(map.names) ||
        typeof map.mappings !== "string" ||
        !files.has(original.slice(0, -4))
      )
        return refusal();
      const source = path.posix.normalize(
        path.posix.join(
          "dist/src",
          path.posix.dirname(original),
          map.sources[0],
        ),
      );
      if (!source.startsWith("src/") || !source.endsWith(".ts"))
        return refusal();
      output.set(
        name,
        JSON.stringify({
          ...map,
          sources: [path.posix.relative("dist/src", source)],
        }),
      );
    } else {
      if (
        original.endsWith(".js") &&
        (!files.has(`${original}.map`) ||
          !files.has(original.replace(/\.js$/u, ".d.ts")))
      )
        return refusal();
      output.set(name, await rewrite(content, original, files));
    }
  }
  return output;
};

const flatten = async (): Promise<void> => {
  const root = path.resolve(__dirname, "../..");
  const runtime = path.join(root, "dist/src");
  const files = new Map<string, string>();
  const read = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await read(file);
      else if (entry.isFile())
        files.set(
          path.relative(runtime, file).split(path.sep).join("/"),
          await readFile(file, "utf8"),
        );
      else return refusal();
    }
  };
  await read(runtime);
  const output = await planFlatRuntime(files);
  await rm(runtime, { recursive: true });
  await mkdir(runtime);
  for (const [name, content] of output)
    await writeFile(path.join(runtime, name), content);
};

if (require.main === module)
  void flatten().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
