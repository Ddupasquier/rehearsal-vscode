import type { DatabaseCapabilities } from "../../../src/runtime/reports/database_capabilities.js";

const supported = {
  state: "supported",
  reason: "qualified",
  scope: "sqlite-v1",
} as const;
const notApplicable = {
  state: "not-applicable",
  reason: "not_applicable",
  scope: "sqlite-v1",
} as const;

export const sqliteCapabilities = (): DatabaseCapabilities => ({
  schemaVersion: 1,
  target: "primary",
  engine: { family: "sqlite", service: "sqlite", version: "3.53.4" },
  backend: "native",
  availability: "available",
  assurance: "inspection",
  capabilities: {
    snapshot: { ...supported },
    restore: { ...supported },
    schema: { ...supported },
    migrations: { ...supported },
    privacy: { ...supported },
    applicationConnection: { ...supported },
    recovery: { ...supported },
    persistence: { ...supported },
    cleanup: { ...supported },
    transactionalDdl: { ...supported },
    auth: { ...notApplicable },
    storage: { ...notApplicable },
  },
});

export const sqliteBaselineEngine = {
  family: "sqlite",
  service: "sqlite",
  version: "3.53.4",
  driverVersion: 1,
  codecVersion: 1,
} as const;
