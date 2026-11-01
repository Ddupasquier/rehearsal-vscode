import { describe, expect, it } from "vitest";
import {
  ENGINE_PREVIEW_STATES,
  enginePreviewState,
  enginePreviewSnapshot,
  enginePreviewBridge,
  parseNativeEngineFixture,
} from "../../scripts/native/engine-lifecycle-fixture.js";
import { engineShutdownAvailable } from "../../src/runtime/engine_lifecycle_view.js";

describe("closed synthetic engine preview", () => {
  it("accepts only named fixture states", () => {
    for (const state of ENGINE_PREVIEW_STATES)
      expect(enginePreviewState(state)).toBe(state);
    for (const state of ["", "running?command=stop", "__proto__", "apply-real"])
      expect(enginePreviewState(state)).toBeUndefined();
  });
  it("keeps shutdown independent of missing configuration and refuses unsupported or stopped profiles", () => {
    expect(engineShutdownAvailable(enginePreviewSnapshot("running"))).toBe(
      true,
    );
    expect(
      engineShutdownAvailable(enginePreviewSnapshot("missing-config")),
    ).toBe(true);
    expect(engineShutdownAvailable(enginePreviewSnapshot("unsupported"))).toBe(
      false,
    );
    expect(
      engineShutdownAvailable(enginePreviewSnapshot("already-stopped")),
    ).toBe(false);
  });
  it("binds native UI input to exact artifacts and rejects extra fields", () => {
    const fixture = {
      schemaVersion: 1,
      kind: "engine-lifecycle-native-fixture",
      coreVersion: "1.4.0-dev.1",
      candidateSha256: "b".repeat(64),
      coreArtifactSha256: "c".repeat(64),
      status:
        enginePreviewSnapshot("running").engineLifecycle!.state === "available"
          ? (
              enginePreviewSnapshot("running").engineLifecycle as {
                state: "available";
                report: unknown;
              }
            ).report
          : null,
    };
    expect(parseNativeEngineFixture(fixture).candidateSha256).toBe(
      fixture.candidateSha256,
    );
    expect(() =>
      parseNativeEngineFixture({ ...fixture, command: "engine stop" }),
    ).toThrow();
    expect(() =>
      parseNativeEngineFixture({ ...fixture, candidateSha256: "short" }),
    ).toThrow();
    expect(() =>
      parseNativeEngineFixture({ ...fixture, status: {} }),
    ).toThrow();
  });
  it("labels the bridge as synthetic and patches the production closed state without a host operation", () => {
    for (const state of ENGINE_PREVIEW_STATES) {
      const bridge = enginePreviewBridge(state);
      expect(bridge).toContain("UI fixture only");
      expect(bridge).toContain('"type":"engineShutdownUpdated"');
      expect(bridge).toContain("Object.keys(message).length !== 1");
      expect(bridge).not.toContain("confirm-engine-stop");
      expect(bridge).not.toContain("fetch(");
    }
  });
});
