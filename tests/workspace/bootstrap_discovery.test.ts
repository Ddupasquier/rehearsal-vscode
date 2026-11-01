import { describe, expect, it } from "vitest";
import {
  bootstrapProjectDiscovery,
  type WorkspaceEntryKind,
} from "../../src/workspace/bootstrap_discovery.js";

const reader = (files: Record<string, string | null>) => ({
  workspaceName: "Example App",
  async kind(path: string): Promise<WorkspaceEntryKind> {
    if (!(path in files)) return null;
    return files[path] === null ? "directory" : "file";
  },
  async readText(path: string): Promise<string | null> {
    const value = files[path];
    return typeof value === "string" ? value : null;
  },
});

describe("pre-install bootstrap discovery", () => {
  it("uses only bounded workspace metadata and never exposes script bodies", async () => {
    const result = await bootstrapProjectDiscovery(
      reader({
        "package.json": JSON.stringify({
          name: "profile-app",
          scripts: {
            dev: "vite --token private-script-value",
            test: "vitest run",
          },
          devDependencies: { vite: "7.0.0" },
        }),
        "package-lock.json": "{}",
        "database/migrations": null,
      }),
    );

    expect(result.project.name).toBe("profile-app");
    expect(result.detected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "package.manager", value: "npm" }),
        expect.objectContaining({
          id: "database.migrationDirectories",
          value: ["database/migrations"],
        }),
      ]),
    );
    expect(result.suggested).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "application.startCommand",
          value: "npm run dev",
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("private-script-value");
    expect(result.safety).toEqual({
      projectCodeExecuted: false,
      environmentFilesRead: false,
      databaseContacted: false,
      containerEngineStarted: false,
    });
  });

  it("leaves competing config and package-manager choices unresolved", async () => {
    const result = await bootstrapProjectDiscovery(
      reader({
        "package.json": "{}",
        "package-lock.json": "{}",
        "pnpm-lock.yaml": "lockfileVersion: 9",
        "rehearsal.config.mjs": "export default {}",
        "infrastructure/rehearsal/rehearsal.config.mjs": "export default {}",
      }),
    );

    expect(result.configuration.state).toBe("ambiguous");
    expect(result.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "package.manager" }),
      ]),
    );
  });
});
