import { afterEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  inspect: vi.fn(),
  update: vi.fn(async () => {}),
  get: vi.fn(),
}));
const getConfiguration = vi.hoisted(() => vi.fn(() => settings));
vi.mock("vscode", () => ({
  workspace: { getConfiguration },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}));

import {
  AUTOMATIC_UPDATES_SETTING,
  parseAutomaticUpdateSettings,
  readAutomaticUpdateSettings,
  saveAutomaticUpdateSettings,
} from "../src/automatic_update_settings.js";

afterEach(() => {
  settings.inspect.mockReset();
  settings.update.mockReset().mockResolvedValue(undefined);
  vi.clearAllMocks();
});

describe("user-owned automatic update settings", () => {
  it("defaults both independent permissions off and does not read a merged workspace setting", () => {
    settings.inspect.mockReturnValue(undefined);
    settings.get.mockReturnValue({ extension: true, cli: true });
    expect(readAutomaticUpdateSettings()).toEqual({
      extension: false,
      cli: false,
    });
    expect(getConfiguration).toHaveBeenCalledWith("rehearsal");
    expect(settings.inspect).toHaveBeenCalledWith(AUTOMATIC_UPDATES_SETTING);
    expect(settings.get).not.toHaveBeenCalled();
  });
  it("ignores project, folder, language and default overrides as installation authority", () => {
    settings.inspect.mockReturnValue({
      globalValue: undefined,
      defaultValue: { extension: true, cli: true },
      workspaceValue: { extension: true, cli: true },
      workspaceFolderValue: { extension: true, cli: true },
      globalLanguageValue: { extension: true, cli: true },
      workspaceLanguageValue: { extension: true, cli: true },
    });
    expect(readAutomaticUpdateSettings()).toEqual({
      extension: false,
      cli: false,
    });
    settings.inspect.mockReturnValue({
      globalValue: { extension: false, cli: true },
      workspaceValue: { extension: true, cli: false },
    });
    expect(readAutomaticUpdateSettings()).toEqual({
      extension: false,
      cli: true,
    });
  });
  it.each([
    [
      { extension: true, cli: false },
      { extension: true, cli: false },
    ],
    [
      { extension: false, cli: true },
      { extension: false, cli: true },
    ],
    [{ extension: true }, { extension: true, cli: false }],
    [{ cli: true }, { extension: false, cli: true }],
    [{}, { extension: false, cli: false }],
  ])(
    "keeps explicitly selected flags independent for %j",
    (value, expected) => {
      expect(parseAutomaticUpdateSettings(value)).toEqual(expected);
      settings.inspect.mockReturnValue({ globalValue: value });
      expect(readAutomaticUpdateSettings()).toEqual(expected);
    },
  );
  it.each([
    null,
    undefined,
    [],
    true,
    "true",
    { extension: "true", cli: true },
    { extension: true, cli: 1 },
    { extension: true, cli: true, unknown: true },
  ])("fails closed on malformed consent %j", (value) => {
    expect(parseAutomaticUpdateSettings(value)).toEqual({
      extension: false,
      cli: false,
    });
  });
  it("does not treat inherited prototype flags as explicit owner consent", () => {
    expect(
      parseAutomaticUpdateSettings(
        Object.create({ extension: true, cli: true }),
      ),
    ).toEqual({ extension: false, cli: false });
  });
  it("writes only machine-local VS Code user configuration at Global scope", async () => {
    await saveAutomaticUpdateSettings({ extension: true, cli: false });
    expect(settings.update).toHaveBeenCalledExactlyOnceWith(
      AUTOMATIC_UPDATES_SETTING,
      { extension: true, cli: false },
      1,
    );
    expect(getConfiguration).toHaveBeenCalledWith("rehearsal");
    expect(settings.inspect).not.toHaveBeenCalled();
  });
  it("never falls back to a repository setting when the user configuration write fails", async () => {
    settings.update.mockRejectedValueOnce(
      new Error("User configuration unavailable"),
    );
    await expect(
      saveAutomaticUpdateSettings({ extension: false, cli: true }),
    ).rejects.toThrow("User configuration unavailable");
    expect(settings.update).toHaveBeenCalledTimes(1);
  });
});
