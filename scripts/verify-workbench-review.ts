/** Consume installed public workbench evidence; never execute a CLI or edit a project. */
import { parseConfigurationMetadata } from "../src/configuration_contract.js";
import {
  configurationProposalChanges,
  parseConfigurationProposal,
} from "../src/configuration_editor.js";
import { parseLocalEndpoint } from "../src/local_endpoint.js";
import {
  selectMigrationView,
  type MigrationFilters,
} from "../src/migration_filter.js";
import {
  assertMatchingMigrationCandidates,
  parseMigrationReviewPlan,
} from "../src/migration_review.js";
import { migrationReviewMarkup } from "../src/migration_view.js";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import { DEFAULT_WORKSPACE_PREFERENCES } from "../src/workspace_preferences.js";
import {
  migrationReviewIdentity,
  reconcileMigrationReview,
} from "../src/workspace_view_state.js";
import {
  readOperationActivityReport,
  verifyOperationActivityEvidence,
} from "./verify-operation-activity.js";

const failure = () =>
  new Error(
    "Workbench evidence was missing, unsafe, mismatched or inconclusive; no project action was performed.",
  );
function requireEvidence(value: unknown): asserts value {
  if (!value) throw failure();
}
const object = (value: unknown): Record<string, unknown> => {
  requireEvidence(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
};
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
const sampleCounts = {
  zero: 0,
  one: 1,
  several: 3,
  multiTarget: 4,
  changed: 4,
} as const;
const checkNames = [
  "zero, one and several exact migration plans",
  "multiple targets and stale exact digest refusal",
  "reviewed loopback endpoint matrix and distinct health route",
  "unsafe endpoints and cross-target service collisions refuse",
  "reviewed inputs, baseline generations and private values preserved",
];
const refusalNames = [
  "stale-candidate-set",
  "remote-host",
  "url-credentials",
  "invalid-scheme",
  "out-of-range-port",
  "primary-own-db",
  "primary-dependent-db",
  "dependent-primary-db",
  "profile-dependent-db",
];

/** Section-only entry point keeps unit fixtures independent of activity-history fixtures. */
export function verifyWorkbenchReviewSamples(value: unknown) {
  try {
    requireEvidence(
      Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") <= 128 * 1024,
    );
    const section = object(value);
    requireEvidence(section.schemaVersion === 1 && section.status === "passed");
    requireEvidence(
      Array.isArray(section.checks) && section.checks.length === 5,
    );
    const observedChecks = new Set<string>();
    for (const raw of section.checks) {
      const check = object(raw);
      requireEvidence(
        typeof check.name === "string" && checkNames.includes(check.name),
      );
      requireEvidence(
        check.status === "passed" && !observedChecks.has(check.name),
      );
      observedChecks.add(check.name);
    }
    const preservation = object(section.preservation);
    requireEvidence(preservation.reviewedFilesUnchanged === true);
    requireEvidence(preservation.originalGenerationFilesPreserved === true);
    requireEvidence(
      Array.isArray(section.refusals) && section.refusals.length === 9,
    );
    const observedRefusals = new Set<string>();
    for (const raw of section.refusals) {
      const refusal = object(raw);
      requireEvidence(
        typeof refusal.scenario === "string" &&
          refusalNames.includes(refusal.scenario),
      );
      requireEvidence(!observedRefusals.has(refusal.scenario));
      observedRefusals.add(refusal.scenario);
      const stale = refusal.scenario === "stale-candidate-set";
      requireEvidence(refusal.exitCode === (stale ? 6 : 2));
      requireEvidence(
        refusal.category ===
          (stale ? "migration_candidate_failure" : "configuration_invalid"),
      );
      requireEvidence(
        refusal.code ===
          (stale ? "CANDIDATE_CONFIRMATION_REQUIRED" : "CONFIGURATION_INVALID"),
      );
    }
    const samples = object(section.samples);
    const migrations = object(samples.migrations);
    requireEvidence(
      same(Object.keys(migrations).sort(), Object.keys(sampleCounts).sort()),
    );
    const plans = Object.fromEntries(
      Object.entries(sampleCounts).map(([name, count]) => {
        const sample = object(migrations[name]);
        const plan = parseMigrationReviewPlan(sample.plan);
        assertMatchingMigrationCandidates(plan, sample.candidates);
        const targets =
          name === "multiTarget" || name === "changed"
            ? ["primary", "publication"]
            : ["primary"];
        requireEvidence(plan.candidateCount === count);
        requireEvidence(
          same(
            plan.targets.map(({ name }) => name),
            targets,
          ),
        );
        requireEvidence(
          plan.targets.every(({ provider }) => provider === "postgresql"),
        );
        requireEvidence(
          plan.targets.every(
            ({ entries }, index) =>
              entries.length ===
                (targets.length === 1 ? count : index === 0 ? 3 : 1) + 1 &&
              entries[0]?.status === "represented_by_baseline" &&
              entries.slice(1).every(({ status }) => status === "candidate"),
          ),
        );
        const entries = plan.targets
          .flatMap(({ entries }) => entries)
          .map((entry, order) => ({
            ...entry,
            order,
            name: entry.filename,
            sortName: entry.name,
            hasWarning: entry.warnings.length > 0,
          }));
        requireEvidence(entries.length === count + targets.length);
        requireEvidence(
          entries.filter(({ status }) => status === "represented_by_baseline")
            .length === targets.length,
        );
        const original = JSON.stringify(plan);
        const filters: MigrationFilters = {
          query: "",
          targets,
          status: "all",
          sort: "order",
          from: "",
          to: "",
          warning: "all",
        };
        const view = (patch: Partial<MigrationFilters> = {}) =>
          selectMigrationView(entries, { ...filters, ...patch });
        for (const sort of ["order", "name", "date", "target"] as const) {
          const result = view({ sort });
          requireEvidence(
            result.ordered !== entries &&
              result.visible.length === entries.length,
          );
          requireEvidence(
            same(
              result.ordered.map(({ id }) => id).sort(),
              entries.map(({ id }) => id).sort(),
            ),
          );
          for (let index = 1; index < result.ordered.length; index++) {
            const left = result.ordered[index - 1]!,
              right = result.ordered[index]!;
            const comparison =
              sort === "order"
                ? left.order - right.order
                : sort === "name"
                  ? left.sortName
                      .toLowerCase()
                      .localeCompare(right.sortName.toLowerCase())
                  : sort === "date"
                    ? left.version!.localeCompare(right.version!)
                    : left.target.localeCompare(right.target) ||
                      left.version!.localeCompare(right.version!);
            requireEvidence(comparison <= 0);
          }
        }
        for (const target of targets)
          requireEvidence(
            same(
              view({ targets: [target] }).visible.map(({ id }) => id),
              entries
                .filter((entry) => entry.target === target)
                .map(({ id }) => id),
            ),
          );
        requireEvidence(view({ targets: [] }).visible.length === 0);
        requireEvidence(
          view({ targets: ["unavailable-target"] }).visible.length === 0,
        );
        for (const status of [
          "candidate",
          "represented_by_baseline",
          "applied_to_current_runtime",
        ] as const)
          requireEvidence(
            same(
              view({ status }).visible.map(({ id }) => id),
              entries
                .filter((entry) => entry.status === status)
                .map(({ id }) => id),
            ),
          );
        requireEvidence(view({ warning: "warnings" }).visible.length === count);
        const first = entries[0]!;
        requireEvidence(
          same(
            view({ query: `  ${first.name.toUpperCase()}  ` }).visible.map(
              ({ id }) => id,
            ),
            entries
              .filter(({ name }) => name === first.name)
              .map(({ id }) => id),
          ),
        );
        requireEvidence(
          view({ query: "no-such-migration" }).visible.length === 0,
        );
        requireEvidence(
          view({ from: "2026-10-01", to: "2026-10-01" }).visible.length ===
            entries.length,
        );
        requireEvidence(view({ from: "2026-10-02" }).visible.length === 0);
        requireEvidence(view({ to: "2026-09-30" }).visible.length === 0);
        requireEvidence(
          view({
            query: first.target.toUpperCase(),
            targets: [first.target],
            status: "represented_by_baseline",
            warning: "all",
            from: "2026-10-01",
            to: "2026-10-01",
            sort: "date",
          }).visible.length === 1,
        );
        const snapshot: ProjectSnapshot = {
          workspaceName: "Installed workbench evidence",
          workspaceRoot: "/private/never-rendered",
          availability: "not_ready",
          migrationReview: plan,
        };
        const markup = migrationReviewMarkup(
          snapshot,
          DEFAULT_WORKSPACE_PREFERENCES,
        );
        requireEvidence(markup?.includes(plan.candidateSha256));
        requireEvidence(
          markup?.includes("Checkboxes record your review only."),
        );
        requireEvidence(
          markup?.includes(
            "filters and sorting never alter the execution order or digest",
          ),
        );
        requireEvidence(!markup?.includes("/private/never-rendered"));
        requireEvidence(
          !/data-migration-review="[^"]+"[^>]+checked/u.test(markup!),
        );
        requireEvidence(JSON.stringify(plan) === original);
        return [name, plan];
      }),
    ) as Record<
      keyof typeof sampleCounts,
      ReturnType<typeof parseMigrationReviewPlan>
    >;
    requireEvidence(
      plans.changed.candidateSha256 !== plans.multiTarget.candidateSha256,
    );
    requireEvidence(
      same(plans.changed.targets[0], plans.multiTarget.targets[0]),
    );
    requireEvidence(
      plans.changed.targets[1]!.baselineGenerationId ===
        plans.multiTarget.targets[1]!.baselineGenerationId,
    );
    requireEvidence(
      plans.changed.targets[1]!.candidateSha256 !==
        plans.multiTarget.targets[1]!.candidateSha256,
    );
    requireEvidence(
      same(
        plans.changed.targets[1]!.entries[0],
        plans.multiTarget.targets[1]!.entries[0],
      ),
    );
    requireEvidence(
      plans.changed.targets[1]!.entries[1]!.sha256 !==
        plans.multiTarget.targets[1]!.entries[1]!.sha256,
    );
    const beforeIdentity = migrationReviewIdentity({
      workspaceName: "Review",
      workspaceRoot: "/private/never-rendered",
      availability: "not_ready",
      migrationReview: plans.multiTarget,
    });
    const afterIdentity = migrationReviewIdentity({
      workspaceName: "Review",
      workspaceRoot: "/private/never-rendered",
      availability: "not_ready",
      migrationReview: plans.changed,
    });
    const reviewIds = plans.changed.targets.flatMap(({ entries }) =>
      entries.map(({ id }) => id),
    );
    requireEvidence(beforeIdentity !== afterIdentity);
    requireEvidence(
      reconcileMigrationReview(
        [reviewIds[0]],
        beforeIdentity,
        afterIdentity,
        reviewIds,
      ).length === 0,
    );
    requireEvidence(
      same(
        reconcileMigrationReview(
          [reviewIds[0]],
          afterIdentity,
          afterIdentity,
          reviewIds,
        ),
        [reviewIds[0]],
      ),
    );

    const endpoints = object(samples.endpoints);
    const primary = parseConfigurationMetadata(endpoints.primaryConfiguration);
    const dependent = parseConfigurationMetadata(
      endpoints.dependentConfiguration,
    );
    requireEvidence(
      primary.path === "rehearsal.config.mjs" &&
        dependent.path === "publication/rehearsal.config.mjs",
    );
    requireEvidence(
      primary.dependentTargetReview === "explicit-topologyConfigPath" &&
        dependent.dependentTargetReview === "explicit-topologyConfigPath",
    );
    const health = primary.fields.find(
      ({ path }) => path === "application.readiness.url",
    );
    requireEvidence(health?.value === "http://127.0.0.1:58323/health");
    parseLocalEndpoint(health.value);
    const expectedReviews = [
      ["localhost-path", "http://localhost:5175/app/callback", primary],
      ["ipv4-path", "http://127.0.0.1:5176/app/callback", primary],
      ["ipv6-https-path", "https://[::1]:5177/app/callback", primary],
      [
        "dependent-explicit-topology",
        "http://localhost:5178/publication/callback",
        dependent,
      ],
    ] as const;
    requireEvidence(
      Array.isArray(endpoints.accepted) && endpoints.accepted.length === 4,
    );
    for (const [index, [name, url, metadata]] of expectedReviews.entries()) {
      const sample = object(endpoints.accepted[index]),
        review = object(sample.review);
      requireEvidence(sample.name === name && review.schemaVersion === 1);
      requireEvidence(
        review.path === metadata.path &&
          review.sourceSha256 === metadata.sourceSha256,
      );
      requireEvidence(
        review.validation === "complete-config-passed" &&
          review.topologyValidation === "complete-configured-topology-passed",
      );
      requireEvidence(
        review.writesConfiguration === false &&
          review.executesProposedCommands === false,
      );
      requireEvidence(same(review.topologyTargets, ["primary", "publication"]));
      requireEvidence(
        Array.isArray(review.changes) && review.changes.length === 1,
      );
      const change = object(review.changes[0]);
      const browser = metadata.fields.find(
        ({ path }) => path === "runtime.applicationUrl",
      );
      requireEvidence(
        change.path === "runtime.applicationUrl" &&
          change.previous === browser?.value &&
          change.proposed === url,
      );
      parseLocalEndpoint(change.previous);
      requireEvidence(parseLocalEndpoint(change.proposed).toString() === url);
      const changes = configurationProposalChanges(
        parseConfigurationProposal({ applicationUrl: change.proposed }),
      );
      requireEvidence(
        same(changes, [{ path: "runtime.applicationUrl", value: url }]),
      );
      const fields = new Map(
        metadata.fields.map(({ path, value }) => [path, value]),
      );
      const originalFields = new Map(fields);
      for (const { path, value } of changes) fields.set(path, value);
      requireEvidence(fields.get("runtime.applicationUrl") === url);
      for (const [path, value] of originalFields)
        if (path !== "runtime.applicationUrl")
          requireEvidence(same(fields.get(path), value));
    }
    return {
      status: "passed",
      migrationSamplesAccepted: 5,
      candidateCounts: { ...sampleCounts },
      sortModesAccepted: 4,
      configurationPathsAccepted: 2,
      endpointReviewsAccepted: 4,
      refusalsAccepted: 9,
      staleReviewReset: true,
      limitations: [
        "Installed file-baseline, public migration-plan and read-only endpoint-proposal evidence; no SQL, live database or occupied-listener proof.",
        "Production editor parsing, display filtering, markup and proposal mapping only; native rendering, keyboard, save, cancellation and screen readers need direct checks.",
        "Browser addresses remain separate from health checks and provider callbacks; no Google or other provider login is inferred.",
        "Core accepts a wider URL contract; stricter editor query/fragment and privileged-port refusals have separate unit tests.",
      ],
    };
  } catch {
    throw failure();
  }
}

export function verifyWorkbenchReviewEvidence(
  value: unknown,
  expectedSha256: string,
) {
  try {
    const activity = verifyOperationActivityEvidence(value, expectedSha256);
    return {
      ...verifyWorkbenchReviewSamples(object(value).workbenchReview),
      artifactSha256: expectedSha256,
      version: activity.version,
    };
  } catch {
    throw failure();
  }
}

async function main(): Promise<void> {
  const [path, sha256, ...extra] = process.argv.slice(2);
  requireEvidence(path && sha256 && extra.length === 0);
  console.log(
    JSON.stringify(
      verifyWorkbenchReviewEvidence(
        await readOperationActivityReport(path),
        sha256,
      ),
      null,
      2,
    ),
  );
}

if (require.main === module)
  void main().catch(() => {
    console.error(failure().message);
    process.exitCode = 1;
  });
