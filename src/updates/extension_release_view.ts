import {
  comparePublishedVersions,
  isPublishedVersion,
} from "./update_advisory.js";

export interface ExtensionReleaseEvidence {
  readonly status: "checking" | "unknown" | "checked";
  readonly latestVersion: string | null;
  readonly checkedAt: number | null;
  readonly channel: "stable" | "preview";
}

export interface ExtensionReleasePresentation {
  readonly text: string;
  readonly title: string;
  readonly state: "unknown" | "checking" | "current" | "available" | "ahead";
}

/** Loaded extension identity and consented release evidence never stand in for core. */
export const extensionReleasePresentation = (
  installed: string,
  evidence?: ExtensionReleaseEvidence,
): ExtensionReleasePresentation => {
  const validInstalled = isPublishedVersion(installed);
  const text = `Extension ${validInstalled ? installed : "unavailable"}`;
  const unknown: ExtensionReleasePresentation = {
    text,
    title: `${text}. Update availability is unknown. Use Check for updates to review optional release checks.`,
    state: "unknown",
  };
  if (
    !validInstalled ||
    !evidence ||
    !["stable", "preview"].includes(evidence.channel)
  )
    return unknown;
  if (evidence.status === "checking")
    return {
      text,
      title: `${text}. Checking optional ${evidence.channel} release metadata.`,
      state: "checking",
    };
  if (
    evidence.status !== "checked" ||
    !isPublishedVersion(evidence.latestVersion) ||
    !Number.isSafeInteger(evidence.checkedAt) ||
    evidence.checkedAt === null ||
    evidence.checkedAt < 0 ||
    !Number.isFinite(new Date(evidence.checkedAt).getTime())
  )
    return unknown;
  const checkedAt = new Date(evidence.checkedAt).toISOString();
  const comparison = comparePublishedVersions(
    evidence.latestVersion,
    installed,
  );
  if (comparison === 1)
    return {
      text: `${text} → ${evidence.latestVersion}`,
      title: `${text}. Newer ${evidence.channel} release ${evidence.latestVersion} available; checked ${checkedAt}.`,
      state: "available",
    };
  if (comparison === 0)
    return {
      text,
      title: `${text} matches the newest checked ${evidence.channel} release as of ${checkedAt}.`,
      state: "current",
    };
  if (comparison === -1)
    return {
      text,
      title: `${text} is newer than the newest checked ${evidence.channel} release ${evidence.latestVersion} as of ${checkedAt}.`,
      state: "ahead",
    };
  return unknown;
};

export interface ExtensionReleaseDomNode {
  textContent: string | null;
  title: string;
  setAttribute(name: string, value: string): void;
}

export interface ExtensionReleaseDomDocument {
  getElementById(id: string): ExtensionReleaseDomNode | null;
}

/** Self-contained for serialization into the nonce-authorized browser controller. */
export const applyExtensionReleaseUpdate = (
  document: ExtensionReleaseDomDocument,
  message: unknown,
): boolean => {
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    Object.keys(message).length !== 4 ||
    !["type", "text", "title", "state"].every((key) =>
      Object.hasOwn(message, key),
    )
  )
    return false;
  const update = message as {
    readonly type: unknown;
    readonly text: unknown;
    readonly title: unknown;
    readonly state: unknown;
  };
  if (
    update.type !== "extensionReleaseUpdated" ||
    typeof update.text !== "string" ||
    update.text.trim().length === 0 ||
    update.text.length > 256 ||
    /[\x00-\x1f\x7f]/u.test(update.text) ||
    typeof update.title !== "string" ||
    update.title.trim().length === 0 ||
    update.title.length > 1024 ||
    /[\x00-\x1f\x7f]/u.test(update.title) ||
    typeof update.state !== "string" ||
    !["unknown", "checking", "current", "available", "ahead"].includes(
      update.state,
    )
  )
    return false;
  const label = document.getElementById("extension-version-label");
  const badge = document.getElementById("extension-version");
  if (!label || !badge) return false;
  label.textContent = update.text;
  badge.title = update.title;
  badge.setAttribute("data-state", update.state);
  return true;
};
