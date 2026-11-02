export const MINIMUM_REHEARSAL_CORE_VERSION = "0.1.0-rc.4";

interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (number | string)[];
}

export interface CoreCompatibility {
  readonly state: "supported" | "outdated" | "invalid";
  readonly installedVersion: string;
  readonly minimumVersion: string;
}

const parseIdentifier = (value: string): number | string =>
  /^\d+$/u.test(value) ? Number(value) : value;

const parseSemanticVersion = (value: string): SemanticVersion | null => {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(
      value,
    );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".").map(parseIdentifier) ?? [],
  };
};

const comparePrerelease = (
  left: readonly (number | string)[],
  right: readonly (number | string)[],
): number => {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) return 0;
    return left.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "number") {
      return leftPart < rightPart ? -1 : 1;
    }
    if (typeof leftPart === "number") return -1;
    if (typeof rightPart === "number") return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
};

const compareVersions = (
  left: SemanticVersion,
  right: SemanticVersion,
): number => {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
};

export const coreCompatibilityFor = (version: string): CoreCompatibility => {
  const installed = parseSemanticVersion(version);
  const minimum = parseSemanticVersion(MINIMUM_REHEARSAL_CORE_VERSION);
  if (!installed || !minimum) {
    return {
      state: "invalid",
      installedVersion: version,
      minimumVersion: MINIMUM_REHEARSAL_CORE_VERSION,
    };
  }
  return {
    state: compareVersions(installed, minimum) >= 0 ? "supported" : "outdated",
    installedVersion: version,
    minimumVersion: MINIMUM_REHEARSAL_CORE_VERSION,
  };
};
