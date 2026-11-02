/** Pure dashboard guidance; recorded proof and current database state remain separate. */
import type { ProjectSnapshot } from "../inspection/project_snapshot.js";
import { openSandboxSessionState } from "../../runtime/operations/operation_progress.js";
import { workspaceExecutionState } from "./workspace_view_state.js";

export type StatusTone = "success" | "warning" | "active" | "muted";

interface ProductStatus {
  readonly label: string;
  readonly detail: string;
  readonly tone: StatusTone;
}

interface JourneyStep {
  readonly label: string;
  readonly value: string;
  readonly state: "done" | "current" | "waiting";
}

type VerifiedRuntimeState = "available" | "missing" | "unknown";

export const verifiedRuntimeState = (
  snapshot: ProjectSnapshot,
): VerifiedRuntimeState => {
  const targets = snapshot.runtime?.targets;
  if (!targets || targets.length === 0) return "unknown";
  if (
    targets.some(({ verifiedRuntimeAvailable }) => !verifiedRuntimeAvailable)
  ) {
    return targets.some(
      ({ verifiedRuntimeAvailable }) => verifiedRuntimeAvailable === false,
    )
      ? "missing"
      : "unknown";
  }
  return "available";
};

/** Fixed presentation copy is also serialized into the browser controller. */
export const sandboxSessionPresentation = (
  state: ReturnType<typeof openSandboxSessionState>,
) => {
  switch (state) {
    case "interactive":
      return {
        label: "Sandbox running",
        detail:
          "Your application passed readiness and is open for hands-on testing.",
        guidance:
          "Your sandbox is running. Keep its terminal session open while you test. Press Ctrl+C or Ctrl+Z in that terminal when you are done.",
      };
    case "opening":
      return {
        label: "Opening sandbox",
        detail: "Rehearsal is starting and checking your local application.",
        guidance:
          "Follow startup in the owning terminal. SANDBOX READY confirms when you can begin hands-on testing.",
      };
    case "closing":
      return {
        label: "Closing sandbox",
        detail:
          "The session is ending; review shutdown in its owning terminal.",
        guidance:
          "Check the owning terminal for shutdown and cleanup. Wait for the session to finish before starting another operation.",
      };
    case "unknown":
      return {
        label: "Sandbox session open",
        detail:
          "Application readiness is not confirmed by the available activity details.",
        guidance:
          "Your sandbox session stays open for hands-on testing. Check its owning terminal for SANDBOX READY; you do not need to wait for the session to end.",
      };
    default:
      return null;
  }
};

