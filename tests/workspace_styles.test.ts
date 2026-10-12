import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve("media/workspace.css"), "utf8");

describe("Rehearsal workspace responsive styles", () => {
  it("replaces the desktop sidebar with a real compact navigation menu", () => {
    expect(stylesheet).toMatch(
      /@media \(max-width: 1050px\)[\s\S]*?\.compact-nav-trigger \{[\s\S]*?display: flex;/,
    );
    expect(stylesheet).toMatch(
      /@media \(max-width: 1050px\)[\s\S]*?\.primary-nav \{[\s\S]*?display: none;/,
    );
    expect(stylesheet).toMatch(/\.primary-nav--open \{\s*display: grid;\s*\}/);
  });

  it("keeps summary cards readable at the minimum supported width", () => {
    expect(stylesheet).toMatch(
      /@media \(max-width: 380px\)[\s\S]*?\.metrics-grid \{\s*grid-template-columns: 1fr;/,
    );
  });
});
