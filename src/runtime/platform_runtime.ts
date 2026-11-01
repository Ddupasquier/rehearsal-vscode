import { isAbsolute, win32 } from "node:path";

const storageKeys = [
  "TMPDIR",
  "TMP",
  "TEMP",
  "NODE_COMPILE_CACHE",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_LOGS_DIR",
  "REHEARSAL_USER_STATE_DIRECTORY",
] as const;

/** Storage overrides only: never inherit npm auth/config files or Node preload options. */
export const storageEnvironment = (
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  const result: NodeJS.ProcessEnv = {};
  for (const key of storageKeys) {
    const values = Object.entries(source)
      .filter(
        ([name, value]) =>
          value !== undefined &&
          (platform === "win32" || key.startsWith("NPM_CONFIG_")
            ? name.toUpperCase() === key
            : name === key),
      )
      .map(([, value]) => value!);
    const value = values[0];
    if (values.length === 0) continue;
    if (
      !value ||
      values.some((entry) => entry !== value) ||
      /[\0\r\n]/u.test(value)
    )
      throw new Error(
        "Conflicting or invalid storage overrides; child launch refused.",
      );
    if (!(platform === "win32" ? win32.isAbsolute(value) : isAbsolute(value)))
      throw new Error(
        "Storage overrides must be absolute paths; child launch refused.",
      );
    result[key] = value;
  }
  return result;
};

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
  return { ...environment, ...storageEnvironment(source, platform) };
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
