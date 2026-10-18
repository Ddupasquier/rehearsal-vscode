import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  applyExtensionReleaseUpdate,
  extensionReleasePresentation,
  type ExtensionReleaseDomDocument,
  type ExtensionReleaseDomNode,
  type ExtensionReleaseEvidence,
} from "../src/extension_release_view.js";

const checkedAt = Date.parse("2026-10-18T06:00:00.000Z");
const checked = (
  latestVersion = "0.1.12",
  channel: "stable" | "preview" = "stable",
): ExtensionReleaseEvidence => ({
  status: "checked",
  latestVersion,
  checkedAt,
  channel,
});

describe("extension release presentation", () => {
  it("shows the installed extension separately from a confirmed newer release", () => {
    expect(extensionReleasePresentation("0.1.11", checked())).toEqual({
      text: "Extension 0.1.11 → 0.1.12",
      title:
        "Extension 0.1.11. Newer stable release 0.1.12 available; checked 2026-10-18T06:00:00.000Z.",
      state: "available",
    });
  });

  it.each([
    ["0.1.11", "current", "matches the newest checked"],
    ["0.1.10", "ahead", "is newer than the newest checked"],
  ])("does not imply an update to %s", (latest, state, description) => {
    const presentation = extensionReleasePresentation(
      "0.1.11",
      checked(latest),
    );
    expect(presentation.text).toBe("Extension 0.1.11");
    expect(presentation.state).toBe(state);
    expect(presentation.title).toContain(description);
    expect(presentation.title).toContain("stable release");
    expect(presentation.title).toContain("as of 2026-10-18T06:00:00.000Z");
  });

  it("compares versions semantically and labels preview evidence", () => {
    expect(
      extensionReleasePresentation("0.1.9", checked("0.1.10", "preview")),
    ).toMatchObject({
      text: "Extension 0.1.9 → 0.1.10",
      title: expect.stringContaining("preview release"),
      state: "available",
    });
  });

  it("does not claim currentness without checked release evidence", () => {
    for (const evidence of [
      undefined,
      { ...checked(), status: "unknown" as const },
    ]) {
      const presentation = extensionReleasePresentation("0.1.11", evidence);
      expect(presentation.text).toBe("Extension 0.1.11");
      expect(presentation.state).toBe("unknown");
      expect(presentation.title).toContain("availability is unknown");
      expect(presentation.title).not.toContain("matches");
    }
  });

  it("shows checking without presenting previously checked metadata as new evidence", () => {
    expect(
      extensionReleasePresentation("0.1.11", {
        ...checked(),
        status: "checking",
      }),
    ).toEqual({
      text: "Extension 0.1.11",
      title: "Extension 0.1.11. Checking optional stable release metadata.",
      state: "checking",
    });
  });

  it.each([
    { latestVersion: "file:local" },
    { latestVersion: "0.1.12<script>" },
    { latestVersion: null },
    { latestVersion: "0.1.12\n" },
    { checkedAt: null },
    { checkedAt: -1 },
    { checkedAt: Number.NaN },
    { checkedAt: Number.MAX_SAFE_INTEGER },
    { channel: "unreviewed" },
    { status: "failed" },
  ])("keeps malformed evidence unknown: %j", (change) => {
    const presentation = extensionReleasePresentation("0.1.11", {
      ...checked(),
      ...change,
    } as ExtensionReleaseEvidence);
    expect(presentation.state).toBe("unknown");
    expect(presentation.text).toBe("Extension 0.1.11");
  });

  it("does not invent an installed extension version", () => {
    expect(
      extensionReleasePresentation("unavailable", checked()),
    ).toMatchObject({
      text: "Extension unavailable",
      state: "unknown",
    });
  });
});

const domFixture = () => {
  const writes: [string, string, string][] = [];
  const node = (id: string): ExtensionReleaseDomNode => ({
    textContent: "original text",
    title: "original title",
    setAttribute: (name, value) => {
      writes.push([id, name, value]);
    },
  });
  const label = node("extension-version-label");
  const badge = node("extension-version");
  const unrelated = { value: "unsaved input", focused: true, scrollTop: 420 };
  const document: ExtensionReleaseDomDocument = {
    getElementById: (id) =>
      id === "extension-version-label"
        ? label
        : id === "extension-version"
          ? badge
          : null,
  };
  return { document, label, badge, writes, unrelated };
};

const message = () => ({
  type: "extensionReleaseUpdated",
  ...extensionReleasePresentation("0.1.11", checked()),
});

describe("extension release header-only reconciliation", () => {
  it("updates fixed nodes without touching unrelated input, focus or scroll", () => {
    const f = domFixture();
    expect(applyExtensionReleaseUpdate(f.document, message())).toBe(true);
    expect(f.label.textContent).toBe("Extension 0.1.11 → 0.1.12");
    expect(f.badge.title).toBe(message().title);
    expect(f.writes).toEqual([
      ["extension-version", "data-state", "available"],
    ]);
    expect(f.unrelated).toEqual({
      value: "unsaved input",
      focused: true,
      scrollTop: 420,
    });
    expect(f.label.title).toBe("original title");
    expect(f.badge.textContent).toBe("original text");
  });

  it("keeps hostile-looking strings literal rather than interpreting HTML", () => {
    const f = domFixture();
    const text = '<img src="x" onerror="alert(1)">';
    expect(
      applyExtensionReleaseUpdate(f.document, { ...message(), text }),
    ).toBe(true);
    expect(f.label.textContent).toBe(text);
    expect(f.label).not.toHaveProperty("innerHTML");
    expect(f.badge).not.toHaveProperty("innerHTML");
  });

  it.each([
    null,
    [],
    { ...message(), type: "other" },
    { ...message(), text: 42 },
    { ...message(), text: " " },
    { ...message(), text: "a".repeat(257) },
    { ...message(), title: "a".repeat(1025) },
    { ...message(), title: "" },
    { ...message(), title: "unsafe\u0000title" },
    { ...message(), state: "updated" },
    { ...message(), html: "<script>" },
  ])("refuses malformed messages without changing any nodes: %j", (value) => {
    const f = domFixture();
    expect(applyExtensionReleaseUpdate(f.document, value)).toBe(false);
    expect(f.label.textContent).toBe("original text");
    expect(f.badge.title).toBe("original title");
    expect(f.writes).toEqual([]);
  });

  it.each(["extension-version-label", "extension-version"])(
    "does not partially update when %s is absent",
    (missing) => {
      const f = domFixture();
      const document = {
        getElementById: (id: string) =>
          id === missing ? null : f.document.getElementById(id),
      };
      expect(applyExtensionReleaseUpdate(document, message())).toBe(false);
      expect(f.label.textContent).toBe("original text");
      expect(f.badge.title).toBe("original title");
      expect(f.writes).toEqual([]);
    },
  );

  it("runs after serialization without module helpers or host APIs", () => {
    const f = domFixture();
    const script = new Script(
      `(${applyExtensionReleaseUpdate.toString()})(document, message)`,
    );
    expect(
      script.runInNewContext({ document: f.document, message: message() }),
    ).toBe(true);
    expect(f.label.textContent).toBe("Extension 0.1.11 → 0.1.12");
  });
});
