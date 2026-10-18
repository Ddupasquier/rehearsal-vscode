import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const requiredFiles = [
  "LICENSE",
  "PRIVACY.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CHANGELOG.md",
  "README.md",
] as const;

const requiredCommands = [
  "rehearsal.openPrivacy",
  "rehearsal.openSupport",
  "rehearsal.openLicense",
  "rehearsal.resetLocalState",
];

const forbidden = /\b(?:TODO|TBD|CHANGEME|example\.com)\b/iu;

export const commercialReadinessFailures = ({
  manifest,
  contents,
}: {
  manifest: Readonly<Record<string, unknown>>;
  contents: ReadonlyMap<string, string>;
}): string[] => {
  const commands = Array.isArray(
    (manifest.contributes as { commands?: unknown } | undefined)?.commands,
  )
    ? (
        (manifest.contributes as { commands: { command?: unknown }[] })
          .commands ?? []
      )
        .map(({ command }) => command)
        .filter((command): command is string => typeof command === "string")
    : [];
  const failures = [
    manifest.private !== true &&
      "package must remain private before reviewed publication",
    manifest.preview !== true && "preview metadata is required",
    manifest.pricing !== "Free" && "Starter pricing metadata must be Free",
    manifest.license !== "SEE LICENSE IN LICENSE" &&
      "manifest license is incorrect",
    !/^0\.1\.\d+$/u.test(String(manifest.version)) &&
      "unexpected Starter preview version",
    ...requiredCommands.map(
      (command) => !commands.includes(command) && `missing command ${command}`,
    ),
    !contents.get("README.md")?.includes("indefinitely at no charge") &&
      "README does not explain indefinite free Starter use",
    !contents.get("PRIVACY.md")?.includes("does not include telemetry") &&
      "privacy statement does not explicitly reject telemetry",
    !contents.get("LICENSE")?.includes("Starter License") &&
      "Starter license is missing",
    !contents.get("LICENSE")?.includes("indefinitely at no charge") &&
      "Starter license does not grant indefinite no-charge use",
    !contents.get("LICENSE")?.includes("personal or commercial development") &&
      "Starter license does not cover commercial development",
    /for 14 days/iu.test(contents.get("LICENSE") ?? "") &&
      "Starter license must not impose the previous evaluation period",
    !contents.get("SUPPORT.md")?.includes("best effort") &&
      "best-effort Starter support boundary is missing",
  ].filter((failure): failure is string => Boolean(failure));

  for (const [filename, content] of contents) {
    if (forbidden.test(content))
      failures.push(`${filename} contains a placeholder`);
  }
  return failures;
};

const main = async (): Promise<void> => {
  const contents = new Map<string, string>();
  for (const filename of requiredFiles) {
    const path = resolve(root, filename);
    const details = await stat(path);
    if (!details.isFile() || details.size === 0) {
      throw new Error(`Commercial candidate is missing ${filename}.`);
    }
    contents.set(filename, await readFile(path, "utf8"));
  }
  const manifest = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  const failures = commercialReadinessFailures({ manifest, contents });
  if (failures.length > 0) {
    throw new Error(`Commercial readiness failed:\n- ${failures.join("\n- ")}`);
  }

  console.log(
    JSON.stringify(
      {
        status: "passed",
        extension: `${String(manifest.publisher)}.${String(manifest.name)}@${String(manifest.version)}`,
        pricing: manifest.pricing,
        telemetry: "none",
        documents: requiredFiles,
        commands: requiredCommands,
        scope:
          "Starter metadata and documents, not legal or paid-launch approval",
        remainingOperationalApprovals: [
          "distribution or Marketplace publication",
          "future Pro terms, seller and support identity",
          "future Pro checkout, refunds and entitlement design",
        ],
      },
      null,
      2,
    ),
  );
};

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
