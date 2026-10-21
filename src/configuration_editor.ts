import { createHash } from "node:crypto";
import {
  validateConfigurationFieldValue,
  ConfigurationInputError,
  type ConfigurationMetadata,
} from "./configuration_contract.js";
import { editEnvironmentConfiguration } from "./environment_configuration.js";
import { parseLocalEndpoint } from "./local_endpoint.js";
import {
  editLiteralConfiguration,
  matchesLiteralConfigurationValue,
} from "./literal_configuration.js";

export interface ConfigurationProposal {
  readonly applicationUrl?: string;
  readonly startCommand?: string;
  readonly proofCommand?: string;
  readonly runPersistence?: "keep-until-stop" | "stop-after-run";
  readonly openPersistence?: "keep-until-stop" | "stop-on-application-exit";
  readonly retainBaselineGenerations?: number;
  readonly environmentName?: string;
  readonly protectEnvironment?: boolean;
}

/** Map only explicitly proposed fields; a browser URL never implies a health URL. */
export const configurationProposalChanges = (
  proposal: ConfigurationProposal,
): readonly { readonly path: string; readonly value: unknown }[] => {
  const mappings = {
    applicationUrl: "runtime.applicationUrl",
    startCommand: "application.startCommand",
    proofCommand: "application.proofCommand",
    runPersistence: "lifecycle.run",
    openPersistence: "lifecycle.open",
    retainBaselineGenerations: "cleanup.retainBaselineGenerations",
    environmentName: "runtime.displayName",
    protectEnvironment: "runtime.protected",
  } as const satisfies Readonly<Record<keyof ConfigurationProposal, string>>;
  return Object.entries(proposal)
    .filter(([, value]) => value !== undefined)
    .map(([field, value]) => {
      if (!Object.hasOwn(mappings, field))
        throw new Error("Unknown configuration proposal field.");
      return { path: mappings[field as keyof typeof mappings], value };
    });
};

export const parseStructuredConfigurationValues = (
  raw: unknown,
  metadata: ConfigurationMetadata | undefined,
): readonly { path: string; value: unknown }[] => {
  if (!metadata)
    throw new Error(
      "Update Rehearsal core for structured field review, or edit the active configuration manually.",
    );
  const fields = (raw as { fields: unknown }).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields))
    throw new Error("Invalid configuration fields.");
  const changes: { path: string; value: unknown }[] = [];
  for (const [path, input] of Object.entries(fields)) {
    const field = metadata.fields.find((field) => field.path === path);
    if (!field || typeof input !== "string" || input.length > 65536)
      throw new Error("Unknown or unbounded configuration field.");
    if (
      field.value === null &&
      input === "" &&
      field.kind !== "nullable-integer"
    )
      continue;
    try {
      let value: unknown = input;
      if (field.kind === "local-url" && path === "application.activity.url") {
        value = input === "" ? null : input;
      } else if (field.kind === "boolean") {
        if (!["true", "false"].includes(input))
          throw new Error("Invalid boolean.");
        value = input === "true";
      } else if (["integer", "nullable-integer"].includes(field.kind)) {
        value =
          input === "" && field.kind === "nullable-integer"
            ? null
            : Number(input);
        if (
          value !== null &&
          (!/^\d+$/u.test(input) || !Number.isSafeInteger(value))
        )
          throw new Error("Invalid whole-number input.");
      } else if (field.kind === "profiles") {
        value = JSON.parse(input);
      }
      if (field.kind === "profiles") {
        // Metadata uses null for an absent URL; core proposals omit that property.
        // Validate the public shape without rewriting the user's draft.
        const profiles = Array.isArray(value)
          ? value.map((entry: unknown) => {
              if (entry && typeof entry === "object" && !Array.isArray(entry)) {
                const profile = entry as Record<string, unknown>;
                if (profile.applicationUrl === null)
                  throw new Error("Omit an unused profile URL.");
                return Object.hasOwn(profile, "applicationUrl")
                  ? profile
                  : { ...profile, applicationUrl: null };
              }
              return entry;
            })
          : value;
        validateConfigurationFieldValue(path, field.kind, profiles);
      } else value = validateConfigurationFieldValue(path, field.kind, value);
      if (JSON.stringify(value) !== JSON.stringify(field.value))
        changes.push({ path, value });
    } catch {
      throw new ConfigurationInputError(path, field.kind);
    }
  }
  return changes;
};

const singleLine = (
  value: unknown,
  label: string,
  maximum = 500,
): string | undefined => {
  if (value === undefined || value === "") return undefined;
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    /[\r\n\0]/u.test(value)
  ) {
    throw new Error(`${label} must be bounded single-line text.`);
  }
  return value;
};

const loopbackUrl = (value: unknown): string | undefined => {
  const source = singleLine(value, "Application URL");
  if (!source) return undefined;
  const url = parseLocalEndpoint(source);
  return url.toString().replace(/\/$/u, "");
};

