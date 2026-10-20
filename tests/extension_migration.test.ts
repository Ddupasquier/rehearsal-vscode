import { describe, expect, it, vi } from "vitest";
import { createLegacyExtensionGuard } from "../src/extension_migration.js";

describe("legacy extension migration guard", () => {
  it("permits a clean canonical installation without any migration action", () => {
    const notify = vi.fn();
    const allowed = createLegacyExtensionGuard(() => false, notify);
    expect(allowed()).toBe(true);
    expect(allowed()).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("blocks known legacy presence and notifies only once", () => {
    const notify = vi.fn();
    const allowed = createLegacyExtensionGuard(() => true, notify);
    expect(allowed()).toBe(false);
    expect(allowed()).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
  });

  it("blocks newly arriving legacy copies without interrupting earlier work", () => {
    let legacy = false;
    const notify = vi.fn();
    const allowed = createLegacyExtensionGuard(() => legacy, notify);
    expect(allowed()).toBe(true);
    legacy = true;
    expect(allowed()).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
    legacy = false;
    expect(allowed()).toBe(false);
    // A reload creates a fresh guard only after the legacy copy is gone.
    expect(createLegacyExtensionGuard(() => legacy, notify)()).toBe(true);
  });
});
