/**
 * Minimal pre-install project inspection using an injected workspace reader.
 * Comprehensive discovery belongs to Rehearsal core's public JSON contract.
 */

import type {
  DecisionDiscoveryItem,
  DetectedDiscoveryItem,
  DiscoveryConfigurationField,
  ProjectDiscoveryData,
  SuggestedDiscoveryItem,
} from "./contracts.js";

export type WorkspaceEntryKind = "file" | "directory" | "symlink" | null;

export interface WorkspaceMetadataReader {
  readonly workspaceName: string;
  kind(path: string): Promise<WorkspaceEntryKind>;
  readText(path: string, maximumBytes: number): Promise<string | null>;
}

const PACKAGE_LIMIT = 1024 * 1024;

const recordStrings = (value: unknown): Record<string, string> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

const projectName = (manifestName: unknown, fallback: string): string => {
  const source =
    typeof manifestName === "string" && manifestName.trim()
      ? manifestName
      : fallback;
  return (
    source
      .toLowerCase()
      .replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 52)
      .replace(/-$/u, "") || "rehearsal-project"
  );
};

const packageManagerCommand = (manager: string, script: string): string =>
  manager === "yarn" ? `yarn ${script}` : `${manager} run ${script}`;

export const bootstrapProjectDiscovery = async (
  reader: WorkspaceMetadataReader,
): Promise<ProjectDiscoveryData> => {
  const source = await reader.readText("package.json", PACKAGE_LIMIT);
  let manifest: Record<string, unknown> = {};
  if (source !== null) {
    try {
      const parsed: unknown = JSON.parse(source);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        manifest = parsed as Record<string, unknown>;
      }
    } catch {
      // A malformed manifest remains an unresolved project decision. The
      // bootstrap does not surface its contents or attempt recovery.
    }
  }
  const scripts = recordStrings(manifest.scripts);
  const dependencies = {
    ...recordStrings(manifest.dependencies),
    ...recordStrings(manifest.devDependencies),
  };
  const detected: DetectedDiscoveryItem[] = [];
  const suggested: SuggestedDiscoveryItem[] = [];
  const decisions: DecisionDiscoveryItem[] = [];

  const managers = (
    await Promise.all(
      (
        [
          ["npm", "package-lock.json"],
          ["pnpm", "pnpm-lock.yaml"],
          ["yarn", "yarn.lock"],
          ["bun", "bun.lock"],
          ["bun", "bun.lockb"],
        ] as const
      ).map(async ([manager, path]) => ({
        manager,
        path,
        exists: (await reader.kind(path)) === "file",
      })),
    )
  ).filter(({ exists }) => exists);
  const distinctManagers = [...new Set(managers.map(({ manager }) => manager))];
  const manager = distinctManagers.length === 1 ? distinctManagers[0]! : "npm";
  if (distinctManagers.length === 1) {
    const managerFiles = managers.filter((entry) => entry.manager === manager);
    detected.push({
      category: "detected",
      id: "package.manager",
      label: "Package manager",
      value: manager,
      evidence: managerFiles.map(({ path }) => ({
        kind: "file",
        source: path,
        detail: `${manager} lockfile is present.`,
      })),
    });
  } else if (distinctManagers.length > 1) {
    decisions.push({
      category: "decision",
      id: "package.manager",
      label: "Package manager",
      value: distinctManagers,
      question: "Which package manager owns this project?",
      reason: "More than one lockfile is present.",
      evidence: managers.map(({ manager: value, path }) => ({
        kind: "file",
        source: path,
        detail: `${value} lockfile is present.`,
      })),
    });
  }

  const relevantScripts = [
    "dev:rehearsal",
    "dev",
    "start",
    "verify:feature",
    "test",
    "check",
    "build",
  ].filter((name) => typeof scripts[name] === "string");
  if (relevantScripts.length > 0) {
    detected.push({
      category: "detected",
      id: "package.scripts",
      label: "Available package scripts",
      value: relevantScripts,
      evidence: [
        {
          kind: "manifest",
          source: "package.json#scripts",
          detail: "Only script names are shown.",
        },
      ],
    });
  }

  const frameworks = [
    ["vite", "Vite"] as const,
    ["next", "Next.js"] as const,
    ["astro", "Astro"] as const,
    ["nuxt", "Nuxt"] as const,
    ["@sveltejs/kit", "SvelteKit"] as const,
    ["@remix-run/dev", "Remix"] as const,
  ].filter(([name]) => name in dependencies);
  if (frameworks.length === 1) {
    suggested.push({
      category: "suggested",
      id: "application.framework",
      label: "Application framework",
      value: frameworks[0]![1],
      confidence: "high",
      review: "Confirm this is the application Rehearsal should launch.",
      evidence: [
        {
          kind: "manifest",
          source: `package.json#${frameworks[0]![0]}`,
          detail: `${frameworks[0]![0]} is declared as a dependency.`,
        },
      ],
    });
  }

  const startScript = ["dev:rehearsal", "dev", "start"].find(
    (name) => typeof scripts[name] === "string",
  );
  if (startScript && distinctManagers.length <= 1) {
    suggested.push({
      category: "suggested",
      id: "application.startCommand",
      label: "Application start command",
      value: packageManagerCommand(manager, startScript),
      confidence: "high",
      review: "Review the command before adding it to Rehearsal.",
      configPath: "application.startCommand",
      evidence: [
        {
          kind: "script",
          source: `package.json#scripts.${startScript}`,
          detail: `The ${startScript} script is defined.`,
        },
      ],
    });
  }
  const proofScript = ["verify:feature", "test", "check"].find(
    (name) => typeof scripts[name] === "string",
  );
  if (proofScript && distinctManagers.length <= 1) {
    suggested.push({
      category: "suggested",
      id: "application.proofCommand",
      label: "Application proof command",
      value: packageManagerCommand(manager, proofScript),
      confidence: "high",
      review: "Confirm this proves behavior affected by migrations.",
      configPath: "application.proofCommand",
      evidence: [
        {
          kind: "script",
          source: `package.json#scripts.${proofScript}`,
          detail: `The ${proofScript} script is defined.`,
        },
      ],
    });
  }

  const migrationDirectories = (
    await Promise.all(
      [
        "supabase/migrations",
        "database/migrations",
        "db/migrations",
        "migrations",
        "prisma/migrations",
      ].map(async (path) => ({
        path,
        exists: (await reader.kind(path)) === "directory",
      })),
    )
  ).filter(({ exists }) => exists);
  if (migrationDirectories.length > 0) {
    detected.push({
      category: "detected",
      id: "database.migrationDirectories",
      label: "Migration directories",
      value: migrationDirectories.map(({ path }) => path),
      evidence: migrationDirectories.map(({ path }) => ({
        kind: "file",
        source: path,
        detail: "Project-local migration directory is present.",
      })),
    });
  }

  const configPaths = (
    await Promise.all(
      [
        "rehearsal.config.mjs",
        "rehearsal.config.js",
        "rehearsal.config.ts",
        "infrastructure/rehearsal/rehearsal.config.mjs",
        "infrastructure/rehearsal/rehearsal.config.ts",
      ].map(async (path) => ({
        path,
        exists: (await reader.kind(path)) === "file",
      })),
    )
  ).filter(({ exists }) => exists);
  if (configPaths.length > 0) {
    detected.push({
      category: "detected",
      id: "rehearsal.configuration",
      label: "Rehearsal configuration files",
      value: configPaths.map(({ path }) => path),
      evidence: configPaths.map(({ path }) => ({
        kind: "file",
        source: path,
        detail: "Known configuration filename is present; it was not executed.",
      })),
    });
  }

  decisions.push(
    {
      category: "decision",
      id: "privacy.productionData",
      label: "Production data scope",
      value: "Requires review",
      question: "Which production-shaped records may be copied and sanitized?",
      reason: "Workspace metadata cannot establish permission to copy data.",
      evidence: [],
    },
    {
      category: "decision",
      id: "privacy.sanitization",
      label: "Sanitization policy",
      value: "Requires review",
      question: "Which fields must be excluded, transformed, or preserved?",
      reason: "Privacy rules must be explicitly reviewed.",
      configPath: "baseline.sanitizationPolicy",
      evidence: [],
    },
    {
      category: "decision",
      id: "privacy.identity",
      label: "Identity policy",
      value: "Requires review",
      question: "How should copied identities be represented locally?",
      reason: "Authentication and ownership behavior cannot be inferred.",
      configPath: "identityPolicy",
      evidence: [],
    },
  );

  const fieldForSuggestion = (path: string): DiscoveryConfigurationField => {
    const match = suggested.find((item) => item.configPath === path);
    return {
      path,
      status: match ? "suggested" : "not_detected",
      ...(match ? { value: match.value } : {}),
      sourceItemIds: match ? [match.id] : [],
    };
  };

  return {
    schemaVersion: 1,
    project: {
      name: projectName(manifest.name, reader.workspaceName),
      packageManifest: source === null ? "missing" : "present",
    },
    detected,
    suggested,
    decisions,
    configuration: {
      state:
        configPaths.length === 0
          ? "missing"
          : configPaths.length === 1
            ? "present_unvalidated"
            : "ambiguous",
      activePath: configPaths[0]?.path ?? null,
      discoveredPaths: configPaths.map(({ path }) => path),
      fields: [
        {
          path: "configuration.path",
          status:
            configPaths.length === 0
              ? "not_detected"
              : configPaths.length === 1
                ? "present_unvalidated"
                : "decision_required",
          ...(configPaths[0] ? { value: configPaths[0].path } : {}),
          sourceItemIds:
            configPaths.length > 0 ? ["rehearsal.configuration"] : [],
        },
        fieldForSuggestion("application.startCommand"),
        fieldForSuggestion("application.proofCommand"),
        {
          path: "baseline.sanitizationPolicy",
          status: "decision_required",
          sourceItemIds: ["privacy.sanitization"],
        },
        {
          path: "identityPolicy",
          status: "decision_required",
          sourceItemIds: ["privacy.identity"],
        },
      ],
    },
    safety: {
      projectCodeExecuted: false,
      environmentFilesRead: false,
      databaseContacted: false,
      containerEngineStarted: false,
    },
  };
};
