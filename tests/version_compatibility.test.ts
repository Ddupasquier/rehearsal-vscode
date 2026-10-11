import { describe, expect, it } from "vitest";
import {
  coreCompatibilityFor,
  MINIMUM_REHEARSAL_CORE_VERSION,
} from "../src/version_compatibility.js";

describe("Rehearsal core compatibility", () => {
  it.each(["0.1.0-rc.4", "0.1.0", "0.1.1", "0.2.0-beta.1"])(
    "accepts %s",
    (version) => {
      expect(coreCompatibilityFor(version)).toEqual({
        state: "supported",
        installedVersion: version,
        minimumVersion: MINIMUM_REHEARSAL_CORE_VERSION,
      });
    },
  );

  it.each(["0.1.0-beta.18", "0.1.0-rc.1", "0.1.0-rc.2", "0.1.0-rc.3", "0.0.9"])(
    "requires an update for %s",
    (version) => {
      expect(coreCompatibilityFor(version).state).toBe("outdated");
    },
  );

  it("fails closed for a non-semantic package version", () => {
    expect(coreCompatibilityFor("workspace:*").state).toBe("invalid");
  });
});
