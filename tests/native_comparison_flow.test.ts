import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
} from "node:fs/promises";
import { readFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const readOwner = require("../scripts/native-editor-reads.cjs") as {
  readRegular(
    file: string,
    maximumBytes?: number,
  ): Promise<{ bytes: Buffer; stat: unknown }>;
};
const source = readFileSync(
  resolve(__dirname, "../scripts/native-comparison-export-test.cjs"),
  "utf8",
);
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

type Mode =
  | "normal"
  | "cancel-wrote"
  | "cancel-default-wrote"
  | "report-drift"
  | "dirty-report"
  | "missing-report"
  | "unknown-report"
  | "operator-delayed"
  | "operator-timeout";
async function runScenario(mode: Mode) {
  const base = resolve(__dirname, "../test-results");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "native-comparison-flow."));
  roots.push(root);
  const projectRoot = join(root, "project"),
    evidence = join(root, "evidence"),
    extensions = join(root, "extensions");
  await Promise.all([mkdir(projectRoot), mkdir(evidence), mkdir(extensions)]);
  const original = "// preserved synthetic configuration\n";
  const sourcePath = join(projectRoot, "rehearsal.config.mjs");
  const keyPath = join(projectRoot, "synthetic-private.key");
  await writeFile(sourcePath, original, { mode: 0o600 });
  await writeFile(keyPath, "synthetic-key-preservation-canary", {
    mode: 0o600,
  });
  const preserveFiles = await Promise.all(
    [sourcePath, keyPath].map(async (file) => ({
      path:
        file === sourcePath ? "rehearsal.config.mjs" : "synthetic-private.key",
      sha256: hash(await readFile(file)),
      mode: (await stat(file)).mode & 0o777,
    })),
  );
  const config = {
    scenario: "comparison-export",
    extensions,
    evidence,
    candidate: { version: "0.1.23", distribution: "published" },
    phasePath: join(evidence, "phase.json"),
    controlPath: join(evidence, "control.json"),
    resultPath: join(evidence, "native.json"),
    fixture: {
      projectRoot,
      configRelativePath: "rehearsal.config.mjs",
      coreVersion: "1.0.2",
      baselineGeneration: "active-generation",
      pinnedDockerEndpoint: "unix:///private/synthetic/docker.sock",
      applicationUrl: "http://127.0.0.1:54428",
      healthUrl: "http://127.0.0.1:54428/health",
      summaryUrl: "http://127.0.0.1:54428/summary",
      preserveFiles,
    },
  };
  const baseline = {
    generationId: "active-generation",
    rowCount: 10003,
    dataSha256: "a".repeat(64),
    generations: [
      {
        generationId: "active-generation",
        active: true,
        rowCount: 10003,
        tableCount: 3,
      },
      {
        generationId: "retained-generation",
        active: false,
        rowCount: 3,
        tableCount: 3,
      },
    ],
  };
  const commands: string[] = [],
    publicReads: string[] = [],
    acknowledgements: string[] = [];
  let phase = "initial",
    clock = 0,
    phaseStartedAt = 0,
    verified = false,
    jsonDestination: string | undefined,
    markdownDestination: string | undefined,
    disposed = 0;
  const folder = {
    name: "Synthetic fixture",
    uri: { fsPath: projectRoot, toString: () => "file:///synthetic-fixture" },
  };
  const extension = {
    extensionPath: join(extensions, "canonical-0.1.23"),
    packageJSON: { version: "0.1.23" },
    activate: async () => undefined,
  };
  const vscode = {
    version: "1.100.0",
    workspace: {
      isTrusted: true,
      workspaceFolders: [folder],
      get textDocuments() {
        return mode === "dirty-report" && verified && jsonDestination
          ? [
              {
                uri: { fsPath: jsonDestination },
                isDirty: true,
                isClosed: false,
              },
            ]
          : [];
      },
    },
    window: {
      terminals: [],
      onDidOpenTerminal: () => ({ dispose: () => disposed++ }),
      onDidStartTerminalShellExecution: () => ({ dispose: () => disposed++ }),
    },
    extensions: {
      getExtension: (id: string) =>
        id === "rehearsal-db.rehearsal-db" ? extension : undefined,
    },
    commands: {
      executeCommand: async (command: string) => {
        commands.push(command);
      },
    },
  };
  const jsonBytes = '{"fixture":"simulated report bytes"}\n',
    markdownBytes = "# Simulated report bytes\n";
  const writeJson = async (file: string, value: Record<string, unknown>) => {
    await writeFile(file, JSON.stringify(value));
    if (file !== config.phasePath) return;
    phase = String(value.phase);
    phaseStartedAt = clock;
    const instruction = String(value.instruction);
    const actions: Record<string, string> = {
      "comparison-setup": "begin-comparison",
      "comparison-active": "active-compared",
      "comparison-retained": "retained-compared",
      "export-cancel": "export-cancelled",
      "export-json": "report-saved",
      "export-markdown": "report-saved",
    };
    if (phase === "export-cancel") {
      const destination = instruction.match(
        /destination to (.+), then click Cancel/u,
      )?.[1];
      expect(destination).toBeDefined();
      if (mode === "cancel-wrote")
        await writeFile(destination!, "unexpected cancellation write");
      if (mode === "cancel-default-wrote")
        await writeFile(
          join(projectRoot, "default-report.json"),
          "unexpected default write",
        );
    }
    if (phase === "export-json" || phase === "export-markdown") {
      const destination = instruction.match(
        /real Save dialog: (.+)\. Save once/u,
      )?.[1];
      expect(destination).toBeDefined();
      if (phase === "export-json") jsonDestination = destination;
      else markdownDestination = destination;
      if (!(mode === "missing-report" && phase === "export-json"))
        await writeFile(
          destination!,
          phase === "export-json" ? jsonBytes : markdownBytes,
        );
    }
    acknowledgements.push(actions[phase]!);
    await writeFile(
      config.controlPath,
      JSON.stringify({
        schemaVersion: 1,
        nonce: value.nonce,
        action: actions[phase],
      }),
    );
  };
  const reads = {
    publicJson: async (parts: string[]) => {
      const command = parts.join(" ");
      publicReads.push(command);
      if (command === "activity") return { state: "idle" };
      if (command === "inspect baseline") return baseline;
      if (command === "candidates") return { candidateSha256: "b".repeat(64) };
      throw new Error("Unexpected public command.");
    },
    cleanup: async () => ({
      remaining: [],
      fallbackUsed: false,
      observationFailed: false,
      closeObservationFailed: false,
      failedReads: 0,
    }),
  };
  const exports = {} as { run(): Promise<void> };
  runInNewContext(
    source,
    {
      exports,
      process: { env: {}, versions: { node: process.versions.node } },
      Buffer,
      URL,
      Date: class extends Date {
        static override now() {
          return clock;
        }
      },
      require: (name: string) => {
        if (name === "node:timers/promises")
          return {
            setTimeout: async (milliseconds: number) => {
              clock += milliseconds;
            },
          };
        if (name === "vscode") return vscode;
        if (name === "./native-editor-driver.cjs")
          return { readConfiguration: async () => config };
        if (name === "./native-editor-reads.cjs")
          return {
            createReadClient: () => reads,
            writeJson,
            readRegular: async (file: string, limit?: number) => {
              if (
                file === config.controlPath &&
                (mode === "operator-timeout" ||
                  (mode === "operator-delayed" &&
                    clock - phaseStartedAt < 90000))
              )
                throw Object.assign(
                  new Error("No operator acknowledgement yet"),
                  {
                    code: "ENOENT",
                  },
                );
              if (
                mode === "unknown-report" &&
                phase === "export-json" &&
                file === config.controlPath
              )
                throw new Error("PRIVATE_CANARY control unavailable");
              return readOwner.readRegular(file, limit);
            },
          };
        if (name === "./native-comparison-evidence.cjs")
          return {
            verifyComparisonExport: (
              json: string,
              markdown: string,
              expected: Record<string, unknown>,
            ) => {
              expect(json).toBe(jsonBytes);
              expect(markdown).toBe(markdownBytes);
              expect(expected).toMatchObject({
                leftId: "target:primary",
                rightId: "baseline:retained-generation",
                baselineGeneration: "active-generation",
              });
              verified = true;
              if (mode === "report-drift")
                appendFileSync(jsonDestination!, " concurrent change");
              return { factCount: 14 };
            },
          };
        if (name.endsWith("/dist/src/environment_comparison.js")) return {};
        if (name.endsWith("/dist/src/verification_report.js"))
          return { verificationReportFilename: () => "default-report.json" };
        if (name.endsWith("/dist/src/contracts.js"))
          return {
            parseActivityData: (value: unknown) => value,
            parseEnvelope: (value: unknown) => value,
          };
        if (name.endsWith("/dist/src/review_contract.js"))
          return { parseBaselineInspectionData: (value: unknown) => value };
        if (name.startsWith("node:")) return require(name);
        throw new Error("Unexpected scenario dependency.");
      },
    },
    { filename: "native-comparison-export-test.cjs" },
  );
  let rejected = false;
  try {
    await exports.run();
  } catch {
    rejected = true;
  }
  const result = JSON.parse(await readFile(config.resultPath, "utf8"));
  expect(await readFile(sourcePath, "utf8")).toBe(original);
  expect(await readFile(keyPath, "utf8")).toBe(
    "synthetic-key-preservation-canary",
  );
  expect(result).not.toHaveProperty("rendered");
  expect(result).not.toHaveProperty("dialogObserved");
  expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
  expect(disposed).toBe(2);
  return {
    result,
    rejected,
    commands,
    publicReads,
    acknowledgements,
    jsonDestination,
    markdownDestination,
    clock,
  };
}