export const statusFor = (snapshot: ProjectSnapshot): ProductStatus => {
  switch (snapshot.availability) {
    case "loading":
      return {
        label: "Checking your project",
        detail:
          "Reading safe, project-local metadata. No project operation is being started.",
        tone: "active",
      };
    case "ready":
      if (snapshot.readiness?.state !== "READY")
        return {
          label: "Project readiness needs review",
          detail: "Refresh the project check before starting a sandbox.",
          tone: "warning",
        };
      if (
        snapshot.resources?.environments.some(
          (environment) => environment.protected,
        )
      )
        return {
          label: "Sandbox data is protected",
          detail:
            "Inspect or resume your sandbox. Review its protection policy before replacing or discarding data.",
          tone: "warning",
        };
      if (verifiedRuntimeState(snapshot) === "missing") {
        return {
          label: "Ready to create a sandbox",
          detail:
            "Your project and baseline are ready. Create the disposable local runtime when you need it.",
          tone: "success",
        };
      }
      if (verifiedRuntimeState(snapshot) === "unknown") {
        return {
          label: "Sandbox state needs review",
          detail:
            "The installed Rehearsal version cannot prove that a prepared runtime exists.",
          tone: "warning",
        };
      }
      if ((snapshot.candidates?.count ?? 0) > 0)
        return {
          label: "Ready to rehearse",
          detail:
            "Review the pending migrations before starting a new rehearsal command.",
          tone: "success",
        };
      {
        const execution = workspaceExecutionState(snapshot);
        const idle =
          execution.command === "idle"
            ? "No Rehearsal command is active. "
            : "";
        if (execution.lastRun)
          return {
            label: `Last rehearsal ${execution.lastRun.progress.state}`,
            detail: `${idle}This is a recorded command result, not the database lifecycle. Review its proof in Activity & reports.`,
            tone:
              execution.lastRun.progress.state === "completed"
                ? "success"
                : "warning",
          };
        return {
          label:
            snapshot.runtime?.state === "running"
              ? "Database sandbox running"
              : "Database sandbox prepared",
          detail: `${idle}Database state does not prove that a rehearsal or application proof passed.`,
          tone: "muted",
        };
      }
    case "not_ready":
      return {
        label: "Setup needs attention",
        detail: "Finish the remaining setup item before running a rehearsal.",
        tone: "warning",
      };
    case "operation_active": {
      const session = sandboxSessionPresentation(
        openSandboxSessionState(snapshot),
      );
      if (session)
        return { label: session.label, detail: session.detail, tone: "active" };
      return {
        label:
          snapshot.activity?.operation?.kind === "run"
            ? "Rehearsal command running"
            : "Project command running",
        detail:
          "A Rehearsal command is active. Database lifecycle and completed proof are separate evidence.",
        tone: "active",
      };
    }
    case "operation_attention":
      return {
        label: "Operation needs review",
        detail: "Check the previous operation before starting another one.",
        tone: "warning",
      };
    case "untrusted":
      return {
        label: "Workspace Trust required",
        detail:
          "Trust this folder before Rehearsal inspects local project state.",
        tone: "warning",
      };
    case "package_missing":
      return {
        label: "Rehearsal is not installed",
        detail: "Install Rehearsal to unlock the complete project profile.",
        tone: "muted",
      };
    case "package_outdated":
      return {
        label: "Rehearsal update required",
        detail: `Update the project from ${snapshot.version ?? "its installed version"} before inspection continues.`,
        tone: "warning",
      };
    case "error":
      if (snapshot.error?.code === "package_link_external")
        return {
          label: "Project package link needs repair",
          detail:
            "Rehearsal resolves outside this repository. Install a project-local copy, then refresh.",
          tone: "warning",
        };
      if (snapshot.error?.code === "platform_unsupported") {
        return {
          label: "Open this project in WSL 2",
          detail:
            "Windows uses a Linux workspace and Rehearsal extension host in WSL 2.",
          tone: "warning",
        };
      }
      if (snapshot.error?.code === "timeout") {
        return {
          label: "Project check timed out",
          detail:
            snapshot.activity?.state === "idle"
              ? "No Rehearsal operation is running. The read-only inspection needs another try or more time."
              : "The read-only inspection needs another try or more time.",
          tone: "warning",
        };
      }
      return {
        label: "Project check unavailable",
        detail: "Review the diagnostic and retry the project check.",
        tone: "warning",
      };
  }
};

export const journeyFor = (
  snapshot: ProjectSnapshot,
): readonly JourneyStep[] => {
  const execution = workspaceExecutionState(snapshot);
  const lastRun = execution.lastRun;
  return snapshot.availability === "loading"
    ? [
        { label: "Set up", value: "Checking", state: "current" },
        { label: "Baseline", value: "Checking", state: "waiting" },
        { label: "Review", value: "Checking", state: "waiting" },
        { label: "Run", value: "Checking", state: "waiting" },
        { label: "Verify", value: "Checking", state: "waiting" },
      ]
    : snapshot.availability === "operation_active"
      ? ["Set up", "Baseline", "Review", "Run", "Verify"].map((label) => ({
          label,
          value:
            label === "Run"
              ? (sandboxSessionPresentation(openSandboxSessionState(snapshot))
                  ?.label ?? "Operation running")
              : "Inspection on hold",
          state: label === "Run" ? ("current" as const) : ("waiting" as const),
        }))
      : [
          {
            label: "Set up",
            value: snapshot.configPath ? "Configured" : "Needs review",
            state: snapshot.configPath ? "done" : "current",
          },
          {
            label: "Baseline",
            value: snapshot.baseline ? "Verified" : "Waiting",
            state: snapshot.baseline ? "done" : "waiting",
          },
          {
            label: "Review",
            value:
              snapshot.candidates?.count === undefined
                ? "Waiting"
                : snapshot.candidates.count === 0
                  ? "No changes"
                  : `${snapshot.candidates.count} pending`,
            state:
              snapshot.candidates?.count === undefined
                ? "waiting"
                : snapshot.candidates.count > 0
                  ? "current"
                  : "done",
          },
          {
            label: "Run",
            value: lastRun
              ? `Last run ${lastRun.progress.state}`
              : "No completed run evidence",
            state:
              lastRun?.progress.state === "completed"
                ? "done"
                : lastRun
                  ? "current"
                  : "waiting",
          },
          {
            label: "Verify",
            value:
              execution.proof === "recorded_pass"
                ? "CLI proof passed (recorded)"
                : execution.proof === "recorded_failure"
                  ? "Last CLI proof failed"
                  : execution.proofConfigured === true
                    ? "CLI proof configured · not yet proven"
                    : execution.proofConfigured === false
                      ? "CLI proof not configured"
                      : "Proof evidence unavailable",
            state: execution.proof === "recorded_pass" ? "done" : "waiting",
          },
        ];
};
