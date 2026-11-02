import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { commercialReadinessFailures } from "../../scripts/verification/verify-commercial-readiness.js";

const root = resolve(__dirname, "../..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as Record<string, unknown>;
const contents = new Map<string, string>(
  [
    "LICENSE",
    "PRIVACY.md",
    "SECURITY.md",
    "SUPPORT.md",
    "CHANGELOG.md",
    "README.md",
  ].map((filename): [string, string] => [
    filename,
    readFileSync(resolve(root, filename), "utf8"),
  ]),
);

describe("Starter distribution metadata", () => {
  it("accepts current free Starter documents without paid activation or checkout proof", () => {
    expect(commercialReadinessFailures({ manifest, contents })).toEqual([]);
    expect(manifest.pricing).toBe("Free");
    expect(contents.get("LICENSE")).toContain(
      "All features included in a version",
    );
    expect(contents.get("LICENSE")).toContain(
      "do not reduce the rights granted",
    );
    expect(contents.get("LICENSE")).toContain(
      "Rights and support already granted",
    );
    expect(contents.get("LICENSE")).toContain(
      "trial period, or license activation is required",
    );
    expect(contents.get("LICENSE")).toContain(
      "Rehearsal core is separate software",
    );
  });

  it("rejects timed-trial metadata for Starter", () => {
    expect(
      commercialReadinessFailures({
        manifest: { ...manifest, pricing: "Trial" },
        contents,
      }),
    ).toContain("Starter pricing metadata must be Free");
  });

  it.each([
    [
      "Starter License",
      "Commercial Preview License",
      "Starter license is missing",
    ],
    [
      "indefinitely at no charge",
      "for 14 days",
      "Starter license does not grant indefinite no-charge use",
    ],
    [
      "personal or commercial development",
      "noncommercial development",
      "Starter license does not cover commercial development",
    ],
  ])("rejects a contradictory grant: %s", (before, after, expected) => {
    const changed = new Map(contents);
    changed.set("LICENSE", changed.get("LICENSE")!.replace(before, after));
    expect(
      commercialReadinessFailures({ manifest, contents: changed }),
    ).toContain(expected);
  });

  it("refuses reintroducing a timed evaluation alongside the free grant", () => {
    const changed = new Map(contents);
    changed.set(
      "LICENSE",
      `${changed.get("LICENSE")}\nEvaluate for 14 days.\n`,
    );
    expect(
      commercialReadinessFailures({ manifest, contents: changed }),
    ).toContain(
      "Starter license must not impose the previous evaluation period",
    );
  });

  it("requires README and support wording consistent with indefinite free use", () => {
    const changed = new Map(contents);
    changed.set("README.md", "This preview defines a 14-day evaluation.");
    changed.set("SUPPORT.md", "Purchase required for support.");
    expect(
      commercialReadinessFailures({ manifest, contents: changed }),
    ).toEqual(
      expect.arrayContaining([
        "README does not explain indefinite free Starter use",
        "best-effort Starter support boundary is missing",
      ]),
    );
  });

  it("retains existing privacy and document-access checks", () => {
    const changed = new Map(contents);
    changed.set("PRIVACY.md", "Privacy statement unavailable.");
    expect(
      commercialReadinessFailures({
        manifest: { ...manifest, contributes: { commands: [] } },
        contents: changed,
      }),
    ).toEqual(
      expect.arrayContaining([
        "privacy statement does not explicitly reject telemetry",
        "missing command rehearsal.openPrivacy",
        "missing command rehearsal.openSupport",
        "missing command rehearsal.openLicense",
      ]),
    );
  });
});