export const parseConfigurationProposal = (
  value: unknown,
): ConfigurationProposal => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Configuration proposal is invalid.");
  }
  const record = value as Record<string, unknown>;
  const runPersistence = record.runPersistence;
  const openPersistence = record.openPersistence;
  const retain =
    record.retainBaselineGenerations === undefined ||
    record.retainBaselineGenerations === ""
      ? undefined
      : Number(record.retainBaselineGenerations);
  if (
    runPersistence !== undefined &&
    !["keep-until-stop", "stop-after-run"].includes(String(runPersistence))
  ) {
    throw new Error("Run persistence is invalid.");
  }
  if (
    openPersistence !== undefined &&
    !["keep-until-stop", "stop-on-application-exit"].includes(
      String(openPersistence),
    )
  ) {
    throw new Error("Open persistence is invalid.");
  }
  if (
    retain !== undefined &&
    (!Number.isSafeInteger(retain) || retain < 1 || retain > 100)
  ) {
    throw new Error("Retained baseline generations must be between 1 and 100.");
  }
  const applicationUrl = loopbackUrl(record.applicationUrl);
  const startCommand = singleLine(record.startCommand, "Start command", 1_000);
  const proofCommand = singleLine(record.proofCommand, "Proof command", 1_000);
  const environmentName = singleLine(
    record.environmentName,
    "Environment name",
    100,
  )?.trim();
  if (
    record.protectEnvironment !== undefined &&
    typeof record.protectEnvironment !== "boolean"
  )
    throw new Error("Environment protection must be true or false.");
  return {
    ...(environmentName ? { environmentName } : {}),
    ...(record.protectEnvironment === undefined
      ? {}
      : { protectEnvironment: record.protectEnvironment as boolean }),
    ...(applicationUrl ? { applicationUrl } : {}),
    ...(startCommand ? { startCommand } : {}),
    ...(proofCommand ? { proofCommand } : {}),
    ...(runPersistence
      ? {
          runPersistence: runPersistence as
            "keep-until-stop" | "stop-after-run",
        }
      : {}),
    ...(openPersistence
      ? {
          openPersistence: openPersistence as
            "keep-until-stop" | "stop-on-application-exit",
        }
      : {}),
    ...(retain === undefined ? {} : { retainBaselineGenerations: retain }),
  };
};

const replaceInBlock = ({
  source,
  block,
  property,
  replacement,
}: {
  source: string;
  block: string;
  property: string;
  replacement: string;
}): string =>
  editLiteralConfiguration(source, [
    {
      path:
        block === "readiness"
          ? `application.readiness.${property}`
          : `${block}.${property}`,
      value: JSON.parse(replacement),
    },
  ]);

export const applyConfigurationProposal = ({
  source,
  proposal,
}: {
  source: string;
  proposal: ConfigurationProposal;
}): { readonly source: string; readonly changedFields: readonly string[] } => {
  let result = source;
  const changedFields: string[] = [];
  if (
    proposal.environmentName !== undefined &&
    !matchesLiteralConfigurationValue(
      result,
      "runtime.displayName",
      proposal.environmentName,
    )
  ) {
    result = editEnvironmentConfiguration(result, {
      displayName: proposal.environmentName,
    });
    changedFields.push("runtime.displayName");
  }
  if (
    proposal.protectEnvironment !== undefined &&
    !matchesLiteralConfigurationValue(
      result,
      "runtime.protected",
      proposal.protectEnvironment,
    )
  ) {
    result = editEnvironmentConfiguration(result, {
      protected: proposal.protectEnvironment,
    });
    changedFields.push("runtime.protected");
  }
  const update = (
    block: string,
    property: string,
    value: string | number | undefined,
    field: string,
  ) => {
    if (value === undefined) return;
    const next = replaceInBlock({
      source: result,
      block,
      property,
      replacement:
        typeof value === "number" ? String(value) : JSON.stringify(value),
    });
    if (next !== result) changedFields.push(field);
    result = next;
  };
  update(
    "runtime",
    "applicationUrl",
    proposal.applicationUrl,
    "runtime.applicationUrl",
  );
  update(
    "application",
    "startCommand",
    proposal.startCommand,
    "application.startCommand",
  );
  update(
    "application",
    "proofCommand",
    proposal.proofCommand,
    "application.proofCommand",
  );
  update("lifecycle", "run", proposal.runPersistence, "lifecycle.run");
  update("lifecycle", "open", proposal.openPersistence, "lifecycle.open");
  update(
    "cleanup",
    "retainBaselineGenerations",
    proposal.retainBaselineGenerations,
    "cleanup.retainBaselineGenerations",
  );
  // The browser address and application health check are separate reviewed fields.
  // Readiness changes belong to an explicit structured proposal or manual edit.
  return { source: result, changedFields };
};

export const configurationFingerprint = (source: string): string =>
  createHash("sha256").update(source).digest("hex");

export const configurationDiff = ({
  path,
  before,
  after,
}: {
  path: string;
  before: string;
  after: string;
}): string => {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  )
    prefix += 1;
  if (prefix === beforeLines.length && prefix === afterLines.length)
    return `${lines.join("\n")}\n`;
  let beforeEnd = beforeLines.length;
  let afterEnd = afterLines.length;
  while (
    beforeEnd > prefix &&
    afterEnd > prefix &&
    beforeLines[beforeEnd - 1] === afterLines[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  // Align unchanged suffixes before comparing: a one-line insertion must not make
  // every following setting look removed and re-added. Work stays linear and bounded.
  const start = Math.max(0, prefix - 3);
  const contextAfter = Math.min(3, beforeLines.length - beforeEnd);
  const oldCount = beforeEnd + contextAfter - start;
  const newCount = afterEnd + contextAfter - start;
  lines.push(
    `@@ -${oldCount ? start + 1 : start},${oldCount} +${newCount ? start + 1 : start},${newCount} @@`,
  );
  lines.push(...beforeLines.slice(start, prefix).map((line) => ` ${line}`));
  lines.push(...beforeLines.slice(prefix, beforeEnd).map((line) => `-${line}`));
  lines.push(...afterLines.slice(prefix, afterEnd).map((line) => `+${line}`));
  lines.push(
    ...beforeLines
      .slice(beforeEnd, beforeEnd + contextAfter)
      .map((line) => ` ${line}`),
  );
  return `${lines.join("\n")}\n`;
};
