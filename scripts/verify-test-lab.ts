import { execFile } from "node:child_process";
import { chmod, cp, lstat, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { inspectProject } from "../src/project_snapshot.js";

const execFileAsync = promisify(execFile);
const labRoot = resolve(__dirname, "../../rehearsal-test-lab");

const makeTemporaryCopyWritable = async (path: string): Promise<void> => {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) return;
  if (metadata.isDirectory()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path)) {
      await makeTemporaryCopyWritable(resolve(path, entry));
    }
    return;
  }
  await chmod(path, 0o600);
};

const copyProject = async (
  sourceName: "postgresql" | "library",
  destinationRoot: string,
): Promise<string> => {
  const destination = resolve(destinationRoot, sourceName);
  await cp(resolve(labRoot, "projects", sourceName), destination, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => basename(source) !== "node_modules",
  });
  return destination;
};

const installCandidate = async (
  workspaceRoot: string,
  artifactPath: string,
): Promise<void> => {
  await execFileAsync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-save",
      "--no-audit",
      "--no-fund",
      artifactPath,
    ],
    { cwd: workspaceRoot, maxBuffer: 4 * 1024 * 1024 },
  );
};

const main = async (): Promise<void> => {
  const artifactArgument = process.argv[2];
  if (!artifactArgument) {
    throw new Error(
      "Pass the exact Rehearsal package artifact: npm run test:lab -- /absolute/path/to/package.tgz",
    );
  }
  const artifactPath = resolve(artifactArgument);
  if (!(await stat(artifactPath)).isFile()) {
    throw new Error("The Rehearsal package artifact is not a regular file.");
  }

  const temporaryRoot = await mkdtemp(
    resolve(tmpdir(), "rehearsal-vscode-lab-"),
  );
  try {
    const [postgresqlRoot, libraryRoot] = await Promise.all([
      copyProject("postgresql", temporaryRoot),
      copyProject("library", temporaryRoot),
    ]);
    await Promise.all([
      installCandidate(postgresqlRoot, artifactPath),
      installCandidate(libraryRoot, artifactPath),
    ]);

    const ready = await inspectProject({
      workspaceName: "Test Lab PostgreSQL",
      workspaceRoot: postgresqlRoot,
      trusted: true,
    });
    if (ready.availability !== "ready") {
      const failedChecks = ready.readiness?.checks
        .filter(({ status }) => status === "fail")
        .map(({ id }) => id)
        .join(", ");
      throw new Error(
        `Expected ready Test Lab project; received ${ready.availability}${failedChecks ? ` (${failedChecks})` : ""}.`,
      );
    }
    if (!ready.version || ready.baseline?.rowCount !== 10_003) {
      throw new Error(
        "The Test Lab overview did not preserve the installed version and safe aggregate baseline count.",
      );
    }
    if (
      !ready.packageLocation?.endsWith("node_modules/@rehearsal-db/core") ||
      ready.candidates?.targets.length !== 1
    ) {
      throw new Error(
        `The Test Lab overview did not expose the project package location and configured target (package=${ready.packageLocation ?? "missing"}, targets=${String(ready.candidates?.targets.length ?? "missing")}).`,
      );
    }
    if (
      ready.activity?.state !== "idle" ||
      ready.runtime?.targets.length !== 1 ||
      ready.runtime.targets[0]?.runtimeTarget !== "postgresql"
    ) {
      throw new Error(
        "The Test Lab overview did not consume the structured activity and runtime contracts.",
      );
    }
    if (ready.applicationUrl !== "http://localhost:5176") {
      throw new Error(
        "The Test Lab overview did not expose the configured loopback application URL.",
      );
    }

    const newUser = await inspectProject({
      workspaceName: "Test Lab Library",
      workspaceRoot: libraryRoot,
      trusted: true,
    });
    if (newUser.availability !== "not_ready") {
      throw new Error(
        `Expected clean-room project to need setup; received ${newUser.availability}.`,
      );
    }
    if (
      newUser.activity?.state !== "idle" ||
      newUser.readiness?.checks[0]?.id !== "configuration"
    ) {
      throw new Error(
        "The Test Lab overview did not retain safe activity and missing-configuration guidance.",
      );
    }

    console.log(
      JSON.stringify(
        {
          status: "passed",
          artifact: basename(artifactPath),
          installedVersion: ready.version,
          readyProject: {
            configPath: ready.configPath,
            packageLocation: ready.packageLocation,
            targetCount: ready.candidates.targets.length,
            baselineRows: ready.baseline.rowCount,
            candidateCount: ready.candidates.count,
            applicationUrl: ready.applicationUrl,
            activityState: ready.activity.state,
            runtimeState: ready.runtime.state,
            runtimeTarget: ready.runtime.targets[0]?.runtimeTarget,
          },
          cleanRoomProject: {
            availability: newUser.availability,
            activityState: newUser.activity.state,
            firstFailedCheck: newUser.readiness.checks[0]?.id,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await makeTemporaryCopyWritable(temporaryRoot);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
