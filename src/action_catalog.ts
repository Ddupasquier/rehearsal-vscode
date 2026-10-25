import type { ProjectSnapshot } from "./project_snapshot.js";
import { engineShutdownAvailable } from "./engine_lifecycle_view.js";
import { isPublishedVersion } from "./update_advisory.js";
import type { TerminalShellFamily } from "./platform_runtime.js";

export type WorkspaceActionId =
  | "refresh"
  | "installPackage"
  | "updatePackage"
  | "guidedSetup"
  | "doctor"
  | "reviewPlan"
  | "runRehearsal"
  | "migrate"
  | "openSandbox"
  | "startRuntime"
  | "verify"
  | "reset"
  | "stopRuntime"
  | "shutdownVm"
  | "discardRuntime"
  | "cleanupPreview"
  | "identityConnect"
  | "supportReport"
  | "openConfig"
  | "openApplication"
  | "documentation"
  | "showOutput"
  | "inspectionSettings"
  | "cancelOwnedOperation"
  | "manageTrust"
  | "checkUpdates";
// Update freshness is separate from the minimum compatibility warning.

export const WORKSPACE_ACTION_IDS: readonly WorkspaceActionId[] = [
  "refresh",
  "installPackage",
  "updatePackage",
  "guidedSetup",
  "doctor",
  "reviewPlan",
  "runRehearsal",
  "migrate",
  "openSandbox",
  "startRuntime",
  "verify",
  "reset",
  "stopRuntime",
  "shutdownVm",
  "discardRuntime",
  "cleanupPreview",
  "identityConnect",
  "supportReport",
  "openConfig",
  "openApplication",
  "documentation",
  "showOutput",
  "inspectionSettings",
  "cancelOwnedOperation",
  "manageTrust",
  "checkUpdates",
];

export type WorkspaceActionKind =
  | "refresh"
  | "check_updates"
  | "terminal"
  | "open_config"
  | "open_application"
  | "documentation"
  | "show_output"
  | "inspection_settings"
  | "cancel_owned_operation"
  | "manage_trust"
  | "review_engine_shutdown";

export interface WorkspaceActionPlan {
  readonly id: WorkspaceActionId;
  readonly kind: WorkspaceActionKind;
  readonly label: string;
  readonly detail: string;
  readonly arguments?: readonly string[];
  readonly confirmation?: {
    readonly title: string;
    readonly detail: string;
    readonly confirmLabel: string;
    readonly destructive?: boolean;
  };
}

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

const packageManagerFor = (snapshot: ProjectSnapshot): PackageManager => {
  const item = snapshot.discovery?.profile.detected.find(
    ({ id }) => id === "package.manager",
  );
  const value = item?.value;
  return value === "pnpm" || value === "yarn" || value === "bun"
    ? value
    : "npm";
};

export const packageInstallArguments = (
  snapshot: ProjectSnapshot,
  version = "latest",
): readonly string[] => {
  if (version !== "latest" && !isPublishedVersion(version))
    throw new Error("Invalid reviewed update version.");
  const dependency = `@rehearsal-db/core@${version}`;
  switch (packageManagerFor(snapshot)) {
    case "pnpm":
      return ["pnpm", "add", "--save-dev", dependency];
    case "yarn":
      return ["yarn", "add", "--dev", dependency];
    case "bun":
      return ["bun", "add", "--dev", dependency];
    case "npm":
      return ["npm", "install", "--save-dev", dependency];
  }
};

/** Opt-in freshness updates preserve the proven npm dependency group and exact pin. */
export const exactPackageUpdateArguments = (
  version: string,
  group: import("./update_advisory.js").DependencyGroup,
): readonly string[] => {
  if (
    !isPublishedVersion(version) ||
    !["dependencies", "devDependencies", "optionalDependencies"].includes(group)
  )
    throw new Error("Invalid reviewed update.");
  const flag =
    group === "dependencies"
      ? "--save-prod"
      : group === "optionalDependencies"
        ? "--save-optional"
        : "--save-dev";
  return [
    "npm",
    "install",
    flag,
    "--save-exact",
    `@rehearsal-db/core@${version}`,
  ];
};

