import { createHash } from "node:crypto";
import { ContractError } from "./contracts.js";

export interface BaselineShapeData {
  readonly shapeVersion: 1;
  readonly algorithm: "bounded-keyed-graph-v1";
  readonly rehearsalVersion: string;
  readonly generationId: string;
  readonly baselineDataSha256: string;
  readonly policySha256: string;
  readonly privacyPolicySha256: string;
  readonly sourceSchemaSha256: string;
  readonly sourceSnapshotSha256: string;
  readonly seedSha256: string;
  readonly maximumRows: number;
  readonly maximumSourceRows: number;
  readonly maximumSourceBytes: number;
  readonly maximumDepth: number;
  readonly minimumCohortSize: number;
  readonly tables: readonly {
    readonly schema: string;
    readonly table: string;
    readonly sourceRows: number;
    readonly selectedRows: number;
    readonly emittedRows: number;
  }[];
  readonly relationships: readonly {
    readonly id: string;
    readonly checkedRows: number;
    readonly status: "passed";
  }[];
  readonly distributions: readonly {
    readonly id: string;
    readonly required: boolean;
    readonly tolerance: number;
    readonly status: "passed" | "failed" | "suppressed";
    readonly buckets: readonly {
      readonly bucket: string;
      readonly sourceCount: number | null;
      readonly selectedSourceCount: number | null;
      readonly baselineCount: number | null;
      readonly disposition:
        | "represented"
        | "transformed"
        | "omitted"
        | "absent"
        | "introduced"
        | "suppressed";
      readonly difference: number | null;
      readonly suppressed: boolean;
      readonly reason:
        | "within-tolerance"
        | "outside-tolerance"
        | "missing-required-source-class"
        | "insufficient-selected-class"
        | "insufficient-sanitized-class"
        | "privacy-cohort";
      readonly status: "passed" | "failed" | "suppressed";
    }[];
  }[];
  readonly warnings: readonly string[];
  readonly limitations: readonly string[];
  readonly evidenceSha256: string;
}

const object = (
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContractError("Shape evidence is invalid.");
  const object = value as Record<string, unknown>;
  if (
    Object.keys(object).sort().join("\0") !== [...expected].sort().join("\0")
  ) {
    throw new ContractError("Shape evidence contains unexpected fields.");
  }
  return object;
};
const list = (value: unknown, maximum: number): unknown[] => {
  if (!Array.isArray(value) || value.length > maximum)
    throw new ContractError("Shape evidence is unbounded.");
  return value;
};
const count = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 100_000
  ) {
    throw new ContractError("Shape count is invalid.");
  }
  return value;
};
const name = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{0,62}$/u.test(value))
    throw new ContractError("Shape identifier is invalid.");
  return value;
};
const digest = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    throw new ContractError("Shape digest is invalid.");
  return value;
};
const proportion = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new ContractError("Shape tolerance is invalid.");
  return value;
};
const status = (value: unknown): "passed" | "failed" | "suppressed" => {
  if (value !== "passed" && value !== "failed" && value !== "suppressed")
    throw new ContractError("Shape status is invalid.");
  return value;
};
const text = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    value.length > 500 ||
    /[\r\n\0]/u.test(value)
  )
    throw new ContractError("Shape explanation is invalid.");
  return value;
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

