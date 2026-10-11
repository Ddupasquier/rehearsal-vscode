import type { ProjectSnapshot } from "./project_snapshot.js";
import type { WorkspaceActionId } from "./action_catalog.js";

export interface OverviewItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly tooltip: string;
  readonly icon: string;
  readonly cliCommand?: string;
  readonly extensionAction?: WorkspaceActionId;
  readonly url?: string;
}

export const overviewItemAccessibilityLabel = (
  item: Pick<OverviewItem, "label" | "description">,
): string =>
  item.description ? `${item.label}, ${item.description}` : item.label;

const shortDigest = (value: string): string => value.slice(0, 12);

const documentationItem = (): OverviewItem => ({
  id: "documentation",
  label: "Rehearsal documentation",
  tooltip: "Open the Rehearsal documentation website",
  icon: "book",
  url: "https://ddupasquier.github.io/rehearsal-db/",
});

const runtimeEndpoint = (
  endpoint: NonNullable<
    ProjectSnapshot["runtime"]
  >["targets"][number]["endpoint"],
): string => {
  if (!endpoint) return "no active endpoint";
  if (endpoint.kind === "http") return endpoint.url;
  return `${endpoint.host}:${endpoint.port}/${endpoint.database}`;
};

export const overviewItems = (
  snapshot: ProjectSnapshot,
): readonly OverviewItem[] => {
  if (snapshot.availability === "untrusted") {
    return [
      {
        id: "untrusted",
        label: "Trust this workspace to inspect Rehearsal",
        tooltip: "The extension runs no process in an untrusted workspace.",
        icon: "shield",
      },
    ];
  }
  if (snapshot.availability === "package_missing") {
    return [
      {
        id: "package",
        label: "No Rehearsal project found",
        description: "Open your app's folder",
        tooltip:
          "This folder does not have @rehearsal-db/core installed. Open a project that uses Rehearsal, or install it in that project with npm install --save-dev @rehearsal-db/core.",
        icon: "package",
        extensionAction: "installPackage",
      },
      documentationItem(),
    ];
  }
  if (snapshot.availability === "package_outdated") {
    return [
      {
        id: "package-update",
        label: "Update Rehearsal",
        description: `${snapshot.version ?? "old version"} → ${snapshot.compatibility?.minimumVersion ?? "current"}+`,
        tooltip:
          "This project uses a Rehearsal release that predates the extension's safe inspection contract. Select to review the exact package-manager update command.",
        icon: "cloud-download",
        extensionAction: "updatePackage",
      },
      documentationItem(),
    ];
  }
  const items: OverviewItem[] = [];
  if (snapshot.version) {
    items.push({
      id: "version",
      label: "Installed package",
      description: snapshot.version,
      tooltip: `@rehearsal-db/core ${snapshot.version}`,
      icon: "package",
      cliCommand: "npx rehearsal --version",
    });
  }
  if (snapshot.packageLocation) {
    items.push({
      id: "package-location",
      label: "Package location",
      description: snapshot.packageLocation,
      tooltip: snapshot.packageLocation,
      icon: "folder",
    });
  }
  if (snapshot.activity) {
    const operation = snapshot.activity.operation;
    const label = {
      idle: "No Rehearsal operation in progress",
      busy: "Rehearsal operation in progress",
      stale: "Previous Rehearsal operation needs review",
      invalid: "Rehearsal operation state needs review",
    }[snapshot.activity.state];
    const tooltip =
      operation === null
        ? snapshot.activity.state === "idle"
          ? "This workspace has no active Rehearsal mutation."
          : "Rehearsal found an invalid operation lock and did not change it. Run activity, status, doctor, and verify in the terminal before retrying a mutation."
        : `${operation.kind} · started ${operation.startedAt}${operation.rehearsalVersion ? ` · Rehearsal ${operation.rehearsalVersion}` : ""}`;
    items.push({
      id: "activity",
      label,
      description: operation?.kind ?? snapshot.activity.state,
      tooltip,
      icon:
        snapshot.activity.state === "idle"
          ? "pass"
          : snapshot.activity.state === "busy"
            ? "sync"
            : "warning",
      cliCommand: "npx rehearsal activity",
    });
  }
  if (snapshot.error) {
    const timedOut = snapshot.error.code === "timeout";
    items.push({
      id: "error",
      label: timedOut
        ? "Project inspection took too long"
        : "Project inspection needs attention",
      description: snapshot.error.code,
      tooltip: timedOut
        ? "A read-only Rehearsal check exceeded the configured timeout. Open the project workspace to retry, adjust the timeout, or run Doctor."
        : [
            "Rehearsal could not safely complete this project inspection.",
            ...snapshot.error.suggestions,
          ].join("\n"),
      icon: "error",
      extensionAction: "showOutput",
    });
    return [...items, documentationItem()];
  }
  if (
    snapshot.availability === "operation_active" ||
    snapshot.availability === "operation_attention"
  ) {
    return [...items, documentationItem()];
  }
  if (snapshot.readiness) {
    items.push({
      id: "readiness",
      label:
        snapshot.readiness.state === "READY"
          ? "Ready for rehearsal"
          : "Setup needs attention",
      description: `${snapshot.readiness.passed} passed · ${snapshot.readiness.failed} failed`,
      tooltip: snapshot.readiness.checks
        .map(
          (check) =>
            `${check.label}: ${check.detail}${check.remediation ? `\nNext: ${check.remediation}` : ""}`,
        )
        .join("\n"),
      icon: snapshot.readiness.state === "READY" ? "pass" : "warning",
      cliCommand: "npx rehearsal doctor",
    });
  }
  if (snapshot.availability !== "ready") {
    return [...items, documentationItem()];
  }
  if (snapshot.configPath) {
    items.push({
      id: "config",
      label: "Active configuration",
      description: snapshot.configPath,
      tooltip: snapshot.configPath,
      icon: "settings-gear",
      cliCommand: `npx rehearsal explain --config=${snapshot.configPath}`,
    });
  }
  if (snapshot.baseline) {
    items.push({
      id: "baseline",
      label: "Verified baseline",
      description: `${snapshot.baseline.rowCount.toLocaleString()} rows · ${snapshot.baseline.tableCount.toLocaleString()} tables`,
      tooltip: `${snapshot.baseline.generationId}\nCreated ${snapshot.baseline.createdAt}\n${snapshot.baseline.verification}`,
      icon: "database",
      cliCommand: "npx rehearsal inspect baseline",
    });
  }
  if (snapshot.candidates) {
    items.push({
      id: "candidates",
      label:
        snapshot.candidates.count === 0
          ? "No candidate migrations"
          : `${snapshot.candidates.count} candidate migration${snapshot.candidates.count === 1 ? "" : "s"}`,
      description: shortDigest(snapshot.candidates.digest),
      tooltip:
        snapshot.candidates.files.length > 0
          ? `Approval digest: ${snapshot.candidates.digest}\n${snapshot.candidates.files.join("\n")}`
          : `Exact empty-set digest: ${snapshot.candidates.digest}`,
      icon: snapshot.candidates.count === 0 ? "pass" : "git-commit",
      cliCommand: "npx rehearsal candidates",
    });
    items.push({
      id: "targets",
      label: `${snapshot.candidates.targets.length} configured target${snapshot.candidates.targets.length === 1 ? "" : "s"}`,
      description: snapshot.candidates.targets
        .map(({ name }) => name)
        .join(", "),
      tooltip: snapshot.candidates.targets
        .map(
          ({ name, configPath, count }) =>
            `${name}: ${configPath} · ${count} candidate${count === 1 ? "" : "s"}`,
        )
        .join("\n"),
      icon: "server-environment",
      cliCommand: "npx rehearsal candidates",
    });
  }
  if (snapshot.runtime) {
    const targetCount = snapshot.runtime.targets.length;
    items.push({
      id: "runtime",
      label: `${targetCount} disposable runtime target${targetCount === 1 ? "" : "s"}`,
      description: snapshot.runtime.state,
      tooltip: snapshot.runtime.targets
        .map(
          ({ name, runtimeTarget, state, reason, endpoint }) =>
            `${name}: ${runtimeTarget} · ${state}${reason ? ` (${reason})` : ""} · ${runtimeEndpoint(endpoint)}`,
        )
        .join("\n"),
      icon:
        snapshot.runtime.state === "running"
          ? "server-process"
          : snapshot.runtime.state === "stopped"
            ? "debug-stop"
            : "warning",
      cliCommand: "npx rehearsal status",
    });
  }
  if (snapshot.applicationUrl) {
    items.push({
      id: "application",
      label: "Sandbox application",
      description: snapshot.applicationUrl,
      tooltip: "Configured loopback application URL",
      icon: "globe",
      url: snapshot.applicationUrl,
      cliCommand: "npx rehearsal open",
    });
  }
  items.push(documentationItem());
  return items;
};
