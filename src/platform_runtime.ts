import { win32 } from "node:path";

export type TerminalShellFamily = "posix" | "powershell";

/** Unknown shells never receive compatibility-mode command text. */
export const terminalShellFamily = (
  shellPath: string | undefined,
  platform: NodeJS.Platform = process.platform,
): TerminalShellFamily | null => {
  if (shellPath === "") return null;
  if (shellPath === undefined) return platform === "win32" ? null : "posix";
  const name = shellPath.split(/[\\/]/u).at(-1)?.toLowerCase();
  if (name === "pwsh" || name === "pwsh.exe" || name === "powershell.exe")
    return "powershell";
  return /^(?:sh|bash|zsh|dash|ksh)(?:\.exe)?$/u.test(name ?? "")
    ? "posix"
    : null;
};

const infrastructureKeys = [
  "COLIMA_HOME",
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "USER",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
];
const windowsKeys = [
  "SystemRoot",
  "SystemDrive",
  "USERPROFILE",
  "USERNAME",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "ComSpec",
  "PATHEXT",
];

/** Windows keys are case-insensitive; conflicting aliases fail closed. */
export const infrastructureEnvironment = (
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  const windows = platform === "win32";
  const keyFor = (key: string) => (windows ? key.toUpperCase() : key);
  const allowed = new Map(
    [...infrastructureKeys, ...(windows ? windowsKeys : [])].map((key) => [
      keyFor(key),
      key,
    ]),
  );
  const environment: NodeJS.ProcessEnv = {};
  const conflicts = new Set<string>();
  for (const [key, value] of Object.entries(source)) {
    const canonical = allowed.get(keyFor(key));
    if (!canonical || value === undefined || conflicts.has(canonical)) continue;
    if (
      environment[canonical] !== undefined &&
      environment[canonical] !== value
    ) {
      delete environment[canonical];
      conflicts.add(canonical);
    } else environment[canonical] = value;
  }
  return environment;
};

/** Only a Windows drive letter is intrinsically case-insensitive. */
export const canonicalPathMatches = (
  canonical: string,
  declared: string,
  platform: NodeJS.Platform = process.platform,
): boolean => {
  const normalized = (path: string) =>
    platform === "win32"
      ? win32
          .normalize(path)
          .replace(/^[a-z]:/u, (drive) => drive.toUpperCase())
      : path;
  return normalized(canonical) === normalized(declared);
};
