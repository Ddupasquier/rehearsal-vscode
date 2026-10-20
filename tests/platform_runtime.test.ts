import { describe, expect, it } from "vitest";
import {
  canonicalPathMatches,
  infrastructureEnvironment,
  terminalShellFamily,
} from "../src/platform_runtime.js";

describe("bounded platform runtime policy", () => {
  it.each([
    ["/bin/zsh", "darwin", "posix"],
    ["/usr/bin/bash", "linux", "posix"],
    ["/usr/bin/pwsh", "linux", "powershell"],
    ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "win32", "powershell"],
    [
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "win32",
      "powershell",
    ],
    ["C:\\Windows\\System32\\cmd.exe", "win32", null],
    ["/usr/bin/nu", "linux", null],
    [undefined, "win32", null],
    ["", "linux", null],
    [undefined, "linux", "posix"],
  ] as const)(
    "classifies %s on %s without guessing unsafe shell syntax",
    (shell, platform, expected) => {
      expect(terminalShellFamily(shell, platform)).toBe(expected);
    },
  );
  it("keeps Windows infrastructure variables case-insensitively without inheriting credentials", () => {
    expect(
      infrastructureEnvironment(
        {
          Path: "C:\\Node;C:\\Windows\\System32",
          systemroot: "C:\\Windows",
          USERPROFILE: "C:\\Users\\Fixture",
          appdata: "C:\\Users\\Fixture\\AppData\\Roaming",
          TEMP: "C:\\Temp",
          comspec: "C:\\Windows\\System32\\cmd.exe",
          PATHEXT: ".COM;.EXE;.BAT;.CMD",
          DATABASE_URL: "private",
          SUPABASE_SERVICE_ROLE_KEY: "private",
          NPM_TOKEN: "private",
          NODE_OPTIONS: "--require=untrusted",
        },
        "win32",
      ),
    ).toEqual({
      PATH: "C:\\Node;C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\Fixture",
      APPDATA: "C:\\Users\\Fixture\\AppData\\Roaming",
      TEMP: "C:\\Temp",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    });
  });
  it("drops conflicting Windows aliases rather than selecting a different executable path", () => {
    expect(
      infrastructureEnvironment(
        { Path: "first", PATH: "second", path: "third", HOME: "home" },
        "win32",
      ),
    ).toEqual({ HOME: "home" });
    expect(
      infrastructureEnvironment({ Path: "same", PATH: "same" }, "win32"),
    ).toEqual({ PATH: "same" });
  });
  it("preserves POSIX case sensitivity and does not add Windows variables there", () => {
    expect(
      infrastructureEnvironment(
        {
          PATH: "/bin",
          Path: "other",
          HOME: "/home",
          USERPROFILE: "private",
          TEMP: "private",
        },
        "linux",
      ),
    ).toEqual({ PATH: "/bin", HOME: "/home" });
  });
  it("normalizes only the Windows drive letter, not potentially case-sensitive path components", () => {
    expect(
      canonicalPathMatches("C:\\Users\\Fixture", "c:/Users/Fixture", "win32"),
    ).toBe(true);
    expect(
      canonicalPathMatches("C:\\Users\\Fixture", "c:/users/Fixture", "win32"),
    ).toBe(false);
    expect(
      canonicalPathMatches("/Users/Fixture", "/users/Fixture", "darwin"),
    ).toBe(false);
    expect(
      canonicalPathMatches("/project/real", "/project/link", "linux"),
    ).toBe(false);
  });
});
