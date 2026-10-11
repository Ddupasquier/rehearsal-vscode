import { describe, expect, it } from "vitest";
import {
  applyConfigurationProposal,
  parseConfigurationProposal,
} from "../src/configuration_editor.js";

const source = `export default {
  application: {
    startCommand: "npm run dev",
    proofCommand: "npm test",
    readiness: { url: "http://localhost:5175", expectedStatus: 200 },
  },
  runtime: { applicationUrl: "http://localhost:5175", databasePort: 5432 },
  lifecycle: { run: "keep-until-stop", open: "keep-until-stop" },
  cleanup: { retainBaselineGenerations: 2 },
};
`;

describe("configuration proposals", () => {
  it("validates and applies supported literals as one reviewed patch", () => {
    const proposal = parseConfigurationProposal({
      applicationUrl: "http://127.0.0.1:6000/app",
      startCommand: "npm run rehearsal:dev",
      proofCommand: "npm run rehearsal:test",
      runPersistence: "stop-after-run",
      openPersistence: "stop-on-application-exit",
      retainBaselineGenerations: "4",
    });
    const result = applyConfigurationProposal({ source, proposal });
    expect(result.changedFields).toEqual([
      "runtime.applicationUrl",
      "application.startCommand",
      "application.proofCommand",
      "lifecycle.run",
      "lifecycle.open",
      "cleanup.retainBaselineGenerations",
      "application.readiness.url",
    ]);
    expect(result.source).toContain(
      'applicationUrl: "http://127.0.0.1:6000/app"',
    );
    expect(result.source).toContain('url: "http://127.0.0.1:6000/app"');
    expect(result.source).toContain("retainBaselineGenerations: 4");
  });

  it("rejects hosted addresses and unsupported expression-based fields", () => {
    expect(() =>
      parseConfigurationProposal({
        applicationUrl: "https://example.com",
      }),
    ).toThrow("loopback");
    expect(() =>
      applyConfigurationProposal({
        source: source.replace(
          'startCommand: "npm run dev"',
          "startCommand: process.env.START_COMMAND",
        ),
        proposal: { startCommand: "npm run dev" },
      }),
    ).toThrow("editable application.startCommand literal");
  });

  it("treats dollar sequences in reviewed command literals as data", () => {
    const result = applyConfigurationProposal({
      source,
      proposal: { startCommand: "node -e '$& $1 $$'" },
    });
    expect(result.source).toContain(`startCommand: "node -e '$& $1 $$'"`);
  });
});
