/** Native consent/notifications; the webview never fetches or supplies a URL. */
import * as vscode from "vscode";
import {
  UpdateAdvisoryController,
  UPDATE_RELEASES_URL,
  fetchUpdateMetadata,
  updateAdvisoryStorageKey,
  isPublishedVersion,
} from "./update_advisory.js";
import { readUpdateProjectIdentity } from "./update_identity.js";
import type { RehearsalTreeProvider } from "./tree_provider.js";
import type { RehearsalWorkspaceActions } from "./workspace_actions.js";
import type { ExtensionReleaseEvidence } from "./extension_release_view.js";

export function createUpdateAdvisory({
  projects,
  actions,
  state,
  version,
  preview,
  onExtensionRelease,
  request = fetchUpdateMetadata,
}: {
  projects: Pick<RehearsalTreeProvider, "snapshotFor">;
  actions: Pick<RehearsalWorkspaceActions, "updatePackageVersion">;
  state: vscode.Memento;
  version: string;
  preview: boolean;
  onExtensionRelease?: (
    key: string,
    evidence: ExtensionReleaseEvidence,
  ) => void;
  request?: typeof fetchUpdateMetadata;
}) {
  const folder = (key: string) =>
    vscode.workspace.workspaceFolders?.find(
      ({ uri }) => uri.toString() === key,
    );
  return new UpdateAdvisoryController(
    {
      extensionRelease: (key, evidence) => {
        if (vscode.workspace.isTrusted && folder(key)?.uri.scheme === "file")
          onExtensionRelease?.(key, evidence);
      },
      checking: async (action) =>
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Checking public Rehearsal release metadata…",
            cancellable: false,
          },
          action,
        ),
      allowed: (key) =>
        vscode.workspace.isTrusted && folder(key)?.uri.scheme === "file",
      identify: async (key) => {
        const selected = folder(key);
        if (!selected || !vscode.workspace.isTrusted)
          throw new Error("Project unavailable.");
        return readUpdateProjectIdentity(
          selected.uri.fsPath,
          projects.snapshotFor(key)?.version,
        );
      },
      load: (key) => state.get(updateAdvisoryStorageKey(key)),
      save: async (key, value) => {
        await state.update(updateAdvisoryStorageKey(key), value);
      },
      consent: async (_key, manual) => {
        const choice = await vscode.window.showInformationMessage(
          "Allow optional Rehearsal update checks?",
          {
            modal: true,
            detail:
              "This contacts registry.npmjs.org and api.github.com for public Rehearsal release metadata. Those services see normal connection information such as your IP address. No credentials, project names, files, paths, database data or installed versions are sent. Checks run at project opening at most daily, never by an idle timer. Updates are never installed automatically.",
          },
          ...(manual
            ? ["Check Once", "Enable Daily Checks", "Disable Automatic Checks"]
            : ["Enable Daily Checks", "Not Now", "Don't Ask Again"]),
        );
        return choice === "Enable Daily Checks"
          ? "enable"
          : choice === "Check Once"
            ? "once"
            : "disable";
      },
      notify: async (_key, updates, eligibleCore, installed) => {
        const choices = [
          ...(updates.core
            ? [eligibleCore ? "Review Core Update" : "Review Core Release"]
            : []),
          ...(updates.extension ? ["Review Extension Release"] : []),
          "Later",
          "Skip These Versions",
          "Disable Checks",
        ];
        const choice = await vscode.window.showInformationMessage(
          `New Rehearsal release available${updates.core ? `: core ${installed.core ?? "unknown"} → ${updates.core} (${updates.core.includes("-") ? "preview" : "stable"} release)` : ""}${updates.extension ? `; VS Code ${installed.extension} → ${updates.extension} (${installed.channel} channel)` : ""}. Compatibility is a separate check.${updates.core && !eligibleCore ? " This core release requires manual compatibility review; no install action is offered." : ""}`,
          ...choices,
        );
        return choice === "Review Core Update" ||
          choice === "Review Core Release"
          ? "core"
          : choice === "Review Extension Release"
            ? "extension"
            : choice === "Skip These Versions"
              ? "skip"
              : choice === "Disable Checks"
                ? "disable"
                : "later";
      },
      information: (message) => {
        void vscode.window.showInformationMessage(message);
      },
      updateCore: async (key, identity, target, permissionCurrent) => {
        if (
          !permissionCurrent() ||
          !identity.version ||
          identity.origin !== "registry" ||
          !identity.dependencyGroup
        )
          return;
        await actions.updatePackageVersion(
          key,
          identity.version,
          target,
          async () => {
            const selected = folder(key);
            if (
              !permissionCurrent() ||
              !selected ||
              !vscode.workspace.isTrusted
            )
              return false;
            const fresh = await readUpdateProjectIdentity(
              selected.uri.fsPath,
              projects.snapshotFor(key)?.version,
            );
            return (
              permissionCurrent() &&
              fresh.origin === "registry" &&
              fresh.fingerprint === identity.fingerprint &&
              fresh.version === identity.version &&
              fresh.dependencyGroup === identity.dependencyGroup
            );
          },
          identity.dependencyGroup,
        );
      },
      openRelease: async (target) => {
        if (vscode.workspace.isTrusted && isPublishedVersion(target))
          await vscode.env.openExternal(
            vscode.Uri.parse(`${UPDATE_RELEASES_URL}/tag/v${target}`),
          );
      },
      openCoreRelease: async (target) => {
        if (vscode.workspace.isTrusted && isPublishedVersion(target))
          await vscode.env.openExternal(
            vscode.Uri.parse(
              `https://www.npmjs.com/package/@rehearsal-db/core/v/${target}`,
            ),
          );
      },
    },
    version,
    preview,
    request,
  );
}
