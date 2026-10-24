import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  nativeConsumerFingerprint,
  prepareNativeConsumerRemoval,
  prepareNativeInsightsConsumer,
} from "../scripts/native-insights-consumer.js";

describe("owned canonical Insights consumer", () => {
  it("removes only owned immutable generation directories without following links", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-removal-"));
    try {
      const generations = join(root, ".rehearsal/generations"),
        child = join(generations, "owned/migrations");
      await mkdir(child, { recursive: true });
      await writeFile(join(child, "source.sql"), "synthetic", { mode: 0o400 });
      await chmod(child, 0o500);
      await chmod(join(generations, "owned"), 0o500);
      await prepareNativeConsumerRemoval(root);
      await rm(generations, { recursive: true });
      await symlink("..", generations);
      await expect(prepareNativeConsumerRemoval(root)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("detects changed bytes, inventory and modes, permits internal links and refuses escaping links", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-consumer-"));
    try {
      const file = join(root, "file");
      await writeFile(file, "original", { mode: 0o600 });
      await symlink("file", join(root, "internal"));
      const initial = await nativeConsumerFingerprint(root);
      await writeFile(file, "changed");
      expect(await nativeConsumerFingerprint(root)).not.toBe(initial);
      await writeFile(file, "original");
      expect(await nativeConsumerFingerprint(root)).toBe(initial);
      await chmod(file, 0o400);
      expect(await nativeConsumerFingerprint(root)).not.toBe(initial);
      await symlink("..", join(root, "outside"));
      await expect(nativeConsumerFingerprint(root)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("prepares only a synthetic file baseline and ready doctor through the supplied bounded runner", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-prepare-"));
    try {
      await mkdir(join(root, "database/migrations"), { recursive: true });
      const commands: string[][] = [];
      const fingerprint = await prepareNativeInsightsConsumer({
        workspace: root,
        coreArtifact: "/private-reviewed/core.tgz",
        coreVersion: "1.2.0",
        run: async (command, args, cwd) => {
          expect(cwd).toBe(root);
          commands.push([command, ...args]);
          if (args[0] === "install") {
            await mkdir(join(root, "node_modules/@rehearsal-db/core"), {
              recursive: true,
            });
            await writeFile(
              join(root, "node_modules/@rehearsal-db/core/package.json"),
              JSON.stringify({
                name: "@rehearsal-db/core",
                version: "1.2.0",
                bin: { rehearsal: "bin/rehearsal.mjs" },
              }),
            );
            return { stdout: "" };
          }
          return {
            stdout: JSON.stringify({
              status: "success",
              rehearsalVersion: "1.2.0",
              data: { state: "READY" },
            }),
          };
        },
      });
      expect(commands).toHaveLength(3);
      expect(commands[0]!.slice(1)).toEqual([
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--save-exact",
        "/private-reviewed/core.tgz",
      ]);
      expect(commands[1]!.slice(2)).toEqual([
        "baseline",
        "create",
        "--records=records.ndjson",
        "--ledger=ledger.json",
        "--json",
      ]);
      expect(commands[2]!.slice(2)).toEqual(["doctor", "--json"]);
      expect(fingerprint).toBe(await nativeConsumerFingerprint(root));
      const config = await readFile(join(root, "rehearsal.config.mjs"), "utf8");
      expect(config).toContain('"autoStartColima":false');
      expect(config).toContain('"hostedAccess":"disabled"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
