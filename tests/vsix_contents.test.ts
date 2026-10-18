import { describe, expect, it } from "vitest";
import { assertArchiveContents } from "../scripts/verify-private-vsix.js";

const publicArchive = [
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/package.json",
  "extension/dist/src/extension.js",
  "extension/dist/src/workspace_view.js",
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

describe("public VSIX archive boundary", () => {
  it("accepts approved public documents, assets and direct compiled runtime modules", () => {
    expect(() => assertArchiveContents(publicArchive)).not.toThrow();
  });

  it.each([
    "extension/test-results/PRIVATE_CANARY/result.json",
    "extension/coverage/index.html",
    "extension/.env",
    "extension/docs/internal.md",
    "extension/src/extension.ts",
    "extension/tests/example.test.ts",
    "extension/scripts/private.js",
    "extension/dist/src/extension.js.map",
    "extension/dist/src/extension.d.ts",
    "extension/dist/src/nested/extra.js",
    "extension/dist/src/../private.js",
    "extension/media/unreviewed.png",
    "extension/unknown.txt",
    "unknown.txt",
    " extension/package.json",
    "extension/package.json ",
  ])(
    "rejects unexpected archive entry %s without echoing its path",
    (entry) => {
      const check = () => assertArchiveContents([...publicArchive, entry]);
      expect(check).toThrow("outside the public runtime allowlist");
      try {
        check();
      } catch (error) {
        expect(String(error)).not.toContain(entry);
        expect(String(error)).not.toContain("PRIVATE_CANARY");
      }
    },
  );

  it("refuses duplicate entries even when the path is public", () => {
    expect(() =>
      assertArchiveContents([...publicArchive, "extension/package.json"]),
    ).toThrow("duplicate");
  });

  it.each([
    "[Content_Types].xml",
    "extension/SECURITY.md",
    "extension/LICENSE.txt",
    "extension/dist/src/extension.js",
  ])("requires reviewed delivery file %s", (entry) => {
    expect(() =>
      assertArchiveContents(publicArchive.filter((path) => path !== entry)),
    ).toThrow("Packaged extension is missing");
  });
});
