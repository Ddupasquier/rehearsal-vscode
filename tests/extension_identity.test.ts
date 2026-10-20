import { describe, expect, it } from "vitest";
import {
  EXTENSION_ID,
  EXTENSION_NAME,
  EXTENSION_PUBLISHER,
  LEGACY_EXTENSION_ID,
  extensionArtifactFilename,
} from "../src/extension_identity.js";

describe("canonical Marketplace identity", () => {
  it("keeps the approved publisher and distinguishes the immutable legacy identity", () => {
    expect(EXTENSION_PUBLISHER).toBe("rehearsal-db");
    expect(EXTENSION_NAME).toBe("rehearsal-db");
    expect(EXTENSION_ID).toBe("rehearsal-db.rehearsal-db");
    expect(LEGACY_EXTENSION_ID).toBe("rehearsal-db.rehearsal");
    expect(EXTENSION_ID).not.toBe(LEGACY_EXTENSION_ID);
  });

  it.each(["0.1.19", "0.1.20", "1.0.0", "1.0.0-rc.1"])(
    "uses a distinct asset family for already-validated version %s",
    (version) => {
      expect(extensionArtifactFilename(version)).toBe(
        `rehearsal-db-${version}.vsix`,
      );
      expect(extensionArtifactFilename(version)).not.toBe(
        `rehearsal-${version}.vsix`,
      );
    },
  );
});
