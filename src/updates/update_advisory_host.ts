/** Native consent/notifications; the webview never fetches or supplies a URL. */
import * as vscode from "vscode";
import {
  UpdateAdvisoryController,
  UPDATE_RELEASES_URL,
  fetchUpdateMetadata,
  updateAdvisoryStorageKey,
  isPublishedVersion,
  type PublishedUpdates,
  type UpdateProjectIdentity,
} from "./update_advisory.js";
import { readUpdateProjectIdentity } from "./update_identity.js";
import type { RehearsalTreeProvider } from "../workspace/tree_provider.js";
import type { RehearsalWorkspaceActions } from "../workspace/workspace_actions.js";
import type { ExtensionReleaseEvidence } from "./extension_release_view.js";
import {
  readAutomaticUpdateSettings,
  saveAutomaticUpdateSettings,
} from "./automatic_update_settings.js";
import { AutomaticExtensionInstaller } from "./extension_auto_update.js";
import {
  RehearsalUpdatePrompts,
  type UpdatePromptResult,
} from "./update_prompt.js";
import { runRehearsalJson } from "../runtime/process_adapter.js";
import { parseActivityData } from "../contracts.js";
import { join } from "node:path";

export function createUpdateAdvisory({
  projects,
  actions,
  state,
  version,
  preview,
  onExtensionRelease,
  request = fetchUpdateMetadata,
  extensionUri,
  storagePath,
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
  extensionUri?: vscode.Uri;
  storagePath?: string;
}) {
  const folder = (key: string) =>
    vscode.workspace.workspaceFolders?.find(
      ({ uri }) => uri.toString() === key,
    );
  let disposed = false;
  const prompts = extensionUri
    ? new RehearsalUpdatePrompts(extensionUri)
    : undefined;
  const installer = storagePath
    ? new AutomaticExtensionInstaller({
        storagePath,
        loadedVersion: version,
        preview,
      })
    : undefined;
  const settings = () =>
    prompts ? readAutomaticUpdateSettings() : { extension: false, cli: false };
  type Pending = {
    kind: "extension" | "cli";
    version: string;
    identity: UpdateProjectIdentity;
    automatic: boolean;
  };
  const pending = new Map<string, Pending[]>();
  const running = new Map<string, Promise<void>>();
  const allowed = (key: string) =>
    !disposed &&
    vscode.workspace.isTrusted &&
    folder(key)?.uri.scheme === "file";
  const idle = async (key: string, all = false) => {
    if (!allowed(key)) return false;
    const candidates = all
      ? (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.toString())
      : [key];
    const membership = () =>
      JSON.stringify(
        (vscode.workspace.workspaceFolders ?? []).map((f) => [
          f.uri.toString(),
          f.uri.fsPath,
        ]),
      );
    const originalMembership = membership();
    for (const candidate of candidates) {
      const snapshot = projects.snapshotFor(candidate),
        selected = folder(candidate);
      if (snapshot?.availability === "package_missing") continue;
      if (!snapshot?.version) return false;
      if (
        !selected ||
        snapshot.activity?.state !== "idle" ||
        [
          "operation_active",
          "operation_attention",
          "error",
          "untrusted",
          "loading",
        ].includes(snapshot.availability)
      )
        return false;
      try {
        const result = await runRehearsalJson<unknown>({
          workspaceRoot: selected.uri.fsPath,
          command: ["activity"],
          expectedCommand: "activity",
          ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
        });
        if (
          !allowed(key) ||
          membership() !== originalMembership ||
          projects.snapshotFor(candidate) !== snapshot ||
          parseActivityData(result.result.data).state !== "idle"
        )
          return false;
      } catch {
        return false;
      }
    }
    return allowed(key);
  };
  const resumeAutomatic = (key: string): Promise<void> => {
    const active = running.get(key);
    if (active) return active;
    const startingJobs = pending.get(key);
    const work = (async () => {
      const jobs = pending.get(key);
      if (!jobs || !allowed(key)) return;
      for (const job of [...jobs]) {
        const permission = () =>
          allowed(key) &&
          pending.get(key) === jobs &&
          jobs.includes(job) &&
          (!job.automatic ||
            (job.kind === "extension" ? settings().extension : settings().cli));
        if (!permission()) {
          jobs.splice(jobs.indexOf(job), 1);
          continue;
        }
        if (!(await idle(key, job.kind === "extension")) || !permission())
          continue;
        try {
          if (job.kind === "extension") {
            if (
              !installer ||
              !(await installer.install(job.version, permission, () =>
                idle(key, true),
              ))
            )
              continue;
          } else {
            const selected = folder(key);
            if (
              !selected ||
              !job.identity.version ||
              !job.identity.dependencyGroup
            )
              continue;
            const verify = async () => {
              if (!permission()) return false;
              const fresh = await readUpdateProjectIdentity(
                selected.uri.fsPath,
                projects.snapshotFor(key)?.version,
              );
              return (
                permission() &&
                fresh.origin === "registry" &&
                fresh.fingerprint === job.identity.fingerprint &&
                fresh.version === job.identity.version &&
                fresh.dependencyGroup === job.identity.dependencyGroup
              );
            };
            if (!(await verify())) {
              jobs.splice(jobs.indexOf(job), 1);
              continue;
            }
            const dispatched = await actions.updatePackageVersion(
              key,
              job.identity.version,
              job.version,
              verify,
              job.identity.dependencyGroup,
              {
                automatic: true,
                coordinationDirectory: join(
                  storagePath!,
                  "cli-update-coordination",
                ),
              },
            );
            if (!dispatched) continue;
          }
          jobs.splice(jobs.indexOf(job), 1);
        } catch {
          jobs.splice(jobs.indexOf(job), 1);
          if (allowed(key))
            void vscode.window.showWarningMessage(
              "A Rehearsal automatic update could not be completed. Your existing installation was not treated as updated. Check the project terminal or update settings and try Check for updates again; no database operation or automatic retry loop was started.",
            );
        }
      }
      if (!jobs.length && pending.get(key) === jobs) pending.delete(key);
    })().finally(() => {
      running.delete(key);
      if (pending.has(key) && pending.get(key) !== startingJobs)
        void resumeAutomatic(key);
    });
    running.set(key, work);
    return work;
  };
  const queue = async (
    key: string,
    updates: PublishedUpdates,
    eligibleCore: boolean,
    automaticOnly = true,
  ) => {
    const selected = folder(key);
    if (!selected || !allowed(key)) return updates;
    const identity = await readUpdateProjectIdentity(
      selected.uri.fsPath,
      projects.snapshotFor(key)?.version,
    );
    if (!allowed(key)) return updates;
    const policy = settings(),
      jobs: Pending[] = [];
    if (updates.extension && installer && (!automaticOnly || policy.extension))
      jobs.push({
        kind: "extension",
        version: updates.extension,
        identity,
        automatic: automaticOnly,
      });
    if (updates.core && eligibleCore && policy.cli && storagePath)
      jobs.push({
        kind: "cli",
        version: updates.core,
        identity,
        automatic: true,
      });
    if (jobs.length) {
      const handlesCore = jobs.some((j) => j.kind === "cli");
      const handlesExtension = jobs.some((j) => j.kind === "extension");
      pending.set(key, jobs);
      await resumeAutomatic(key);
      return {
        core: handlesCore ? null : updates.core,
        extension: handlesExtension ? null : updates.extension,
      };
    }
    return updates;
  };
  const choose = async (
    key: string,
    updates: PublishedUpdates,
    eligibleCore: boolean,
    installed: {
      core: string | null;
      extension: string;
      channel: "stable" | "preview";
    },
  ): Promise<UpdatePromptResult | undefined> => {
    const opened = settings(),
      selected = folder(key);
    if (!prompts || !selected) return undefined;
    const assert = () => {
      if (
        !allowed(key) ||
        folder(key)?.uri.fsPath !== selected.uri.fsPath ||
        JSON.stringify(settings()) !== JSON.stringify(opened)
      )
        throw new Error("Update consent or project changed.");
    };
    const result = await prompts.prompt({
      workspaceKey: key,
      workspaceName: selected.name,
      core: updates.core
        ? {
            installed: installed.core,
            available: updates.core,
            eligible: eligibleCore,
          }
        : null,
      extension: updates.extension
        ? { installed: installed.extension, available: updates.extension }
        : null,
      channel: installed.channel,
      automatic: opened,
      canApply: assert,
    });
    if (!result) return undefined;
    assert();
    if (
      result.choice === "preferences" ||
      result.choice === "extension" ||
      (result.choice === "core" && eligibleCore)
    )
      await saveAutomaticUpdateSettings(result.automatic);
    if (result.choice === "disable")
      await saveAutomaticUpdateSettings({ extension: false, cli: false });
    return allowed(key) ? result : undefined;
  };
  const controller = new UpdateAdvisoryController(
    {
      automaticChecksEnabled: () => {
        const policy = settings();
        return policy.extension || policy.cli;
      },
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
        if (
          prompts &&
          (!projects.snapshotFor(key) ||
            projects.snapshotFor(key)?.availability === "loading")
        )
          throw new Error("Wait for the current project inspection.");
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
        const automatic = settings();
        if (automatic.extension || automatic.cli) return "enable";
        const choice = await vscode.window.showInformationMessage(
          "Allow optional Rehearsal update checks?",
          {
            modal: true,
            detail:
              "This contacts registry.npmjs.org and api.github.com for public Rehearsal release metadata. Those services see normal connection information such as your IP address. No credentials, project names, files, paths, database data or installed versions are sent. Checks run at project opening at most daily, never by an idle timer. Checking alone never authorizes installation. Separate automatic extension and CLI opt-ins are available in Rehearsal update settings.",
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
        if (prompts) {
          const remaining = await queue(_key, updates, eligibleCore);
          if (!remaining.core && !remaining.extension) return "later";
          const result = await choose(_key, remaining, eligibleCore, installed);
          if (!result) return "later";
          if (result.choice === "extension") {
            await queue(
              _key,
              { core: null, extension: remaining.extension },
              false,
              false,
            );
            return "later";
          }
          if (result.choice === "preferences" || result.choice === "core") {
            const after = await queue(_key, remaining, eligibleCore);
            return result.choice === "core" && after.core ? "core" : "later";
          }
          return result.choice;
        }
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
          ...(storagePath
            ? [
                {
                  coordinationDirectory: join(
                    storagePath,
                    "cli-update-coordination",
                  ),
                },
              ]
            : []),
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
  return {
    open: async (key: string) => {
      await controller.open(key);
      await resumeAutomatic(key);
    },
    check: (key: string, manual = true) => controller.check(key, manual),
    configure: async (key: string) => {
      if (!prompts) return controller.configure(key);
      const result = await choose(key, { core: null, extension: null }, false, {
        core: null,
        extension: version,
        channel: preview ? "preview" : "stable",
      });
      if (
        result?.choice === "preferences" &&
        (settings().extension || settings().cli)
      )
        await controller.check(key, true);
      if (result?.choice === "disable") {
        pending.delete(key);
        const current = state.get<Record<string, unknown>>(
          updateAdvisoryStorageKey(key),
        );
        if (current)
          await state.update(updateAdvisoryStorageKey(key), {
            ...current,
            enabled: false,
          });
      }
    },
    resumeAutomatic,
    remove: (key: string) => {
      pending.delete(key);
      controller.remove(key);
    },
    dispose: () => {
      disposed = true;
      pending.clear();
      prompts?.dispose();
      installer?.dispose();
      controller.dispose();
    },
  };
}