describe("comparison-export orchestration with simulated UI/API (not native acceptance)", () => {
  it("reads back and retains only explicit simulated exports without a terminal or lifecycle command", async () => {
    const observed = await runScenario("normal");
    expect(observed.rejected).toBe(false);
    expect(observed.result).toMatchObject({
      status: "passed",
      comparisonExportPassed: true,
      cancelledDestinationsAbsent: true,
      exportsRetainedForEvidence: true,
      noTerminalCommandsStarted: true,
      baselineGenerationPreserved: true,
    });
    expect(observed.commands).toEqual([
      "rehearsal.refresh",
      "rehearsal.openWorkspace",
    ]);
    expect(
      observed.publicReads.every((command) =>
        ["activity", "inspect baseline", "candidates"].includes(command),
      ),
    ).toBe(true);
    expect(observed.acknowledgements).toHaveLength(6);
    expect(await readFile(observed.jsonDestination!, "utf8")).toContain(
      "simulated report",
    );
    expect(await readFile(observed.markdownDestination!, "utf8")).toContain(
      "Simulated report",
    );
  });
  it.each([
    "cancel-wrote",
    "cancel-default-wrote",
    "report-drift",
    "dirty-report",
    "unknown-report",
  ] as const)(
    "fails and retains recovery state for %s without overwriting the configuration or key",
    async (mode) => {
      const observed = await runScenario(mode);
      expect(observed.rejected).toBe(true);
      expect(observed.result).toMatchObject({
        status: "failed",
        comparisonExportPassed: false,
        recoveryRequired: true,
      });
      expect(observed.commands).not.toContain("workbench.action.closeWindow");
    },
  );
  it("does not turn an acknowledged but absent file into successful export evidence", async () => {
    const observed = await runScenario("missing-report");
    expect(observed.rejected).toBe(true);
    expect(observed.result.status).toBe("failed");
    expect(observed.result.comparisonExportPassed).toBe(false);
  });
  it("allows a real operator acknowledgement after 60 seconds but within the approved 180-second bound", async () => {
    const observed = await runScenario("operator-delayed");
    expect(observed.rejected).toBe(false);
    expect(observed.result.operatorAcknowledgements).toHaveLength(6);
    expect(observed.clock).toBe(6 * 90000);
  });
  it("fails at 180 seconds without an acknowledgement and preserves recovery evidence", async () => {
    const observed = await runScenario("operator-timeout");
    expect(observed.rejected).toBe(true);
    expect(observed.result.comparisonExportPassed).toBe(false);
    expect(observed.result.operatorAcknowledgements).toHaveLength(0);
    expect(observed.clock).toBe(180000);
  });
});
