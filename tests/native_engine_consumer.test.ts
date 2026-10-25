import { createHash } from "node:crypto";
import { parseConfigurationMetadata } from "../src/configuration_contract.js";
import { workspaceFormDraftIdentity } from "../src/workspace_form_drafts.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareNativeEngineConsumer } from "../scripts/native-engine-consumer.js";
import {
  enginePreviewSnapshot,
  parseNativeEngineFixture,
} from "../scripts/engine-lifecycle-fixture.js";
import { nativeConsumerFingerprint } from "../scripts/native-insights-consumer.js";
import {
  runRehearsalJson,
  runVersion,
  runEngineShutdown,
  captureEnginePackageBinding,
} from "../src/process_adapter.js";
import { parseEngineShutdownPreview } from "../src/engine_lifecycle_contract.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("owned synthetic engine public CLI", () => {
  it("executes only declared public fixture commands and binds typed success/uncertainty without changing its package", async () => {
    const root = await mkdtemp(join(tmpdir(), "native-engine-ui-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const snapshot = enginePreviewSnapshot("running");
    if (snapshot.engineLifecycle?.state !== "available")
      throw Error("fixture missing");
    const fixture = parseNativeEngineFixture({
      schemaVersion: 1,
      kind: "engine-lifecycle-native-fixture",
      coreVersion: "1.4.0-dev.1",
      candidateSha256: "b".repeat(64),
      coreArtifactSha256: "c".repeat(64),
      status: snapshot.engineLifecycle.report,
    });
    const fingerprint = await prepareNativeEngineConsumer(
      workspace,
      root,
      fixture,
    );
    const metadata = parseConfigurationMetadata(
      JSON.parse(
        await readFile(
          join(root, "engine-configuration-metadata.json"),
          "utf8",
        ),
      ),
    );
    expect(metadata.sourceSha256).toBe(
      createHash("sha256")
        .update(await readFile(join(workspace, metadata.path)))
        .digest("hex"),
    );
    expect(
      workspaceFormDraftIdentity({
        ...snapshot,
        workspaceRoot: workspace,
        configPath: metadata.path,
        configurationMetadata: metadata,
      }),
    ).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      workspaceFormDraftIdentity({
        ...snapshot,
        workspaceRoot: workspace,
        configPath: "missing.mjs",
      }),
    ).toBeNull();
    expect((await runVersion(workspace)).version).toBe(fixture.coreVersion);
    const preview = parseEngineShutdownPreview(
      (
        await runRehearsalJson({
          workspaceRoot: workspace,
          command: ["engine", "stop"],
          expectedCommand: "engine stop",
        })
      ).result.data,
    );
    expect(preview.state).toBe("review-required");
    const packageBinding = await captureEnginePackageBinding(workspace);
    let dispatched = 0;
    for (const scenario of ["confirm-success", "confirm-uncertain"]) {
      await writeFile(
        join(root, "engine-scenario.json"),
        JSON.stringify({ scenario }),
      );
      const result = await runEngineShutdown({
        workspaceRoot: workspace,
        confirmationDigest: preview.consentDigest!,
        packageBinding,
        onDispatched: () => {
          dispatched++;
        },
      });
      expect(result.status).toBe(
        scenario === "confirm-success" ? "stopped" : "unknown",
      );
    }
    expect(dispatched).toBe(2);
    expect(
      (await readFile(join(root, "engine-dispatch.jsonl"), "utf8"))
        .trim()
        .split("\n"),
    ).toHaveLength(2);
    expect(await nativeConsumerFingerprint(workspace)).toBe(fingerprint);
  });
});
