import { createHash } from "node:crypto";

export interface ConfigurationProposal {
  readonly applicationUrl?: string;
  readonly startCommand?: string;
  readonly proofCommand?: string;
  readonly runPersistence?: "keep-until-stop" | "stop-after-run";
  readonly openPersistence?: "keep-until-stop" | "stop-on-application-exit";
  readonly retainBaselineGenerations?: number;
}

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
  const url = new URL(source);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error("Application URL must be an HTTP(S) loopback URL.");
  }
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
  return {
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
}): string => {
  const blockPattern = new RegExp(
    `(\\b${block}\\s*:\\s*\\{[\\s\\S]{0,5000}?)(\\b${property}\\s*:\\s*)([^,\\n}]+)`,
    "u",
  );
  const matches = [...source.matchAll(new RegExp(blockPattern.source, "gu"))];
  if (matches.length !== 1) {
    throw new Error(
      `The active configuration does not contain one editable ${block}.${property} literal.`,
    );
  }
  const current = matches[0]?.[3]?.trim() ?? "";
  const expectsString = replacement.startsWith('"');
  if (
    (expectsString && !/^(?:"[^"\r\n]*"|'[^'\r\n]*')$/u.test(current)) ||
    (!expectsString && !/^\d+$/u.test(current))
  ) {
    throw new Error(
      `The active configuration does not contain one editable ${block}.${property} literal.`,
    );
  }
  return source.replace(
    blockPattern,
    (_match, prefix: string, propertyPrefix: string) =>
      `${prefix}${propertyPrefix}${replacement}`,
  );
};

export const applyConfigurationProposal = ({
  source,
  proposal,
}: {
  source: string;
  proposal: ConfigurationProposal;
}): { readonly source: string; readonly changedFields: readonly string[] } => {
  let result = source;
  const changedFields: string[] = [];
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
  if (proposal.applicationUrl !== undefined) {
    result = replaceInBlock({
      source: result,
      block: "readiness",
      property: "url",
      replacement: JSON.stringify(proposal.applicationUrl),
    });
    changedFields.push("application.readiness.url");
  }
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
  const maximum = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maximum; index += 1) {
    if (beforeLines[index] === afterLines[index]) continue;
    if (beforeLines[index] !== undefined) lines.push(`-${beforeLines[index]}`);
    if (afterLines[index] !== undefined) lines.push(`+${afterLines[index]}`);
  }
  return `${lines.join("\n")}\n`;
};
