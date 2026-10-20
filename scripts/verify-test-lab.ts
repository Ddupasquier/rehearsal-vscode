import { execFile } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { inspectProject } from "../src/project_snapshot.js";
import {
  bootstrapProjectDiscovery,
  type WorkspaceEntryKind,
} from "../src/bootstrap_discovery.js";

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

const bootstrapProfile = async (workspaceRoot: string, workspaceName: string) =>
  bootstrapProjectDiscovery({
    workspaceName,
    async kind(path): Promise<WorkspaceEntryKind> {
      try {
        const metadata = await lstat(resolve(workspaceRoot, path));
        if (metadata.isSymbolicLink()) return "symlink";
        if (metadata.isFile()) return "file";
        if (metadata.isDirectory()) return "directory";
        return null;
      } catch {
        return null;
      }
    },
    async readText(path, maximumBytes): Promise<string | null> {
      try {
        const target = resolve(workspaceRoot, path);
        const metadata = await lstat(target);
        if (
          metadata.isSymbolicLink() ||
          !metadata.isFile() ||
          metadata.size > maximumBytes
        ) {
          return null;
        }
        return await readFile(target, "utf8");
      } catch {
        return null;
      }
    },
  });

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
      bootstrapDiscovery: await bootstrapProfile(
        postgresqlRoot,
        "Test Lab PostgreSQL",
      ),
    });
    if (ready.availability !== "ready") {
      const failedChecks = ready.readiness?.checks
        .filter(({ status }) => status === "fail")
        .map(({ id }) => id)
        .join(", ");
      throw new Error(
        `Expected ready Test Lab project; received ${ready.availability}${failedChecks ? ` (${failedChecks})` : ""}${ready.error ? ` (${ready.error.code}: ${ready.error.message})` : ""}.`,
      );
    }
    if (!ready.version || ready.baseline?.rowCount !== 10_003) {
      throw new Error(
        "The Test Lab overview did not preserve the installed version and safe aggregate baseline count.",
      );
    }
    if (
      !ready.baseline.generations?.some(({ active }) => active) ||
      ready.baseline.generations.length < 2
    ) {
      throw new Error(
        "The Test Lab overview did not expose active and retained baseline versions.",
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
    const runtimeTarget = ready.runtime?.targets[0];
    if (
      ready.activity?.state !== "idle" ||
      ready.runtime?.targets.length !== 1 ||
      runtimeTarget?.runtimeTarget !== "postgresql" ||
      typeof runtimeTarget.verifiedRuntimeAvailable !== "boolean" ||
      ready.runtime.state !== runtimeTarget.state
    ) {
      throw new Error(
        `The Test Lab overview did not consume the structured activity and runtime contracts (activity=${ready.activity?.state ?? "missing"}, targetCount=${String(ready.runtime?.targets.length ?? "missing")}, runtimeState=${ready.runtime?.state ?? "missing"}, targetState=${runtimeTarget?.state ?? "missing"}, runtimeTarget=${runtimeTarget?.runtimeTarget ?? "missing"}, verifiedRuntimeAvailable=${String(runtimeTarget?.verifiedRuntimeAvailable ?? "missing")}).`,
      );
    }
    if (ready.applicationUrl !== "http://127.0.0.1:5176") {
      throw new Error(
        "The Test Lab overview did not expose the configured loopback application URL.",
      );
    }
    if (
      ready.resources?.schemaVersion !== 1 ||
      ready.resources.engine.state !== "running" ||
      ready.resources.environments.length !== 1 ||
      ready.resources.environments[0]?.provider !== "postgresql" ||
      ready.resources.environments[0]?.projectId !==
        "rehearsal-test-lab-postgresql-rehearsal"
    ) {
      throw new Error(
        "The Test Lab overview did not consume the ownership-scoped resource inventory.",
      );
    }
    if (
      !ready.discovery ||
      !ready.discovery.profile.detected.some(
        ({ id }) => id === "database.migrationDirectories",
      ) ||
      !ready.discovery.profile.suggested.some(
        ({ id }) => id === "application.proofCommand",
      ) ||
      !ready.discovery.profile.decisions.some(
        ({ id }) => id === "privacy.productionData",
      )
    ) {
      throw new Error(
        "The Test Lab overview did not consume the versioned core discovery profile.",
      );
    }

    const newUser = await inspectProject({
      workspaceName: "Test Lab Library",
      workspaceRoot: libraryRoot,
      trusted: true,
      bootstrapDiscovery: await bootstrapProfile(
        libraryRoot,
        "Test Lab Library",
      ),
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
    if (
      !newUser.discovery ||
      newUser.discovery.profile.configuration.state !== "missing"
    ) {
      throw new Error(
        "The clean-room project did not retain its safe missing-configuration profile.",
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
            retainedBaselines: ready.baseline.generations.length,
            candidateCount: ready.candidates.count,
            applicationUrl: ready.applicationUrl,
            activityState: ready.activity.state,
            runtimeState: ready.runtime.state,
            runtimeTarget: ready.runtime.targets[0]?.runtimeTarget,
            verifiedRuntimeAvailable:
              ready.runtime.targets[0]?.verifiedRuntimeAvailable,
            resourceEngine: ready.resources.engine.state,
            resourceTarget: ready.resources.environments[0]?.projectId,
            dockerDiskPercent: ready.resources.engine.disk?.usedPercent ?? null,
            discoverySource: ready.discovery.source,
            detected: ready.discovery.profile.detected.length,
            suggested: ready.discovery.profile.suggested.length,
            decisions: ready.discovery.profile.decisions.length,
          },
          cleanRoomProject: {
            availability: newUser.availability,
            activityState: newUser.activity.state,
            firstFailedCheck: newUser.readiness.checks[0]?.id,
            discoverySource: newUser.discovery.source,
            configurationState: newUser.discovery.profile.configuration.state,
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
