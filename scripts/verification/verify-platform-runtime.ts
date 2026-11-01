/** Real compiled Node adapter smoke, not a VS Code extension-host walkthrough. */
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const { runVersion, runRehearsalJson } = require(
  resolve(__dirname, "../../dist/src/process_adapter.js"),
) as typeof import("../../src/runtime/process_adapter.js");

const main = async (): Promise<void> => {
  const temporary = await mkdtemp(
    join(tmpdir(), "rehearsal-adapter-platform-"),
  );
  const workspace = join(temporary, "project with spaces café");
  const packageRoot = join(workspace, "node_modules/@rehearsal-db/core");
  const marker = join(temporary, "child-executions.txt");
  try {
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      join(workspace, "package.json"),
      JSON.stringify({ private: true }),
    );
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@rehearsal-db/core",
        version: "9.9.9",
        bin: { rehearsal: "cli.mjs" },
      }),
    );
    await writeFile(
      join(packageRoot, "cli.mjs"),
      `
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(marker)}, 'executed\\n');
console.log(JSON.stringify(process.argv.includes('--version')
  ? { name: '@rehearsal-db/core', version: '9.9.9' }
  : { schemaVersion: 1, rehearsalVersion: '9.9.9', command: 'activity', status: 'success', startedAt: '2026-10-19T00:00:00.000Z', durationMs: 1, warnings: [], data: { probe: 'synthetic' } }));
`,
    );
    let adapter: string;
    if (process.platform === "win32") {
      await assert.rejects(runVersion(workspace), (error: unknown) => {
        assert.equal((error as { code?: string }).code, "platform_unsupported");
        assert.match((error as Error).message, /WSL\s*2/iu);
        return true;
      });
      await assert.rejects(
        runRehearsalJson({
          workspaceRoot: workspace,
          command: ["activity"],
          expectedCommand: "activity",
        }),
        (error: unknown) => {
          assert.equal(
            (error as { code?: string }).code,
            "platform_unsupported",
          );
          return true;
        },
      );
      await assert.rejects(access(marker));
      adapter = "native-windows-refused-before-child-launch";
    } else {
      assert.equal((await runVersion(workspace)).version, "9.9.9");
      const result = await runRehearsalJson<{ probe: string }>({
        workspaceRoot: workspace,
        command: ["activity"],
        expectedCommand: "activity",
      });
      assert.ok(result.result.status === "success");
      assert.equal(result.result.data.probe, "synthetic");
      assert.equal(
        (await readFile(marker, "utf8")).trim().split("\n").length,
        2,
      );
      adapter = "real-node-child-version-and-json-passed";
    }
    const output = resolve(__dirname, "../../test-results/platform");
    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, `adapter-${process.platform}-${process.arch}.json`),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          status: "passed",
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          adapter,
          fixture: "synthetic-cli-not-database",
          nativeEditorHost: "not-exercised",
          database: "not-exercised",
          pathWithSpacesAndUnicode: "passed",
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `Compiled adapter smoke passed on ${process.platform}/${process.arch}: ${adapter}.`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
