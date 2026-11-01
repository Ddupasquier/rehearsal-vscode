import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
  readFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { readUpdateProjectIdentity } from "../../src/updates/update_identity.js";
const directories: string[] = [];
async function fixture() {
  const root = await realpath(
    await mkdtemp(resolve(tmpdir(), "rehearsal-update-origin-")),
  );
  directories.push(root);
  const pkg = resolve(root, "node_modules/@rehearsal-db/core");
  await mkdir(pkg, { recursive: true });
  await writeFile(
    resolve(root, "package.json"),
    JSON.stringify({ devDependencies: { "@rehearsal-db/core": "0.1.0-rc.7" } }),
  );
  await writeFile(
    resolve(pkg, "package.json"),
    JSON.stringify({
      name: "@rehearsal-db/core",
      version: "0.1.0-rc.7",
      bin: { rehearsal: "cli.mjs" },
    }),
  );
  await writeFile(
    resolve(pkg, "cli.mjs"),
    "throw new Error('must not execute');",
  );
  const lock = {
    lockfileVersion: 3,
    packages: {
      "node_modules/@rehearsal-db/core": {
        version: "0.1.0-rc.7",
        resolved:
          "https://registry.npmjs.org/@rehearsal-db/core/-/core-0.1.0-rc.7.tgz",
        integrity: `sha512-${"a".repeat(86)}==`,
      },
    },
  };
  await writeFile(
    resolve(root, "node_modules/.package-lock.json"),
    JSON.stringify(lock),
  );
  await writeFile(
    resolve(root, "package-lock.json"),
    JSON.stringify({
      ...lock,
      packages: {
        ...lock.packages,
        "": { devDependencies: { "@rehearsal-db/core": "0.1.0-rc.7" } },
      },
    }),
  );
  return { root, pkg, lock };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe("nonexecuting update installation identity", () => {
  it.each(["root-version", "hidden-version", "root-link", "hidden-link"])(
    "rejects malformed provenance metadata: %s",
    async (mode) => {
      const f = await fixture();
      const path = resolve(
        f.root,
        mode.startsWith("root")
          ? "package-lock.json"
          : "node_modules/.package-lock.json",
      );
      const lock = JSON.parse(await readFile(path, "utf8"));
      if (mode.endsWith("version")) lock.lockfileVersion = "3";
      else lock.packages["node_modules/@rehearsal-db/core"].link = "true";
      await writeFile(path, JSON.stringify(lock));
      expect(
        (await readUpdateProjectIdentity(f.root, "0.1.0-rc.7")).origin,
      ).not.toBe("registry");
    },
  );
  it.each(["dependencies", "devDependencies", "optionalDependencies"])(
    "preserves proven %s ownership",
    async (group) => {
      const f = await fixture();
      const manifest = {
        packageManager: "npm@11.19.0",
        [group]: { "@rehearsal-db/core": "^0.1.0-rc.7" },
      };
      await writeFile(
        resolve(f.root, "package.json"),
        JSON.stringify(manifest),
      );
      await writeFile(
        resolve(f.root, "package-lock.json"),
        JSON.stringify({
          ...f.lock,
          packages: { ...f.lock.packages, "": manifest },
        }),
      );
      expect(
        await readUpdateProjectIdentity(f.root, "0.1.0-rc.7"),
      ).toMatchObject({ origin: "registry", dependencyGroup: group });
    },
  );
  it.each([
    "missing-root-lock",
    "root-lock-mismatch",
    "no-save",
    "range-mismatch",
    "declaration-conflict",
    "unsupported-manager",
    "foreign-lock",
  ])(
    "requires matching npm root/hidden locks and declarations: %s",
    async (mode) => {
      const f = await fixture();
      if (mode === "missing-root-lock")
        await rm(resolve(f.root, "package-lock.json"));
      if (mode === "root-lock-mismatch")
        await writeFile(
          resolve(f.root, "package-lock.json"),
          JSON.stringify({
            ...f.lock,
            packages: {
              ...f.lock.packages,
              "": { dependencies: { "@rehearsal-db/core": "0.1.0-rc.7" } },
            },
          }),
        );
      if (mode === "no-save")
        await writeFile(resolve(f.root, "package.json"), "{}");
      if (mode === "range-mismatch")
        await writeFile(
          resolve(f.root, "package.json"),
          JSON.stringify({
            devDependencies: { "@rehearsal-db/core": "^0.2.0" },
          }),
        );
      if (mode === "declaration-conflict")
        await writeFile(
          resolve(f.root, "package.json"),
          JSON.stringify({
            dependencies: { "@rehearsal-db/core": "0.1.0-rc.7" },
            devDependencies: { "@rehearsal-db/core": "0.1.0-rc.7" },
          }),
        );
      if (mode === "unsupported-manager")
        await writeFile(
          resolve(f.root, "package.json"),
          JSON.stringify({
            packageManager: "pnpm@10.0.0",
            devDependencies: { "@rehearsal-db/core": "0.1.0-rc.7" },
          }),
        );
      if (mode === "foreign-lock")
        await writeFile(resolve(f.root, "yarn.lock"), "");
      const identity = await readUpdateProjectIdentity(f.root, "0.1.0-rc.7");
      expect(identity.origin).not.toBe("registry");
      expect(identity.dependencyGroup).toBeNull();
    },
  );
  it("rejects symlinked workspace and metadata ancestors", async () => {
    const f = await fixture();
    const link = `${f.root}-link`;
    directories.push(link);
    await symlink(f.root, link);
    expect((await readUpdateProjectIdentity(link, "0.1.0-rc.7")).origin).toBe(
      "unknown",
    );
    const alternate = await realpath(
      await mkdtemp(resolve(tmpdir(), "rehearsal-update-modules-")),
    );
    directories.push(alternate);
    await rm(resolve(f.root, "node_modules"), { recursive: true });
    await symlink(alternate, resolve(f.root, "node_modules"));
    expect(
      (await readUpdateProjectIdentity(f.root, "0.1.0-rc.7")).origin,
    ).not.toBe("registry");
  });
  it("proves registry provenance and changes fingerprint when reviewed metadata changes", async () => {
    const f = await fixture();
    const before = await readUpdateProjectIdentity(f.root, "0.1.0-rc.7");
    expect(before.origin).toBe("registry");
    await writeFile(
      resolve(f.root, "package.json"),
      JSON.stringify({
        devDependencies: { "@rehearsal-db/core": "^0.1.0-rc.7" },
      }),
    );
    expect(
      (await readUpdateProjectIdentity(f.root, "0.1.0-rc.7")).fingerprint,
    ).not.toBe(before.fingerprint);
  });
  it("refuses a same-version local candidate, source declaration, manifest drift and redirected lock", async () => {
    const f = await fixture();
    f.lock.packages["node_modules/@rehearsal-db/core"].resolved =
      "file:/private/candidate.tgz";
    await writeFile(
      resolve(f.root, "node_modules/.package-lock.json"),
      JSON.stringify(f.lock),
    );
    expect((await readUpdateProjectIdentity(f.root, "0.1.0-rc.7")).origin).toBe(
      "custom",
    );
    await writeFile(
      resolve(f.root, "package.json"),
      JSON.stringify({
        devDependencies: { "@rehearsal-db/core": "file:../source" },
      }),
    );
    expect((await readUpdateProjectIdentity(f.root, "0.1.0-rc.7")).origin).toBe(
      "custom",
    );
    expect((await readUpdateProjectIdentity(f.root, "0.1.0-rc.6")).origin).toBe(
      "custom",
    );
    await rm(resolve(f.root, "node_modules/.package-lock.json"));
    await symlink(
      resolve(f.root, "package.json"),
      resolve(f.root, "node_modules/.package-lock.json"),
    );
    await writeFile(
      resolve(f.root, "package.json"),
      JSON.stringify({
        devDependencies: { "@rehearsal-db/core": "0.1.0-rc.7" },
      }),
    );
    expect((await readUpdateProjectIdentity(f.root, "0.1.0-rc.7")).origin).toBe(
      "unknown",
    );
  });
});
