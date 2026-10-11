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
    manifest.pricing !== "Trial" && "Marketplace pricing label must be Trial",
    manifest.license !== "SEE LICENSE IN LICENSE" &&
      "manifest license is incorrect",
    !/^0\.1\.\d+$/u.test(String(manifest.version)) &&
      "unexpected commercial preview version",
    ...requiredCommands.map(
      (command) => !commands.includes(command) && `missing command ${command}`,
    ),
    !contents.get("README.md")?.includes("14-day evaluation") &&
      "README does not explain the evaluation",
    !contents.get("PRIVACY.md")?.includes("does not include telemetry") &&
      "privacy statement does not explicitly reject telemetry",
    !contents.get("LICENSE")?.includes("Commercial Preview License") &&
      "commercial license is missing",
    !contents.get("SUPPORT.md")?.includes("three business days") &&
      "support response target is missing",
  ].filter((failure): failure is string => Boolean(failure));

  for (const [filename, content] of contents) {
    if (forbidden.test(content))
      failures.push(`${filename} contains a placeholder`);
  }
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
        remainingOperationalApprovals: [
          "legal review",
          "seller and support identity",
          "checkout and refund setup",
          "distribution or Marketplace publication",
        ],
      },
      null,
      2,
    ),
  );
};

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