export const parseBaselineShapeData = (value: unknown): BaselineShapeData => {
  const input = object(value, [
    "shapeVersion",
    "algorithm",
    "rehearsalVersion",
    "generationId",
    "baselineDataSha256",
    "policySha256",
    "privacyPolicySha256",
    "sourceSchemaSha256",
    "sourceSnapshotSha256",
    "seedSha256",
    "maximumRows",
    "maximumSourceRows",
    "maximumSourceBytes",
    "maximumDepth",
    "minimumCohortSize",
    "tables",
    "relationships",
    "distributions",
    "warnings",
    "limitations",
    "evidenceSha256",
  ]);
  if (
    input.shapeVersion !== 1 ||
    input.algorithm !== "bounded-keyed-graph-v1" ||
    typeof input.generationId !== "string" ||
    !/^\d{8}T\d{6}Z-[a-f0-9]{12}$/u.test(input.generationId)
  ) {
    throw new ContractError("Shape version or generation is unsupported.");
  }
  const maximumRows = count(input.maximumRows),
    minimumCohortSize = count(input.minimumCohortSize);
  if (maximumRows < 1 || minimumCohortSize < 2 || minimumCohortSize > 1000)
    throw new ContractError("Shape bounds are invalid.");
  if (
    typeof input.rehearsalVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u.test(input.rehearsalVersion) ||
    count(input.maximumSourceRows) < maximumRows ||
    count(input.maximumDepth) < 1 ||
    count(input.maximumDepth) > 32 ||
    typeof input.maximumSourceBytes !== "number" ||
    !Number.isSafeInteger(input.maximumSourceBytes) ||
    input.maximumSourceBytes < 1 ||
    input.maximumSourceBytes > 128 * 1024 * 1024
  ) {
    throw new ContractError(
      "Shape source capacity or runtime version is invalid.",
    );
  }
  const tables = list(input.tables, 100).map((value) => {
    const table = object(value, [
      "schema",
      "table",
      "sourceRows",
      "selectedRows",
      "emittedRows",
    ]);
    const sourceRows = count(table.sourceRows),
      selectedRows = count(table.selectedRows),
      emittedRows = count(table.emittedRows);
    if (selectedRows > sourceRows || selectedRows !== emittedRows)
      throw new ContractError("Shape table counts contradict each other.");
    return {
      schema: name(table.schema),
      table: name(table.table),
      sourceRows,
      selectedRows,
      emittedRows,
    };
  });
  if (
    new Set(tables.map((table) => `${table.schema}.${table.table}`)).size !==
      tables.length ||
    tables.reduce((sum, table) => sum + table.emittedRows, 0) > maximumRows
  )
    throw new ContractError("Shape table budgets are invalid.");
  const relationships = list(input.relationships, 200).map((value) => {
    const relation = object(value, ["id", "checkedRows", "status"]);
    if (relation.status !== "passed")
      throw new ContractError("Shape relationship was not verified.");
    return {
      id: name(relation.id),
      checkedRows: count(relation.checkedRows),
      status: "passed" as const,
    };
  });
  if (
    new Set(relationships.map((relation) => relation.id)).size !==
    relationships.length
  )
    throw new ContractError("Shape relationships are duplicated.");
  const distributions = list(input.distributions, 120).map((value) => {
    const goal = object(value, [
      "id",
      "required",
      "tolerance",
      "status",
      "buckets",
    ]);
    if (typeof goal.required !== "boolean")
      throw new ContractError("Shape review is invalid.");
    const goalStatus = status(goal.status);
    if (goal.required && goalStatus !== "passed")
      throw new ContractError("Required shape evidence was not proved.");
    const buckets = list(goal.buckets, 64).map((value) => {
      const bucket = object(value, [
        "bucket",
        "sourceCount",
        "selectedSourceCount",
        "baselineCount",
        "disposition",
        "difference",
        "suppressed",
        "reason",
        "status",
      ]);
      if (
        typeof bucket.bucket !== "string" ||
        !/^(?:null|non-null|true|false|empty|non-empty|other|minimum|maximum|minimum-maximum|interior|zero|one|many|(?:bucket|category|joint)-\d{1,2})$/u.test(
          bucket.bucket,
        ) ||
        typeof bucket.suppressed !== "boolean" ||
        ![
          "represented",
          "transformed",
          "omitted",
          "absent",
          "introduced",
          "suppressed",
        ].includes(String(bucket.disposition))
      )
        throw new ContractError("Shape bucket is invalid.");
      const bucketStatus = status(bucket.status);
      const reason =
        bucket.reason as BaselineShapeData["distributions"][number]["buckets"][number]["reason"];
      if (
        ![
          "within-tolerance",
          "outside-tolerance",
          "missing-required-source-class",
          "insufficient-selected-class",
          "insufficient-sanitized-class",
          "privacy-cohort",
        ].includes(String(reason)) ||
        (bucketStatus === "passed" && reason !== "within-tolerance") ||
        (bucketStatus === "failed" &&
          ["within-tolerance", "privacy-cohort"].includes(reason)) ||
        (bucketStatus === "suppressed" && reason !== "privacy-cohort")
      )
        throw new ContractError(
          "Shape class explanation contradicts its status.",
        );
      if (bucket.suppressed) {
        if (
          bucket.sourceCount !== null ||
          bucket.selectedSourceCount !== null ||
          bucket.baselineCount !== null ||
          bucket.disposition !== "suppressed" ||
          bucket.difference !== null ||
          bucketStatus !== "suppressed"
        ) {
          throw new ContractError(
            "Shape evidence exposes a suppressed cohort.",
          );
        }
        return {
          bucket: bucket.bucket,
          sourceCount: null,
          selectedSourceCount: null,
          baselineCount: null,
          disposition: "suppressed" as const,
          difference: null,
          suppressed: true,
          reason,
          status: bucketStatus,
        };
      }
      const sourceCount = count(bucket.sourceCount),
        selectedSourceCount = count(bucket.selectedSourceCount),
        baselineCount = count(bucket.baselineCount);
      if (
        [sourceCount, selectedSourceCount, baselineCount].some(
          (value) => value > 0 && value < minimumCohortSize,
        ) ||
        bucketStatus === "suppressed"
      ) {
        throw new ContractError("Shape evidence exposes a low-count cohort.");
      }
      const disposition: BaselineShapeData["distributions"][number]["buckets"][number]["disposition"] =
        sourceCount === 0
          ? baselineCount === 0
            ? "absent"
            : "introduced"
          : selectedSourceCount === 0
            ? "omitted"
            : baselineCount === 0
              ? "transformed"
              : "represented";
      if (
        bucket.disposition !== disposition ||
        selectedSourceCount > sourceCount ||
        selectedSourceCount > maximumRows ||
        baselineCount > maximumRows
      ) {
        throw new ContractError(
          "Shape class disposition or selection boundary is inconsistent.",
        );
      }
      return {
        bucket: bucket.bucket,
        sourceCount,
        selectedSourceCount,
        baselineCount,
        disposition,
        difference: proportion(bucket.difference),
        suppressed: false,
        reason,
        status: bucketStatus,
      };
    });
    const actualStatus = buckets.some((bucket) => bucket.status === "failed")
      ? "failed"
      : buckets.some((bucket) => bucket.status === "suppressed")
        ? "suppressed"
        : "passed";
    if (
      buckets.some((bucket) => bucket.suppressed) &&
      buckets.some((bucket) => !bucket.suppressed)
    ) {
      throw new ContractError(
        "Shape evidence lacks complementary cohort suppression.",
      );
    }
    if (actualStatus !== goalStatus)
      throw new ContractError("Shape goal contradicts its bucket evidence.");
    if (
      new Set(buckets.map((bucket) => bucket.bucket)).size !== buckets.length ||
      buckets.some(
        (bucket) =>
          bucket.status === "passed" &&
          bucket.difference !== null &&
          bucket.difference > proportion(goal.tolerance) + Number.EPSILON,
      )
    ) {
      throw new ContractError("Shape bucket evidence is inconsistent.");
    }
    return {
      id: name(goal.id),
      required: goal.required,
      tolerance: proportion(goal.tolerance),
      status: goalStatus,
      buckets,
    };
  });
  if (
    new Set(distributions.map((goal) => goal.id)).size !== distributions.length
  )
    throw new ContractError("Shape goals are duplicated.");
  const result: BaselineShapeData = {
    shapeVersion: 1,
    algorithm: "bounded-keyed-graph-v1",
    rehearsalVersion: input.rehearsalVersion,
    generationId: input.generationId,
    baselineDataSha256: digest(input.baselineDataSha256),
    policySha256: digest(input.policySha256),
    privacyPolicySha256: digest(input.privacyPolicySha256),
    sourceSchemaSha256: digest(input.sourceSchemaSha256),
    sourceSnapshotSha256: digest(input.sourceSnapshotSha256),
    seedSha256: digest(input.seedSha256),
    maximumRows,
    maximumSourceRows: count(input.maximumSourceRows),
    maximumSourceBytes: input.maximumSourceBytes,
    maximumDepth: count(input.maximumDepth),
    minimumCohortSize,
    tables,
    relationships,
    distributions,
    warnings: list(input.warnings, 100).map(text),
    limitations: list(input.limitations, 100).map(text),
    evidenceSha256: digest(input.evidenceSha256),
  };
  const { evidenceSha256, ...unsigned } = result;
  if (
    createHash("sha256").update(canonical(unsigned)).digest("hex") !==
    evidenceSha256
  )
    throw new ContractError("Shape evidence checksum is invalid.");
  return result;
};
