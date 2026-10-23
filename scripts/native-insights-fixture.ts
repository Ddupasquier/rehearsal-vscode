/** Validate a private, synthetic Lab handoff before copying it into an owned editor. */
import { createHash } from "node:crypto";
import { parseMigrationReviewPlan } from "../src/migration_review.js";
import { parseMigrationInsights } from "../src/migration_insights.js";
import { parseMigrationSourceInput } from "../src/migration_source.js";

const fail = (): never => {
  throw new Error(
    "Native Insights fixture is invalid; private input withheld.",
  );
};
const shape = (value: unknown, keys: string): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== keys
  )
    return fail();
  return value as Record<string, unknown>;
};
const sha = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export function parseNativeInsightsFixture(value: unknown) {
  try {
    if (Buffer.byteLength(JSON.stringify(value) ?? "") > 256 * 1024)
      return fail();
    const data = shape(
      value,
      "coreArtifactSha256,coreVersion,files,insights,kind,plan,schemaVersion",
    );
    if (
      data.schemaVersion !== 1 ||
      data.kind !== "migration-insights-native-fixture" ||
      typeof data.coreVersion !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(data.coreVersion) ||
      typeof data.coreArtifactSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(data.coreArtifactSha256) ||
      !Array.isArray(data.files) ||
      !data.files.length ||
      data.files.length > 20
    )
      return fail();
    const plan = parseMigrationReviewPlan(data.plan);
    const report = parseMigrationInsights(
      data.insights,
      plan,
      data.coreVersion,
    );
    const paths = new Set<string>();
    const files = data.files.map((raw) => {
      const file = shape(raw, "base64,path,sha256");
      if (
        typeof file.path !== "string" ||
        !/^database\/migrations\/\d{14}_[A-Za-z0-9_-]+\.sql$/u.test(
          file.path,
        ) ||
        paths.has(file.path) ||
        typeof file.base64 !== "string" ||
        file.base64.length > 350000 ||
        typeof file.sha256 !== "string"
      )
        return fail();
      paths.add(file.path);
      const source = parseMigrationSourceInput({
        filename: file.path.split("/").at(-1),
        sha256: file.sha256,
        workspaceRelativePath: file.path,
      });
      const bytes = Buffer.from(file.base64, "base64");
      if (
        bytes.toString("base64") !== file.base64 ||
        bytes.length > 256 * 1024 ||
        !Buffer.from(bytes.toString("utf8")).equals(bytes) ||
        sha(bytes) !== source.sha256
      )
        return fail();
      return { path: file.path, sha256: source.sha256, bytes };
    });
    const entries = report.targets.flatMap((target) => target.entries);
    if (
      entries.length !== files.length ||
      entries.some(
        (entry) =>
          !files.some(
            (file) =>
              file.path === entry.workspaceRelativePath &&
              file.sha256 === entry.sha256,
          ),
      )
    )
      return fail();
    return {
      coreVersion: data.coreVersion,
      coreArtifactSha256: data.coreArtifactSha256,
      plan,
      report,
      files,
    };
  } catch {
    return fail();
  }
}
