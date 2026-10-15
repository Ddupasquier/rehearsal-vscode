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

  it("uses actual page width before enabling paired content cards", () => {
    expect(stylesheet).toMatch(
      /\.workspace-page \{[^}]*container: workspace-page \/ inline-size;/,
    );
    expect(stylesheet).toMatch(
      /@container workspace-page \(min-width: 780px\) \{\s*\.overview-heading,\s*\.overview-grid,\s*\.two-column \{\s*grid-template-columns: minmax\(0, 1\.2fr\) minmax\(320px, 0\.8fr\);/,
    );
    expect(stylesheet).not.toContain("minmax(260px, 0.55fr)");
  });

  it("sizes migration filters from their card instead of fixed minimum tracks", () => {
    expect(stylesheet).toMatch(
      /\.surface \{[^}]*container: surface \/ inline-size;/,
    );
    expect(stylesheet).toMatch(
      /@container surface \(min-width: 340px\) \{\s*\.workbench-toolbar \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(stylesheet).toMatch(
      /@container surface \(min-width: 640px\) \{\s*\.workbench-toolbar \{\s*grid-template-columns: minmax\(0, 1\.3fr\) repeat\(3, minmax\(0, 1fr\)\);/,
    );
    expect(stylesheet).not.toContain("repeat(3, minmax(110px, 0.35fr))");
  });

  it("lets native inputs shrink and gives narrow connection fields a full row", () => {
    expect(stylesheet).toMatch(
      /input,\s*select \{\s*width: 100%;\s*min-width: 0;\s*max-width: 100%;/,
    );
    expect(stylesheet).toMatch(
      /@container surface \(max-width: 420px\)[\s\S]*?\.endpoint-editor,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(stylesheet).toMatch(
      /@container surface \(max-width: 420px\)[\s\S]*?\.facts-list dd,[\s\S]*?text-align: left;/,
    );
  });

  it("keeps structured settings and technical evidence consistently spaced", () => {
    expect(stylesheet).toMatch(
      /\.configuration-controls \{\s*display: grid;\s*gap: 16px;/,
    );
    expect(stylesheet).toMatch(
      /\.technical-details \{\s*margin-top: 18px;\s*padding-top: 14px;/,
    );
    expect(stylesheet).toMatch(
      /\.detail-list dd \{\s*min-width: 0;\s*margin: 0;/,
    );
    expect(stylesheet).toMatch(/\.activity-history li \{[^}]*flex-wrap: wrap;/);
  });
});
