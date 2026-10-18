/** Read installation provenance only after consent; never execute a package. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveWorkspaceRehearsal } from "./process_adapter.js";
import {
  comparePublishedVersions,
  isPublishedVersion,
  type DependencyGroup,
  type UpdateProjectIdentity,
} from "./update_advisory.js";

async function boundedMetadata(path: string, maximum: number): Promise<string> {
  if ((await realpath(dirname(path))) !== dirname(path))
    throw new Error("Unknown installation metadata.");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximum)
      throw new Error("Unknown installation metadata.");
    const buffer = Buffer.alloc(maximum + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (
      bytesRead > maximum ||
      (await realpath(dirname(path))) !== dirname(path)
    )
      throw new Error("Unknown installation metadata.");
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unknown installation metadata.");
  return value as Record<string, unknown>;
};
const groups: readonly DependencyGroup[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];
function declarations(manifest: Record<string, unknown>) {
  return groups.flatMap((group) =>
    manifest[group] === undefined
      ? []
      : Object.hasOwn(object(manifest[group]), "@rehearsal-db/core")
        ? [{ group, value: object(manifest[group])["@rehearsal-db/core"] }]
        : [],
  );
}
function accepts(declaration: unknown, installed: string): boolean {
  if (typeof declaration !== "string") return false;
  if (
    declaration === "latest" ||
    declaration === "beta" ||
    declaration === installed
  )
    return true;
  const operator = declaration[0],
    base = declaration.slice(1);
  if (
    (operator !== "^" && operator !== "~") ||
    !isPublishedVersion(base) ||
    comparePublishedVersions(installed, base)! < 0
  )
    return false;
  const actual = installed.split("-", 1)[0]!.split("."),
    minimum = base.split("-", 1)[0]!.split(".");
  return (
    actual[0] === minimum[0] &&
    (!(operator === "~" || minimum[0] === "0") || actual[1] === minimum[1]) &&
    (!(minimum[0] === "0" && minimum[1] === "0") || actual[2] === minimum[2]) &&
    (!installed.includes("-") || actual.join(".") === minimum.join("."))
  );
}
export async function readUpdateProjectIdentity(
  root: string,
  expectedVersion: string | undefined,
): Promise<UpdateProjectIdentity> {
  const hash = createHash("sha256");
  let version: string | null = expectedVersion ?? null;
  const result = (
    origin: UpdateProjectIdentity["origin"],
    dependencyGroup: DependencyGroup | null = null,
  ): UpdateProjectIdentity => ({
    version,
    origin,
    dependencyGroup,
    fingerprint: hash.digest("hex"),
  });
  try {
    if ((await realpath(root)) !== resolve(root)) return result("unknown");
    const installed = await resolveWorkspaceRehearsal(root);
    version = installed.version;
    const source = await boundedMetadata(
      resolve(root, "package.json"),
      1024 * 1024,
    );
    const packageSource = await boundedMetadata(
      installed.manifestPath,
      1024 * 1024,
    );
    hash.update(source).update(packageSource);
    if (version !== expectedVersion || !isPublishedVersion(version))
      return result("custom");
    const manifest = object(JSON.parse(source));
    if (
      manifest.packageManager !== undefined &&
      (typeof manifest.packageManager !== "string" ||
        !/^npm@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(
          manifest.packageManager,
        ))
    )
      return result("custom");
    for (const name of [
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
    ]) {
      try {
        await lstat(resolve(root, name));
        return result("custom");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const declared = declarations(manifest);
    if (declared.length !== 1 || !accepts(declared[0]!.value, version))
      return result("custom");
    const rootSource = await boundedMetadata(
      resolve(root, "package-lock.json"),
      4 * 1024 * 1024,
    );
    const hiddenSource = await boundedMetadata(
      resolve(root, "node_modules/.package-lock.json"),
      4 * 1024 * 1024,
    );
    hash.update(rootSource).update(hiddenSource);
    const rootLock = object(JSON.parse(rootSource)),
      hiddenLock = object(JSON.parse(hiddenSource));
    if (
      !(rootLock.lockfileVersion === 2 || rootLock.lockfileVersion === 3) ||
      !(hiddenLock.lockfileVersion === 2 || hiddenLock.lockfileVersion === 3)
    )
      return result("custom");
    const rootPackages = object(rootLock.packages),
      hiddenPackages = object(hiddenLock.packages);
    const lockedDeclarations = declarations(object(rootPackages[""]));
    if (
      lockedDeclarations.length !== 1 ||
      lockedDeclarations[0]!.group !== declared[0]!.group ||
      lockedDeclarations[0]!.value !== declared[0]!.value
    )
      return result("custom");
    const entry = object(rootPackages["node_modules/@rehearsal-db/core"]),
      hidden = object(hiddenPackages["node_modules/@rehearsal-db/core"]);
    const valid =
      entry.version === version &&
      (entry.link === undefined || entry.link === false) &&
      (hidden.link === undefined || hidden.link === false) &&
      entry.resolved ===
        `https://registry.npmjs.org/@rehearsal-db/core/-/core-${version}.tgz` &&
      typeof entry.integrity === "string" &&
      /^sha512-[A-Za-z0-9+/]{86}==$/u.test(entry.integrity) &&
      hidden.version === entry.version &&
      hidden.resolved === entry.resolved &&
      hidden.integrity === entry.integrity;
    return result(
      valid ? "registry" : "custom",
      valid ? declared[0]!.group : null,
    );
  } catch {
    hash.update("unavailable");
    return result("unknown");
  }
}
