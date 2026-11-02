import { beforeEach, describe, expect, it, vi } from "vitest";

const editor = vi.hoisted(() => ({
  lookup: vi.fn(),
  warning: vi.fn(),
  execute: vi.fn(),
  register: vi.fn(),
  provider: vi.fn(),
  panels: vi.fn(),
  actions: vi.fn(),
  reviews: vi.fn(),
  advisory: vi.fn(),
}));
vi.mock("vscode", () => ({
  extensions: { getExtension: editor.lookup },
  window: { showWarningMessage: editor.warning },
  commands: {
    executeCommand: editor.execute,
    registerCommand: editor.register,
  },
}));
vi.mock("../../src/workspace/tree_provider.js", () => ({
  RehearsalTreeProvider: editor.provider,
}));
vi.mock("../../src/workspace/workspace_panel.js", () => ({
  RehearsalWorkspacePanels: editor.panels,
}));
vi.mock("../../src/workspace/workspace_actions.js", () => ({
  RehearsalWorkspaceActions: editor.actions,
}));
vi.mock("../../src/review/review_panel.js", () => ({
  RehearsalReviewPanels: editor.reviews,
}));
vi.mock("../../src/updates/update_advisory_host.js", () => ({
  createUpdateAdvisory: editor.advisory,
}));

import { activate } from "../../src/extension.js";
import { LEGACY_EXTENSION_ID } from "../../src/updates/extension_identity.js";

beforeEach(() => {
  vi.clearAllMocks();
  editor.warning.mockResolvedValue(undefined);
});

describe("canonical activation with legacy installed", () => {
  it.each([true, false])(
    "refuses a registry-reported legacy copy even when isActive is %s",
    (isActive) => {
      editor.lookup.mockReturnValue({ id: LEGACY_EXTENSION_ID, isActive });
      activate({} as Parameters<typeof activate>[0]);
      expect(editor.lookup).toHaveBeenCalledWith(LEGACY_EXTENSION_ID);
      for (const work of [
        editor.provider,
        editor.panels,
        editor.actions,
        editor.reviews,
        editor.advisory,
        editor.register,
      ])
        expect(work).not.toHaveBeenCalled();
      expect(editor.warning).toHaveBeenCalledWith(
        expect.stringContaining("Finish any active commands"),
        "Open Extensions",
      );
      expect(editor.execute).not.toHaveBeenCalled();
    },
  );

  it("only opens the user's extension search, without uninstalling or disabling", async () => {
    editor.lookup.mockReturnValue({ id: LEGACY_EXTENSION_ID, isActive: true });
    editor.warning.mockResolvedValue("Open Extensions");
    activate({} as Parameters<typeof activate>[0]);
    await Promise.resolve();
    expect(editor.execute).toHaveBeenCalledExactlyOnceWith(
      "workbench.extensions.search",
      `@id:${LEGACY_EXTENSION_ID}`,
    );
  });
});
