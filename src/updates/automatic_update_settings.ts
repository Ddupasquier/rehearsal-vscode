import * as vscode from "vscode";

export interface AutomaticUpdateSettings {
  readonly extension: boolean;
  readonly cli: boolean;
}

export const AUTOMATIC_UPDATES_SETTING = "automaticUpdates";

export const parseAutomaticUpdateSettings = (
  value: unknown,
): AutomaticUpdateSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { extension: false, cli: false };
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).some((key) => !["extension", "cli"].includes(key)) ||
    (candidate.extension !== undefined &&
      typeof candidate.extension !== "boolean") ||
    (candidate.cli !== undefined && typeof candidate.cli !== "boolean")
  )
    return { extension: false, cli: false };
  return {
    extension:
      Object.hasOwn(candidate, "extension") && candidate.extension === true,
    cli: Object.hasOwn(candidate, "cli") && candidate.cli === true,
  };
};

/** Only explicit user settings authorize installation; repository overrides cannot. */
export const readAutomaticUpdateSettings = (): AutomaticUpdateSettings =>
  parseAutomaticUpdateSettings(
    vscode.workspace
      .getConfiguration("rehearsal")
      .inspect<unknown>(AUTOMATIC_UPDATES_SETTING)?.globalValue,
  );

export const saveAutomaticUpdateSettings = async (
  value: AutomaticUpdateSettings,
): Promise<void> => {
  await vscode.workspace
    .getConfiguration("rehearsal")
    .update(
      AUTOMATIC_UPDATES_SETTING,
      parseAutomaticUpdateSettings(value),
      vscode.ConfigurationTarget.Global,
    );
};
