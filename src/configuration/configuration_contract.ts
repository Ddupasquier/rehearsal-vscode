/** Validate core-owned configuration metadata; proposals never permit executable code. */
import { isLocalEndpoint } from "../runtime/local_endpoint.js";
export interface NamedWorkspaceProfile {
  readonly name: string;
  readonly targets: readonly string[];
  readonly applicationUrl: string | null;
}
export interface ConfigurationMetadata {
  readonly schemaVersion: 1;
  readonly path: string;
  readonly sourceSha256: string;
  readonly fields: readonly {
    readonly path: string;
    readonly kind: string;
    readonly value: unknown;
    readonly provenance: "validated-active-configuration";
    readonly confidence: "certain";
    readonly reviewRequired: true;
  }[];
  readonly profiles: readonly NamedWorkspaceProfile[];
  readonly pathResolution: string;
  readonly manualFields: string;
  readonly dependentTargetReview?: "explicit-topologyConfigPath";
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid configuration metadata.");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 1000): string => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    /[\x00-\x1f\x7f]/u.test(value)
  )
    throw new Error("Invalid configuration metadata text.");
  return value;
};
const fieldKinds: Readonly<Record<string, string>> = Object.freeze({
  "runtime.applicationUrl": "local-url",
  "runtime.displayName": "text",
  "runtime.protected": "boolean",
  "application.startCommand": "command",
  "application.proofCommand": "command",
  "application.readiness.url": "local-url",
  "application.activity.url": "local-url",
  "lifecycle.run": "run-persistence",
  "lifecycle.open": "open-persistence",
  "lifecycle.openIdleTimeoutSeconds": "nullable-integer",
  "cleanup.retainBaselineGenerations": "integer",
  "containerRuntime.autoStartColima": "boolean",
  "containerRuntime.stopOwnedColimaWhenIdle": "boolean",
  "containerRuntime.diskWarningPercent": "integer",
  "containerRuntime.minimumFreeBytes": "integer",
  "resources.staleAfterSeconds": "nullable-integer",
  "resources.retainedEnvironmentCount": "integer",
  "resources.maximumBytes": "nullable-integer",
  "resources.cleanupSchedule": "review-schedule",
  profiles: "profiles",
});
/** One local owner for numeric form hints and conservative editor validation. */
export const configurationIntegerConstraints = (
  path: string,
): Readonly<{ minimum: number; maximum: number }> | undefined => {
  if (
    !Object.hasOwn(fieldKinds, path) ||
    !["integer", "nullable-integer"].includes(fieldKinds[path]!)
  )
    return undefined;
  return {
    minimum: path === "lifecycle.openIdleTimeoutSeconds" ? 30 : 1,
    maximum:
      path === "lifecycle.openIdleTimeoutSeconds"
        ? 86400
        : path === "containerRuntime.diskWarningPercent"
          ? 100
          : path === "resources.retainedEnvironmentCount"
            ? 1000
            : Number.MAX_SAFE_INTEGER,
  };
};
export const configurationIntegerHelp = (path: string): string | undefined => {
  const bounds = configurationIntegerConstraints(path);
  return bounds
    ? `Enter a whole number from ${bounds.minimum} to ${bounds.maximum}.`
    : undefined;
};
/** Construct only fixed guidance for a known field; never echo a proposed value. */
export class ConfigurationInputError extends Error {
  constructor(path: string, kind: string) {
    const known = Object.hasOwn(fieldKinds, path) && fieldKinds[path] === kind;
    const help = known
      ? (configurationIntegerHelp(path) ??
        (kind === "local-url"
          ? "Use a supported loopback URL."
          : kind === "boolean"
            ? "Choose true or false."
            : kind === "profiles"
              ? "Use valid named profiles with configured targets and optional loopback URLs."
              : "Use a supported value for this field."))
      : undefined;
    super(
      help
        ? `${path}: ${help} Correct this field and review again. This proposal was not saved.`
        : "Check the proposed configuration fields and review again. This proposal was not saved.",
    );
    this.name = "ConfigurationInputError";
  }
}
const parseProfiles = (value: unknown): readonly NamedWorkspaceProfile[] => {
  if (!Array.isArray(value) || value.length > 20)
    throw new Error("Invalid named project profiles.");
  const names = new Set<string>();
  return value.map((raw) => {
    const profile = object(raw);
    const name = text(profile.name, 80);
    if (
      Object.keys(profile).some(
        (key) => !["name", "targets", "applicationUrl"].includes(key),
      ) ||
      names.has(name) ||
      !Array.isArray(profile.targets) ||
      !profile.targets.length ||
      profile.targets.length > 32 ||
      new Set(profile.targets).size !== profile.targets.length ||
      (profile.applicationUrl !== null &&
        !isLocalEndpoint(profile.applicationUrl))
    )
      throw new Error("Invalid named project profile.");
    names.add(name);
    return {
      name,
      targets: profile.targets.map((target) => {
        const name = text(target, 120);
        if (!/^[A-Za-z0-9_-]+$/u.test(name))
          throw new Error("Invalid profile target.");
        return name;
      }),
      applicationUrl: profile.applicationUrl as string | null,
    };
  });
};
export const validateConfigurationFieldValue = (
  path: string,
  kind: string,
  value: unknown,
): unknown => {
  if (!Object.hasOwn(fieldKinds, path) || fieldKinds[path] !== kind)
    throw new Error("Unknown configuration field or kind.");
  if (kind === "profiles") return parseProfiles(value);
  if (kind === "local-url") {
    if (
      value === null &&
      ["application.readiness.url", "application.activity.url"].includes(path)
    )
      return null;
    if (!isLocalEndpoint(value))
      throw new Error("Configuration endpoint must stay loopback-only.");
    if (
      path === "application.activity.url" &&
      (typeof value !== "string" ||
        value.length > 500 ||
        Number(new URL(value).port) < 1024)
    )
      throw new Error(
        "Application activity needs a bounded loopback URL with an explicit unprivileged port.",
      );
    return value;
  }
  if (kind === "boolean") {
    if (typeof value !== "boolean")
      throw new Error("Invalid configuration boolean.");
    return value;
  }
  if (kind === "integer" || kind === "nullable-integer") {
    if (kind === "nullable-integer" && value === null) return null;
    const bounds = configurationIntegerConstraints(path)!;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < bounds.minimum ||
      value > bounds.maximum
    )
      throw new Error("Invalid bounded configuration count.");
    return value;
  }
  if (
    kind === "run-persistence" &&
    !["keep-until-stop", "stop-after-run"].includes(String(value))
  )
    throw new Error("Invalid run persistence.");
  if (
    kind === "open-persistence" &&
    !["keep-until-stop", "stop-on-application-exit"].includes(String(value))
  )
    throw new Error("Invalid open persistence.");
  if (
    kind === "review-schedule" &&
    !["manual", "daily-preview", "weekly-preview"].includes(String(value))
  )
    throw new Error("Invalid review schedule.");
  return text(value, kind === "text" ? 100 : 1000);
};
export const parseConfigurationMetadata = (
  value: unknown,
): ConfigurationMetadata => {
  const data = object(value);
  const patch = object(data.patchContract);
  if (
    data.schemaVersion !== 1 ||
    patch.schemaVersion !== 1 ||
    patch.input !== "project-local-json-file" ||
    patch.maximumBytes !== 65536 ||
    patch.writesConfiguration !== false ||
    patch.executesProposedCommands !== false ||
    patch.concurrentChanges !== "refuse" ||
    (patch.dependentTargetReview !== undefined &&
      patch.dependentTargetReview !== "explicit-topologyConfigPath") ||
    !Array.isArray(data.fields) ||
    data.fields.length > 100 ||
    !Array.isArray(data.profiles) ||
    data.profiles.length > 20
  )
    throw new Error("Unsupported or unsafe configuration metadata contract.");
  const path = text(data.path, 500);
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    path.split(/[\\/]/u).includes("..") ||
    /^[A-Za-z]:/u.test(path)
  )
    throw new Error("Configuration path must remain workspace-local.");
  const sha = text(data.sourceSha256, 64);
  if (!/^[a-f0-9]{64}$/u.test(sha))
    throw new Error("Invalid configuration fingerprint.");
  const seen = new Set<string>();
  const fields = data.fields.map((raw) => {
    const field = object(raw);
    const path = text(field.path, 120);
    const kind = text(field.kind, 40);
    if (
      seen.has(path) ||
      !Object.hasOwn(fieldKinds, path) ||
      fieldKinds[path] !== kind ||
      field.provenance !== "validated-active-configuration" ||
      field.confidence !== "certain" ||
      field.reviewRequired !== true
    )
      throw new Error("Invalid configuration field evidence.");
    const value = validateConfigurationFieldValue(path, kind, field.value);
    seen.add(path);
    return {
      path,
      kind,
      value,
      provenance: "validated-active-configuration" as const,
      confidence: "certain" as const,
      reviewRequired: true as const,
    };
  });
  const profiles = parseProfiles(data.profiles);
  const profileField = fields.find((field) => field.path === "profiles");
  if (
    profileField &&
    JSON.stringify(profileField.value) !== JSON.stringify(profiles)
  )
    throw new Error("Profile field contradicts profile evidence.");
  return {
    schemaVersion: 1,
    path,
    sourceSha256: sha,
    fields,
    profiles,
    pathResolution: text(data.pathResolution),
    manualFields: text(data.manualFields),
    ...(patch.dependentTargetReview === "explicit-topologyConfigPath"
      ? { dependentTargetReview: "explicit-topologyConfigPath" as const }
      : {}),
  };
};
