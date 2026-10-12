import { describe, expect, it } from "vitest";
import { AutomaticDashboardController } from "../src/automatic_dashboard.js";

const request = (
  overrides: Partial<
    Parameters<AutomaticDashboardController["choose"]>[0]
  > = {},
) => ({
  enabled: true,
  trusted: true,
  workspaceKeys: ["file:///workspace/project"],
  updatedWorkspaceKey: "file:///workspace/project",
  ...overrides,
});

describe("AutomaticDashboardController", () => {
  it("opens one trusted single-folder dashboard once per host session", () => {
    const controller = new AutomaticDashboardController();

    expect(controller.choose(request())).toBe("file:///workspace/project");
    expect(controller.choose(request())).toBeUndefined();
  });

  it("respects disabled automatic opening and can open after it is enabled", () => {
    const controller = new AutomaticDashboardController();

    expect(controller.choose(request({ enabled: false }))).toBeUndefined();
    expect(controller.choose(request())).toBe("file:///workspace/project");
  });

  it("waits for workspace trust without consuming the one-time opening", () => {
    const controller = new AutomaticDashboardController();

    expect(controller.choose(request({ trusted: false }))).toBeUndefined();
    expect(controller.choose(request())).toBe("file:///workspace/project");
  });

  it("does not guess which project to open in a multi-root workspace", () => {
    const controller = new AutomaticDashboardController();

    expect(
      controller.choose(
        request({
          workspaceKeys: [
            "file:///workspace/primary",
            "file:///workspace/publication",
          ],
          updatedWorkspaceKey: "file:///workspace/primary",
        }),
      ),
    ).toBeUndefined();
  });

  it("ignores a snapshot that does not belong to the only open folder", () => {
    const controller = new AutomaticDashboardController();

    expect(
      controller.choose(
        request({ updatedWorkspaceKey: "file:///workspace/removed" }),
      ),
    ).toBeUndefined();
  });
});
