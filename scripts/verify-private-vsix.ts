import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(__dirname, "..");
const vscodeCli = process.env.VSCODE_CLI || "code";
const outputLimit = 4 * 1024 * 1024;

type ExtensionManifest = {
  name?: unknown;
  publisher?: unknown;
  version?: unknown;
  license?: unknown;
  preview?: unknown;
  pricing?: unknown;
};

const run = async (
  command: string,
  arguments_: string[],
): Promise<{ stdout: string; stderr: string }> =>
  execFileAsync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: outputLimit,
  });

export const assertArchiveContents = (entries: readonly string[]): void => {
  const required = [
    "[Content_Types].xml",
    "extension.vsixmanifest",
    "extension/package.json",
    "extension/dist/src/extension.js",
    "extension/readme.md",
    "extension/LICENSE.txt",
    "extension/PRIVACY.md",
    "extension/SECURITY.md",
    "extension/SUPPORT.md",
    "extension/changelog.md",
    "extension/media/rehearsal.svg",
    "extension/media/rehearsal-readme.png",
    "extension/media/workspace.css",
  ];
  for (const path of required) {
    if (!entries.includes(path)) {
      throw new Error(`Packaged extension is missing ${path}.`);
    }
  }

  const publicFiles = new Set(required);
  const unexpected = entries.filter(
    (path) =>
      !publicFiles.has(path) &&
      !/^extension\/dist\/src\/[a-z][a-z0-9_]*\.js$/u.test(path),
  );
  if (unexpected.length > 0 || new Set(entries).size !== entries.length) {
    throw new Error(
      "Packaged extension contains unexpected or duplicate files outside the public runtime allowlist.",
    );
  }
};

const main = async (): Promise<void> => {
  const temporaryRoot = await mkdtemp(
    resolve(tmpdir(), "rehearsal-vscode-private-install-"),
  );
  const suppliedCandidate = process.argv[2];
  const previousCandidate = process.argv[3]
    ? resolve(process.cwd(), process.argv[3]!)
    : undefined;
  const expectedManifest = JSON.parse(
    await readFile(resolve(repositoryRoot, "package.json"), "utf8"),
  ) as ExtensionManifest;
  const expectedIdentity = `${String(expectedManifest.publisher)}.${String(expectedManifest.name)}@${String(expectedManifest.version)}`;
  const vsixPath = suppliedCandidate
    ? resolve(process.cwd(), suppliedCandidate)
    : resolve(
        temporaryRoot,
        `rehearsal-${String(expectedManifest.version)}.vsix`,
      );
  const userDataPath = resolve(temporaryRoot, "user-data");
  const extensionsPath = resolve(temporaryRoot, "extensions");

  try {
    if (!suppliedCandidate) {
      await run("npm", ["run", "package:vsix", "--", "--out", vsixPath]);
    }

    const archive = await readFile(vsixPath);
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const { stdout: archiveOutput } = await run("unzip", ["-Z1", vsixPath]);
    const entries = archiveOutput.split(/\r?\n/u).filter(Boolean);
    assertArchiveContents(entries);

    const { stdout: manifestOutput } = await run("unzip", [
      "-p",
      vsixPath,
      "extension/package.json",
    ]);
    const manifest = JSON.parse(manifestOutput) as ExtensionManifest;
    if (
      manifest.publisher !== expectedManifest.publisher ||
      manifest.name !== expectedManifest.name ||
      manifest.version !== expectedManifest.version ||
      manifest.license !== "SEE LICENSE IN LICENSE" ||
      manifest.preview !== true ||
      manifest.pricing !== "Free"
    ) {
      throw new Error(
        `Packaged extension metadata does not match ${expectedIdentity}.`,
      );
    }

    let upgradeFrom: string | null = null;
    if (previousCandidate) {
      const { stdout: previousManifestOutput } = await run("unzip", [
        "-p",
        previousCandidate,
        "extension/package.json",
      ]);
      const previousManifest = JSON.parse(
        previousManifestOutput,
      ) as ExtensionManifest;
      upgradeFrom = `${String(previousManifest.publisher)}.${String(previousManifest.name)}@${String(previousManifest.version)}`;
      if (
        previousManifest.publisher !== expectedManifest.publisher ||
        previousManifest.name !== expectedManifest.name ||
        previousManifest.version === expectedManifest.version
      ) {
        throw new Error(
          "The previous VSIX must have the same extension identity and a different version.",
        );
      }
      await run(vscodeCli, [
        "--user-data-dir",
        userDataPath,
        "--extensions-dir",
        extensionsPath,
        "--install-extension",
        previousCandidate,
        "--force",
      ]);
    }

    await run(vscodeCli, [
      "--user-data-dir",
      userDataPath,
      "--extensions-dir",
      extensionsPath,
      "--install-extension",
      vsixPath,
      "--force",
    ]);
    const { stdout: installedOutput } = await run(vscodeCli, [
      "--user-data-dir",
      userDataPath,
      "--extensions-dir",
      extensionsPath,
      "--list-extensions",
      "--show-versions",
    ]);
    const installed = installedOutput
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!installed.includes(expectedIdentity)) {
      throw new Error(
        `Isolated VS Code installation did not report ${expectedIdentity} (received: ${installed.join(", ") || "nothing"}).`,
      );
    }

    await run(vscodeCli, [
      "--user-data-dir",
      userDataPath,
      "--extensions-dir",
      extensionsPath,
      "--uninstall-extension",
      `${String(expectedManifest.publisher)}.${String(expectedManifest.name)}`,
    ]);
    const { stdout: uninstalledOutput } = await run(vscodeCli, [
      "--user-data-dir",
      userDataPath,
      "--extensions-dir",
      extensionsPath,
      "--list-extensions",
      "--show-versions",
    ]);
    const afterUninstall = uninstalledOutput
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (
      afterUninstall.some((entry) =>
        entry.startsWith(
          `${String(expectedManifest.publisher)}.${String(expectedManifest.name)}@`,
        ),
      )
    ) {
      throw new Error("Isolated VS Code uninstall left Rehearsal installed.");
    }

    console.log(
      JSON.stringify(
        {
          status: "passed",
          extension: expectedIdentity,
          sha256,
          bytes: archive.byteLength,
          files: entries.length,
          candidate: suppliedCandidate
            ? vsixPath
            : "generated for verification",
          upgradeFrom,
          vscodeCli,
          isolation: {
            userData: true,
            extensions: true,
            uninstall: true,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