const rehearsalArguments = (
  snapshot: ProjectSnapshot,
  ...command: readonly string[]
): readonly string[] => [
  "npx",
  "--no-install",
  "rehearsal",
  ...command,
  ...(snapshot.configPath ? [`--config=${snapshot.configPath}`] : []),
];

const terminalPlan = (
  snapshot: ProjectSnapshot,
  id: WorkspaceActionId,
  label: string,
  detail: string,
  command: readonly string[],
  confirmation?: WorkspaceActionPlan["confirmation"],
): WorkspaceActionPlan => ({
  id,
  kind: "terminal",
  label,
  detail,
  arguments: rehearsalArguments(snapshot, ...command),
  ...(confirmation ? { confirmation } : {}),
});

const hasVerifiedRuntime = (snapshot: ProjectSnapshot): boolean =>
  Boolean(
    snapshot.runtime?.targets.length &&
    snapshot.runtime.targets.every(
      ({ verifiedRuntimeAvailable }) => verifiedRuntimeAvailable === true,
    ),
  );

export const workspaceActionPlan = (
  snapshot: ProjectSnapshot,
  id: WorkspaceActionId,
): WorkspaceActionPlan | null => {
  if (
    snapshot.error?.code === "platform_unsupported" &&
    !["refresh", "documentation", "showOutput", "checkUpdates"].includes(id)
  )
    return null;
  if (
    ["runRehearsal", "migrate", "reset", "discardRuntime"].includes(id) &&
    snapshot.resources?.environments.some(
      (environment) => environment.protected,
    )
  )
    return null;
  switch (id) {
    case "shutdownVm":
      return engineShutdownAvailable(snapshot)
        ? {
            id,
            kind: "review_engine_shutdown",
            label: "Shut down VM",
            detail:
              "Review the shared VM and all affected workloads before a graceful shutdown.",
          }
        : null;
    case "checkUpdates":
      return {
        id,
        kind: "check_updates",
        label: "Check for updates",
        detail:
          "Review optional public release checks without changing project inspection.",
      };
    case "refresh":
      return {
        id,
        kind: "refresh",
        label: "Refresh project",
        detail: "Read the latest safe project state.",
      };
    case "inspectionSettings":
      if (snapshot.error?.code !== "timeout") return null;
      return {
        id,
        kind: "inspection_settings",
        label: "Adjust inspection timeout",
        detail:
          "Open this workspace's bounded Rehearsal inspection timeout setting.",
      };
    case "installPackage":
      if (snapshot.availability !== "package_missing") return null;
      return {
        id,
        kind: "terminal",
        label: "Install Rehearsal",
        detail: "Add the current Rehearsal package to this project.",
        arguments: packageInstallArguments(snapshot),
        confirmation: {
          title: "Install Rehearsal in this project?",
          detail:
            "This updates the project manifest, lockfile, and local dependencies using the detected package manager.",
          confirmLabel: "Install Rehearsal",
        },
      };
    case "updatePackage":
      if (snapshot.availability !== "package_outdated") return null;
      return {
        id,
        kind: "terminal",
        label: "Update Rehearsal",
        detail: `Replace ${snapshot.version ?? "the installed version"} with the current supported release.`,
        arguments: packageInstallArguments(snapshot),
        confirmation: {
          title: "Update Rehearsal in this project?",
          detail:
            "This updates the project manifest, lockfile, and local dependencies. Review the resulting dependency diff before committing it.",
          confirmLabel: "Update Rehearsal",
        },
      };
    case "guidedSetup":
      if (snapshot.availability === "package_missing") return null;
      return terminalPlan(
        snapshot,
        id,
        "Open guided setup",
        "Use Rehearsal's interactive, state-aware guide.",
        [],
      );
    case "doctor":
      if (snapshot.availability === "package_missing") return null;
      return terminalPlan(
        snapshot,
        id,
        "Run Doctor",
        "Check readiness and show beginner-friendly fixes.",
        ["doctor"],
      );
    case "reviewPlan":
      if (!snapshot.candidates) return null;
      return terminalPlan(
        snapshot,
        id,
        "Review migration plan",
        "Print the exact local execution plan.",
        ["explain"],
      );
    case "runRehearsal":
      if (!snapshot.candidates || snapshot.availability !== "ready")
        return null;
      if (snapshot.candidates.count === 0) {
        return terminalPlan(
          snapshot,
          id,
          "Create sandbox",
          "Restore the verified baseline and create this project's disposable runtime.",
          ["run"],
          {
            title: "Create this project's disposable sandbox?",
            detail:
              "Rehearsal will restore the verified baseline into project-owned local resources. There are no candidate migrations waiting.",
            confirmLabel: "Create Sandbox",
          },
        );
      }
      return terminalPlan(
        snapshot,
        id,
        "Run rehearsal",
        "Restore the baseline, apply this exact candidate set, and run verification.",
        ["run", `--confirm-candidates=${snapshot.candidates.digest}`],
        {
          title: `Run ${snapshot.candidates.count} candidate migration${snapshot.candidates.count === 1 ? "" : "s"}?`,
          detail:
            "Rehearsal will reset only this project's disposable runtime to its verified baseline before applying the exact displayed candidate digest.",
          confirmLabel: "Run Rehearsal",
        },
      );
    case "migrate":
      if (
        !snapshot.candidates ||
        snapshot.candidates.count === 0 ||
        !hasVerifiedRuntime(snapshot)
      )
        return null;
      return terminalPlan(
        snapshot,
        id,
        "Apply without reset",
        "Apply the exact candidate set to the current disposable runtime.",
        ["migrate", `--confirm-candidates=${snapshot.candidates.digest}`],
        {
          title: "Apply candidates without restoring the baseline?",
          detail:
            "Existing sandbox changes will remain. Use a full rehearsal when you need a clean, reproducible result.",
          confirmLabel: "Apply Candidates",
        },
      );
    case "openSandbox":
      if (
        snapshot.availability !== "ready" ||
        !hasVerifiedRuntime(snapshot) ||
        !snapshot.configuration?.application.readinessUrl
      )
        return null;
      return terminalPlan(
        snapshot,
        id,
        "Open sandbox",
        "Start the local targets and keep the application available for hands-on testing.",
        ["open"],
        {
          title: "Open the Rehearsal sandbox?",
          detail:
            "This may start local database and application processes. Rehearsal will not contact a hosted database.",
          confirmLabel: "Open Sandbox",
        },
      );
    case "startRuntime":
      if (snapshot.availability !== "ready" || !hasVerifiedRuntime(snapshot))
        return null;
      return terminalPlan(
        snapshot,
        id,
        "Start runtime",
        "Start only this project's verified local database targets.",
        ["start"],
        {
          title: "Start this project's local runtime?",
          detail:
            "This may start Docker-compatible local services, but it will not stop or modify another project's runtime.",
          confirmLabel: "Start Runtime",
        },
      );
    case "verify":
      if (snapshot.availability !== "ready" || !hasVerifiedRuntime(snapshot))
        return null;
      return terminalPlan(
        snapshot,
        id,
        "Verify sandbox",
        "Check the current local runtime against its immutable baseline and migration history.",
        ["verify"],
      );
    case "reset":
      if (snapshot.availability !== "ready" || !hasVerifiedRuntime(snapshot))
        return null;
      return terminalPlan(
        snapshot,
        id,
        "Reset sandbox",
        "Restore this project's disposable runtime from its immutable baseline.",
        ["reset"],
        {
          title: "Reset this disposable sandbox?",
          detail:
            "This removes changes made inside the current Rehearsal runtime. It does not delete the approved baseline or another project's data.",
          confirmLabel: "Reset Sandbox",
          destructive: true,
        },
      );
    case "stopRuntime":
      if (snapshot.availability !== "ready" || !hasVerifiedRuntime(snapshot))
        return null;
      return terminalPlan(
        snapshot,
        id,
        "Stop project services",
        "Stop only this project's local Rehearsal services while preserving their data.",
        ["stop"],
        {
          title: "Stop this project's Rehearsal runtime?",
          detail:
            "The disposable database and Storage data are preserved for the next start.",
          confirmLabel: "Stop Runtime",
        },
      );
    case "discardRuntime":
      if (snapshot.availability !== "ready" || !hasVerifiedRuntime(snapshot))
        return null;
      return terminalPlan(
        snapshot,
        id,
        "Discard runtime",
        "Remove only this project's disposable runtime.",
        ["discard"],
        {
          title: "Discard this disposable runtime?",
          detail:
            "This deletes this project's disposable database and Storage volumes, including all current sandbox edits. The immutable baseline remains available to recreate the sandbox. Other projects' containers and volumes are preserved. The shared engine is preserved unless your explicitly enabled owner-only Colima policy verifies that Rehearsal started that exact idle engine boot and no containers are running.",
          confirmLabel: "Discard Runtime",
          destructive: true,
        },
      );
    case "cleanupPreview":
      if (snapshot.availability === "package_missing") return null;
      return terminalPlan(
        snapshot,
        id,
        "Preview cleanup",
        "Show exactly which Rehearsal-owned resources are eligible without deleting anything.",
        ["cleanup"],
      );
    case "identityConnect":
      if (snapshot.availability !== "ready" || !hasVerifiedRuntime(snapshot))
        return null;
      return terminalPlan(
        snapshot,
        id,
        "Connect signed-in account",
        "Keep the sandbox open and guide a reviewed local identity association.",
        ["identity", "connect"],
      );
    case "supportReport":
      if (snapshot.availability === "package_missing") return null;
      return terminalPlan(
        snapshot,
        id,
        "Create support report",
        "Print Rehearsal's redacted, copy-ready diagnostic report.",
        ["support"],
      );
    case "openConfig":
      if (!snapshot.configPath) return null;
      return {
        id,
        kind: "open_config",
        label: "Open configuration",
        detail: "Review the active project-local Rehearsal configuration.",
      };
    case "openApplication":
      if (!snapshot.applicationUrl) return null;
      return {
        id,
        kind: "open_application",
        label: "Open application",
        detail: "Open the configured loopback application URL.",
      };
    case "documentation":
      return {
        id,
        kind: "documentation",
        label: "Open documentation",
        detail: "Read the Rehearsal guides.",
      };
    case "showOutput":
      return {
        id,
        kind: "show_output",
        label: "Open diagnostics",
        detail: "Show the extension's bounded inspection log.",
      };
    case "cancelOwnedOperation":
      return {
        id,
        kind: "cancel_owned_operation",
        label: "Cancel editor-started operation",
        detail:
          "Stop only a Rehearsal terminal operation started by this extension.",
      };
    case "manageTrust":
      if (snapshot.availability !== "untrusted") return null;
      return {
        id,
        kind: "manage_trust",
        label: "Review Workspace Trust",
        detail:
          "Use VS Code's trust review before Rehearsal runs a local process.",
      };
  }
};

export const shellCommand = (
  arguments_: readonly string[],
  shell: TerminalShellFamily = "posix",
): string =>
  shell === "powershell"
    ? `& ${arguments_.map((argument) => `'${argument.replaceAll("'", "''")}'`).join(" ")}`
    : arguments_
        .map((argument) => `'${argument.replaceAll("'", `'"'"'`)}'`)
        .join(" ");
