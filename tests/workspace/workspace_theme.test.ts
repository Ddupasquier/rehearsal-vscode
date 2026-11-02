import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  previewThemeOverrides,
  WORKSPACE_PREVIEW_THEMES,
} from "../../scripts/preview/preview-themes.js";

const stylesheet = readFileSync(resolve("media/workspace.css"), "utf8");
const definitions = new Map(
  [...stylesheet.matchAll(/(--rh-[a-z-]+):\s*([^;]+);/gu)].map((match) => [
    match[1]!,
    match[2]!.trim(),
  ]),
);
type Color = readonly number[];
type Theme = Readonly<Record<string, string>>;
const hex = (value: string): Color => {
  if (!/^#[a-f0-9]{6}$/iu.test(value))
    throw new Error(`Expected an opaque RGB fixture color: ${value}`);
  return [1, 3, 5].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  );
};
const mix = (first: Color, second: Color, share: number): Color =>
  first.map((value, index) => value * share + second[index]! * (1 - share));
const luminance = (color: Color): number =>
  color
    .map((value) => value / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
    .reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!,
      0,
    );
const contrast = (first: Color, second: Color): number => {
  const values = [luminance(first), luminance(second)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
};

/** Evaluate the actual text-token declarations, not a disconnected copy of their mix. */
const colorValue = (source: string, theme: Theme, depth = 0): Color => {
  if (depth > 8) throw new Error("Unexpected recursive theme token.");
  if (source.startsWith("#")) return hex(source);
  const variable = /^var\((--[\w-]+)(?:,\s*(#[a-f\d]{6}))?\)$/iu.exec(source);
  if (variable) {
    const name = variable[1]!;
    const value = theme[name] ?? definitions.get(name) ?? variable[2];
    if (!value) throw new Error(`Missing fixture token ${name}.`);
    return colorValue(value, theme, depth + 1);
  }
  const blended =
    /^color-mix\(\s*in srgb,\s*(var\([^)]+\))\s*(\d+)%,\s*(var\([^)]+\))\s*(\d+)%\s*\)$/u.exec(
      source,
    );
  if (!blended)
    throw new Error(`Unsupported text-token declaration: ${source}`);
  const share = Number(blended[2]) / 100;
  expect(Number(blended[2]) + Number(blended[4])).toBe(100);
  return mix(
    colorValue(blended[1]!, theme, depth + 1),
    colorValue(blended[3]!, theme, depth + 1),
    share,
  );
};
const textTokens = [
  "--rh-accent-strong",
  "--rh-blue-text",
  "--rh-yellow-text",
  "--rh-error-text",
] as const;
const missingCharts: Record<string, string> = {
  ...WORKSPACE_PREVIEW_THEMES.light,
};
for (const key of Object.keys(missingCharts))
  if (key.startsWith("--vscode-charts-")) delete missingCharts[key];
const fixtures: readonly (readonly [string, Theme])[] = [
  ...Object.entries(WORKSPACE_PREVIEW_THEMES),
  ["light without chart tokens", missingCharts],
  [
    "branded dark fallback",
    {
      "--vscode-editor-background": "#0b1217",
      "--vscode-editor-foreground": "#e8eef1",
      "--vscode-editorWidget-background": "#152129",
      "--vscode-sideBar-background": "#10191f",
    },
  ],
];

describe("small semantic text contrast", () => {
  it.each(fixtures)(
    "keeps %s labels at AA contrast across modeled surfaces",
    (_name, theme) => {
      const editor = hex(theme["--vscode-editor-background"]!);
      const surface = hex(theme["--vscode-editorWidget-background"]!);
      const soft = mix(surface, editor, 0.66);
      const sidebar = mix(
        hex(theme["--vscode-sideBar-background"]!),
        hex("#000000"),
        0.92,
      );
      const accents = ["--rh-accent", "--rh-blue", "--rh-yellow"].map((name) =>
        colorValue(definitions.get(name)!, theme),
      );
      const backgrounds = [
        editor,
        surface,
        soft,
        sidebar,
        // Active navigation layers a 14% glyph fill over a 12% selected row.
        mix(accents[0]!, mix(accents[0]!, sidebar, 0.12), 0.14),
        // Warning icons layer 13% over their 9% banner tint.
        mix(accents[2]!, mix(accents[2]!, soft, 0.09), 0.13),
        ...accents.map((accent) => mix(accent, soft, 0.12)),
      ];
      for (const name of textTokens) {
        const foreground = colorValue(definitions.get(name)!, theme);
        for (const background of backgrounds)
          expect(
            contrast(foreground, background),
            `${name} in ${_name}`,
          ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it("keeps chart/status/focus signals separate from text-only colors", () => {
    expect(definitions.get("--rh-accent")).toBe(
      "var(--vscode-charts-green, #55d6a5)",
    );
    for (const name of textTokens)
      expect(definitions.get(name)).toMatch(
        /var\(--vscode-editor-foreground, #e8eef1\) 75%/u,
      );
    expect(stylesheet).not.toMatch(
      /^\s*color:\s*var\(--(?:rh-(?:blue|yellow)|profile-color)\);/mu,
    );
    expect(stylesheet).toContain(
      "outline: 2px solid var(--vscode-focusBorder, var(--rh-blue))",
    );
    expect(stylesheet).toContain("--profile-text: var(--rh-yellow-text)");
    expect(stylesheet).toContain("background: var(--rh-accent)");
  });

  it("previews explicit Light Modern chart tokens instead of dark mint fallbacks", () => {
    const light = previewThemeOverrides("light");
    expect(light).toContain("--vscode-editor-foreground: #3b3b3b");
    expect(light).toContain("--vscode-charts-green: #388a34");
    expect(light).toContain("--vscode-charts-blue: #0063d3");
    expect(light).toContain("--vscode-charts-yellow: #bf8803");
    expect(previewThemeOverrides("unrecognized")).toBe("");
    expect(previewThemeOverrides(null)).toBe("");
  });
});
