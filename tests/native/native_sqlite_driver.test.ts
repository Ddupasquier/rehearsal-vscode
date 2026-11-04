import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

describe("native SQLite driver allowlist", () => {
  it.each(["sqlite-review", "./arbitrary.cjs"])(
    "dispatches only an explicitly owned scenario: %s",
    async (scenario) => {
      const nativeRequire = createRequire(__filename);
      let invoked = 0;
      const commands: string[] = [];
      const config = {
        root: "/owned",
        evidence: "/owned/evidence",
        resultPath: "/owned/evidence/result.json",
        scenario,
      };
      const result = { status: "passed", scenario };
      const exports: { activate?: (context: unknown) => void } = {};
      const contents = (path: string) =>
        Buffer.from(
          JSON.stringify(path === "/owned/config.json" ? config : result),
        );
      runInNewContext(
        await readFile(
          resolve(__dirname, "../../scripts/native/native-editor-driver.cjs"),
          "utf8",
        ),
        {
          exports,
          Buffer,
          process: {
            env: { REHEARSAL_NATIVE_CANCELLATION_CONFIG: "/owned/config.json" },
          },
          require: (name: string) => {
            if (name === "vscode")
              return {
                workspace: { textDocuments: [] },
                commands: {
                  executeCommand: async (command: string) => {
                    commands.push(command);
                  },
                },
              };
            if (name === "node:fs/promises")
              return {
                open: async (path: string) => {
                  const bytes = contents(path);
                  let offset = 0;
                  return {
                    stat: async () => ({
                      isFile: () => true,
                      size: bytes.length,
                      mtimeMs: 1,
                    }),
                    read: async (
                      destination: Buffer,
                      start: number,
                      length: number,
                    ) => {
                      const count = bytes.copy(
                        destination,
                        start,
                        offset,
                        offset + length,
                      );
                      offset += count;
                      return { bytesRead: count };
                    },
                    close: async () => {},
                  };
                },
                writeFile: async () => {},
                rename: async () => {},
              };
            if (name === "./native-editor-recovery.cjs")
              return nativeRequire(
                "../../scripts/native/native-editor-recovery.cjs",
              );
            if (name === "./native-sqlite-test.cjs")
              return {
                run: async () => {
                  invoked++;
                },
              };
            if (name.startsWith("./"))
              throw Error("An unrelated scenario was dispatched.");
            return nativeRequire(name);
          },
        },
      );
      exports.activate!({});
      if (scenario === "sqlite-review") {
        await vi.waitFor(() =>
          expect(commands).toContain("workbench.action.closeWindow"),
        );
        expect(invoked).toBe(1);
      } else {
        await new Promise((resolve) => setImmediate(resolve));
        expect(invoked).toBe(0);
        expect(commands).toEqual([]);
      }
    },
  );
});
