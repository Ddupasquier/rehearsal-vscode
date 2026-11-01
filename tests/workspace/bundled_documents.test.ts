import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const editor = vi.hoisted(() => ({
  stat: vi.fn(),
  open: vi.fn(),
  show: vi.fn(),
}));
vi.mock("vscode", () => ({
  Uri: {
    joinPath: (root: { fsPath: string }, filename: string) => ({
      fsPath: `${root.fsPath}/${filename}`,
    }),
  },
  workspace: {
    fs: { stat: editor.stat },
    openTextDocument: editor.open,
  },
  window: { showTextDocument: editor.show },
}));

import { openBundledDocument } from "../../src/workspace/bundled_documents.js";

const directories: string[] = [];
const fixture = async (files: Record<string, string>) => {
  const base = resolve("test-results");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "bundled-documents-"));
  directories.push(root);
  for (const [filename, contents] of Object.entries(files))
    await writeFile(join(root, filename), contents);
  return { fsPath: root } as Parameters<typeof openBundledDocument>[0];
};

beforeEach(() => {
  editor.stat.mockReset().mockImplementation(async ({ fsPath }) => {
    try {
      return await stat(fsPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw Object.assign(new Error("Bundled document not found."), {
          code: "FileNotFound",
        });
      throw error;
    }
  });
  editor.open.mockReset().mockImplementation(async ({ fsPath }) => ({
    filename: fsPath,
    text: await readFile(fsPath, "utf8"),
  }));
  editor.show.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("bundled policy documents", () => {
  it("opens the LICENSE.txt path present in the verified VSIX layout", async () => {
    const root = await fixture({ "LICENSE.txt": "Packaged Starter grant." });
    await openBundledDocument(root, "LICENSE");
    expect(editor.open).toHaveBeenCalledOnce();
    expect(editor.open).toHaveBeenCalledWith({
      fsPath: join(root.fsPath, "LICENSE.txt"),
    });
    expect(editor.show).toHaveBeenCalledWith(
      {
        filename: join(root.fsPath, "LICENSE.txt"),
        text: "Packaged Starter grant.",
      },
      { preview: true },
    );
  });

  it("falls back to LICENSE for a source checkout", async () => {
    const root = await fixture({ LICENSE: "Source Starter grant." });
    await openBundledDocument(root, "LICENSE");
    expect(editor.open).toHaveBeenCalledWith({
      fsPath: join(root.fsPath, "LICENSE"),
    });
    expect(editor.show).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Source Starter grant." }),
      { preview: true },
    );
  });

  it("prefers the packaged grant if both filenames are present", async () => {
    const root = await fixture({
      "LICENSE.txt": "Packaged grant.",
      LICENSE: "Other text.",
    });
    await openBundledDocument(root, "LICENSE");
    expect(editor.show).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Packaged grant." }),
      { preview: true },
    );
  });

  it.each(["PRIVACY.md", "SUPPORT.md"] as const)(
    "retains the exact bundled %s path",
    async (filename) => {
      const root = await fixture({ [filename]: "Bundled policy." });
      await openBundledDocument(root, filename);
      expect(editor.stat).not.toHaveBeenCalled();
      expect(editor.open).toHaveBeenCalledWith({
        fsPath: join(root.fsPath, filename),
      });
    },
  );

  it("does not mask a packaged-license access error with source fallback", async () => {
    const root = await fixture({ LICENSE: "Fallback must not be used." });
    const failure = Object.assign(new Error("Access denied."), {
      code: "NoPermissions",
    });
    editor.stat.mockRejectedValueOnce(failure);
    await expect(openBundledDocument(root, "LICENSE")).rejects.toBe(failure);
    expect(editor.open).not.toHaveBeenCalled();
    expect(editor.show).not.toHaveBeenCalled();
  });

  it("reports a missing document instead of claiming it was displayed", async () => {
    const root = await fixture({});
    await expect(openBundledDocument(root, "LICENSE")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(editor.show).not.toHaveBeenCalled();
  });
});
