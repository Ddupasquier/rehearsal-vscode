/** File-only synthetic consumer for opt-in canonical activation acceptance. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const hash = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

/** After preservation proof/process shutdown only: unlock owned immutable test directories for teardown. */
export async function prepareNativeConsumerRemoval(workspace: string) {
  const root = await realpath(workspace);
  const generations = join(root, ".rehearsal/generations");
  assert.equal(await realpath(generations), generations);
  let count = 0;
  const visit = async (directory: string): Promise<void> => {
    assert.ok(++count <= 1000);
    const stat = await lstat(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    assert.equal(stat.uid, process.getuid?.());
    await chmod(directory, 0o700);
    for (const name of await readdir(directory)) {
      const child = join(directory, name),
        entry = await lstat(child);
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) await visit(child);
      else assert.ok(entry.isFile());
    }
  };
  await visit(generations);
}

/** Include modes, names and internal links; never follow a link out of the owned root. */
export async function nativeConsumerFingerprint(root: string): Promise<string> {
  const canonical = await realpath(root),
    entries: string[] = [];
  let count = 0,
    total = 0;
  const visit = async (directory: string) => {
    for (const name of (await readdir(join(canonical, directory))).sort()) {
      assert.ok(
        ++count <= 3000,
        "Owned consumer inventory exceeded its bound.",
      );
      const file = join(directory, name),
        full = join(canonical, file),
        stat = await lstat(full);
      if (stat.isSymbolicLink()) {
        const target = await readlink(full),
          resolved = await realpath(full),
          path = relative(canonical, resolved);
        assert.ok(
          path && !isAbsolute(path) && path !== ".." && !path.startsWith("../"),
        );
        entries.push(JSON.stringify([file, "link", target, stat.mode]));
      } else if (stat.isDirectory()) {
        entries.push(JSON.stringify([file, "directory", stat.mode]));
        await visit(file);
      } else {
        assert.ok(stat.isFile() && stat.size <= 2 * 1024 * 1024);
        total += stat.size;
        assert.ok(total <= 32 * 1024 * 1024);
        entries.push(
          JSON.stringify([file, "file", stat.mode, hash(await readFile(full))]),
        );
      }
    }
  };
  await visit("");
  return hash(entries.join("\n"));
}

export async function prepareNativeInsightsConsumer({
  workspace,
  coreArtifact,
  coreVersion,
  run,
}: {
  workspace: string;
  coreArtifact: string;
  coreVersion: string;
  run(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string }>;
}) {
  const sql =
    "create table public.activity_probe(id integer primary key,title text not null)";
  const config = {
    schemaVersion: 1,
    project: { name: "private-canonical-insights-verification" },
    postgresql: {
      migrationDirectory: "database/migrations",
      runtimeWorkdir: ".rehearsal/runtime",
      image: "postgres:17-alpine",
    },
    baseline: {
      artifactDirectory: ".rehearsal",
      sanitizationPolicy: "policy.json",
    },
    application: {
      startCommand: "node --version",
      proofCommand: "node --version",
      environmentFile: ".rehearsal/runtime.env",
    },
    runtime: {
      target: "postgresql",
      projectId: `native-insights-${process.pid}-rehearsal`,
      databasePort: 58322,
      applicationUrl: "http://127.0.0.1:58323",
    },
    containerRuntime: { autoStartColima: false },
    safety: { hostedAccess: "disabled", outboundNetwork: "deny" },
  };
  const files = {
    "package.json": JSON.stringify({
      name: "private-native-insights",
      version: "0.0.0",
      private: true,
    }),
    "rehearsal.config.mjs": `export default ${JSON.stringify(config)};\n`,
    "policy.json": JSON.stringify({
      policyVersion: 1,
      migrationCutoff: "20261001000000",
      tables: [
        {
          name: "activity_probe",
          group: "synthetic",
          sourceRows: "STREAM AND SANITIZE",
          columns: ["id", "title"].map((name) => ({
            name,
            action: name === "id" ? "KEEP EXACTLY" : "REPLACE WITH SYNTHETIC",
            generated: "NEVER",
            identity: "NO",
            foreignKey: null,
          })),
        },
      ],
    }),
    "records.ndjson":
      JSON.stringify({
        table: "activity_probe",
        row: { id: 1, title: "NATIVE_SYNTHETIC_ROW" },
      }) + "\n",
    "ledger.json": JSON.stringify([
      { version: "20261001000000", name: "create_probe", statements: [sql] },
    ]),
    "database/migrations/20261001000000_create_probe.sql": sql + ";\n",
  };
  for (const [file, bytes] of Object.entries(files))
    await writeFile(join(workspace, file), bytes, { mode: 0o600, flag: "wx" });
  const npm = join(dirname(process.execPath), "npm");
  await run(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      coreArtifact,
    ],
    workspace,
  );
  const installed = JSON.parse(
    await readFile(
      join(workspace, "node_modules/@rehearsal-db/core/package.json"),
      "utf8",
    ),
  );
  assert.equal(installed.name, "@rehearsal-db/core");
  assert.equal(installed.version, coreVersion);
  const bin = resolve(
    workspace,
    "node_modules/@rehearsal-db/core",
    typeof installed.bin === "string" ? installed.bin : installed.bin.rehearsal,
  );
  assert.ok(bin.startsWith(`${workspace}/node_modules/@rehearsal-db/core/`));
  for (const args of [
    ["baseline", "create", "--records=records.ndjson", "--ledger=ledger.json"],
    ["doctor"],
  ]) {
    const envelope = JSON.parse(
      (await run(process.execPath, [bin, ...args, "--json"], workspace)).stdout,
    );
    assert.equal(envelope.status, "success");
    assert.equal(envelope.rehearsalVersion, coreVersion);
    if (args[0] === "doctor") assert.equal(envelope.data.state, "READY");
  }
  return nativeConsumerFingerprint(workspace);
}
