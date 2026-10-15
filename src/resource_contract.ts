import { ContractError } from "./contracts.js";

export interface EnvironmentProvenanceData {
  readonly schemaVersion: 1;
  readonly inspectorVersion: string;
  readonly verification: "recorded-not-reverified";
  readonly configuredPorts: readonly {
    readonly service: "application" | "api" | "database" | "studio";
    readonly host: "localhost" | "127.0.0.1" | "[::1]";
    readonly port: number;
  }[];
  readonly runtime: {
    readonly rehearsalVersion: string | null;
    readonly versionReason: "not-recorded" | null;
    readonly baselineGenerationId: string;
    readonly baselineDataSha256: string;
    readonly candidateSha256: string | null;
    readonly migrationReason:
      "receipt-unavailable" | "receipt-does-not-match-baseline" | null;
  } | null;
  readonly runtimeReason: "receipt-unavailable" | "receipt-invalid" | null;
}

export interface EnvironmentClassificationData {
  readonly schemaVersion: 1;
  readonly role: "configured-environment";
  readonly dataPersistence: "preserved-on-stop";
  readonly presence: {
    readonly state: "created" | "not-created" | "unknown";
    readonly reason:
      | "owned-resources-observed"
      | "no-owned-resources-observed"
      | "ownership-inspection-unavailable";
  };
  readonly receipt: {
    readonly state: "compatible" | "incompatible" | "unknown";
    readonly reason:
      | "supported-receipt-format-and-provider"
      | "receipt-invalid"
      | "receipt-unavailable"
      | "provider-not-recorded"
      | "receipt-binding-mismatch";
    readonly scope: "format-and-provider-only";
  };
  readonly review: {
    readonly state: "due" | "not-due" | "disabled" | "unknown";
    readonly reason:
      | "observable-cutoff-exceeded"
      | "recent-observable-activity"
      | "not-running"
      | "cutoff-disabled"
      | "ownership-inspection-unavailable"
      | "observable-activity-unavailable";
    readonly staleAfterSeconds: number | null;
    readonly lastObservableActivityAt: string | null;
  };
}

export interface ResourceCatalogData {
  readonly schemaVersion: 1;
  readonly images: readonly {
    readonly id: string;
    readonly service: string;
    readonly tags: readonly string[];
    readonly digests: readonly string[];
    readonly createdAt: string | null;
    readonly bytes: number;
    readonly state: "candidate" | "in-use" | "current" | "outside-policy";
    readonly reason: string;
    readonly references: readonly {
      readonly id: string;
      readonly name: string;
      readonly running: boolean;
      readonly ownership: "project" | "other";
    }[];
  }[];
  readonly volumes: readonly {
    readonly name: string;
    readonly target: string | null;
    readonly ownership: "project" | "other" | "conflicting";
    readonly purpose: "database" | "storage" | "unknown";
    readonly bytes: number | null;
    readonly createdAt: string | null;
    readonly lastActivityAt: string | null;
    readonly state: "attached" | "detached";
    readonly protected: boolean;
    readonly containerCount: number;
    readonly reason: string;
  }[];
  readonly otherContainers: readonly {
    readonly id: string;
    readonly name: string;
    readonly running: boolean;
    readonly ownership: "other" | "conflicting";
    readonly reason: string;
  }[];
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ContractError("Resource details are invalid.");
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 1000 ||
    /[\r\n\0]/u.test(value)
  )
    throw new ContractError("Resource text is invalid.");
  return value;
};
const number = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new ContractError("Resource measurement is invalid.");
  return value;
};
const boolean = (value: unknown): boolean => {
  if (typeof value !== "boolean")
    throw new ContractError("Resource state is invalid.");
  return value;
};
const array = (value: unknown, max = 1000): unknown[] => {
  if (!Array.isArray(value) || value.length > max)
    throw new ContractError("Resource list is not bounded.");
  return value;
};
const choice = <T extends string>(value: unknown, values: readonly T[]): T => {
  if (!values.includes(value as T))
    throw new ContractError("Resource classification is invalid.");
  return value as T;
};
const date = (value: unknown): string => {
  const parsed = text(value);
  if (!Number.isFinite(Date.parse(parsed)))
    throw new ContractError("Resource date is invalid.");
  return parsed;
};
const imageId = (value: unknown): string => {
  const id = text(value);
  if (!/^sha256:[a-f0-9]{64}$/u.test(id))
    throw new ContractError("Full image ID is required.");
  return id;
};
const exactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new ContractError(
      "Environment provenance contains unsupported fields.",
    );
};
export const parseEnvironmentClassification = (
  value: unknown,
  inspectedAt?: string,
): EnvironmentClassificationData | undefined => {
  if (value === undefined) return undefined;
  const data = record(value);
  exactKeys(data, [
    "schemaVersion",
    "role",
    "dataPersistence",
    "presence",
    "receipt",
    "review",
  ]);
  if (
    data.schemaVersion !== 1 ||
    data.role !== "configured-environment" ||
    data.dataPersistence !== "preserved-on-stop"
  )
    throw new ContractError(
      "Environment classification schema is unsupported.",
    );
  const presence = record(data.presence);
  const receipt = record(data.receipt);
  const review = record(data.review);
  exactKeys(presence, ["state", "reason"]);
  exactKeys(receipt, ["state", "reason", "scope"]);
  exactKeys(review, [
    "state",
    "reason",
    "staleAfterSeconds",
    "lastObservableActivityAt",
  ]);
  const presenceReason = choice(presence.reason, [
    "owned-resources-observed",
    "no-owned-resources-observed",
    "ownership-inspection-unavailable",
  ] as const);
  const presenceStates = {
    "owned-resources-observed": "created",
    "no-owned-resources-observed": "not-created",
    "ownership-inspection-unavailable": "unknown",
  } as const;
  const receiptReason = choice(receipt.reason, [
    "supported-receipt-format-and-provider",
    "receipt-invalid",
    "receipt-unavailable",
    "provider-not-recorded",
    "receipt-binding-mismatch",
  ] as const);
  const receiptStates = {
    "supported-receipt-format-and-provider": "compatible",
    "receipt-invalid": "incompatible",
    "receipt-unavailable": "unknown",
    "provider-not-recorded": "unknown",
    "receipt-binding-mismatch": "incompatible",
  } as const;
  const reviewReason = choice(review.reason, [
    "observable-cutoff-exceeded",
    "recent-observable-activity",
    "not-running",
    "cutoff-disabled",
    "ownership-inspection-unavailable",
    "observable-activity-unavailable",
  ] as const);
  const reviewStates = {
    "observable-cutoff-exceeded": "due",
    "recent-observable-activity": "not-due",
    "not-running": "not-due",
    "cutoff-disabled": "disabled",
    "ownership-inspection-unavailable": "unknown",
    "observable-activity-unavailable": "unknown",
  } as const;
  const cutoff =
    review.staleAfterSeconds === null ? null : number(review.staleAfterSeconds);
  const last =
    review.lastObservableActivityAt === null
      ? null
      : date(review.lastObservableActivityAt);
  const aged = [
    "observable-cutoff-exceeded",
    "recent-observable-activity",
  ].includes(reviewReason);
  if (
    presence.state !== presenceStates[presenceReason] ||
    receipt.state !== receiptStates[receiptReason] ||
    receipt.scope !== "format-and-provider-only" ||
    review.state !== reviewStates[reviewReason] ||
    (cutoff !== null && cutoff < 1) ||
    (reviewReason === "cutoff-disabled" && cutoff !== null) ||
    (reviewReason !== "ownership-inspection-unavailable" &&
      reviewReason !== "cutoff-disabled" &&
      cutoff === null) ||
    aged !== (last !== null) ||
    (last !== null && Date.parse(last) <= 0) ||
    (presence.state === "unknown" && review.state !== "unknown") ||
    (review.state === "due" && presence.state !== "created")
  )
    throw new ContractError(
      "Environment classification contradicts its evidence.",
    );
  if (last !== null && inspectedAt !== undefined) {
    const age = Date.parse(inspectedAt) - Date.parse(last);
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      (review.state === "due" && age < cutoff! * 1000) ||
      (reviewReason === "recent-observable-activity" && age >= cutoff! * 1000)
    )
      throw new ContractError(
        "Environment review age contradicts its observation time.",
      );
  }
  return {
    schemaVersion: 1,
    role: "configured-environment",
    dataPersistence: "preserved-on-stop",
    presence: { state: presenceStates[presenceReason], reason: presenceReason },
    receipt: {
      state: receiptStates[receiptReason],
      reason: receiptReason,
      scope: "format-and-provider-only",
    },
    review: {
      state: reviewStates[reviewReason],
      reason: reviewReason,
      staleAfterSeconds: cutoff,
      lastObservableActivityAt: last,
    },
  };
};
const provenanceVersion = (value: unknown): string => {
  const version = text(value);
  if (
    version.length > 100 ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)
  )
    throw new ContractError("Environment provenance version is invalid.");
  return version;
};
const provenanceDigest = (value: unknown): string => {
  const digest = text(value);
  if (!/^[a-f0-9]{64}$/u.test(digest))
    throw new ContractError("Environment provenance checksum is invalid.");
  return digest;
};
export const parseEnvironmentProvenance = (
  value: unknown,
): EnvironmentProvenanceData | undefined => {
  if (value === undefined) return undefined;
  const data = record(value);
  exactKeys(data, [
    "schemaVersion",
    "inspectorVersion",
    "verification",
    "configuredPorts",
    "runtime",
    "runtimeReason",
  ]);
  if (
    data.schemaVersion !== 1 ||
    data.verification !== "recorded-not-reverified"
  )
    throw new ContractError("Environment provenance schema is unsupported.");
  const configuredPorts = array(data.configuredPorts, 4).map((entry) => {
    const endpoint = record(entry);
    exactKeys(endpoint, ["service", "host", "port"]);
    const service = choice(endpoint.service, [
      "application",
      "api",
      "database",
      "studio",
    ] as const);
    const host = choice(endpoint.host, [
      "localhost",
      "127.0.0.1",
      "[::1]",
    ] as const);
    const port = number(endpoint.port);
    if (
      port < 1024 ||
      port > 65535 ||
      (service !== "application" && host !== "127.0.0.1")
    )
      throw new ContractError("Environment provenance endpoint is invalid.");
    return { service, host, port };
  });
  if (
    new Set(configuredPorts.map((entry) => entry.service)).size !==
      configuredPorts.length ||
    new Set(configuredPorts.map((entry) => entry.port)).size !==
      configuredPorts.length
  )
    throw new ContractError(
      "Environment provenance service or port is duplicated.",
    );
  let runtime: EnvironmentProvenanceData["runtime"] = null;
  if (data.runtime !== null) {
    const receipt = record(data.runtime);
    exactKeys(receipt, [
      "rehearsalVersion",
      "versionReason",
      "baselineGenerationId",
      "baselineDataSha256",
      "candidateSha256",
      "migrationReason",
    ]);
    const rehearsalVersion =
      receipt.rehearsalVersion === null
        ? null
        : provenanceVersion(receipt.rehearsalVersion);
    const versionReason =
      receipt.versionReason === null
        ? null
        : choice(receipt.versionReason, ["not-recorded"] as const);
    const baselineGenerationId = text(receipt.baselineGenerationId);
    if (!/^\d{8}T\d{6}Z-[a-f0-9]{12}$/u.test(baselineGenerationId))
      throw new ContractError("Environment provenance generation is invalid.");
    const candidateSha256 =
      receipt.candidateSha256 === null
        ? null
        : provenanceDigest(receipt.candidateSha256);
    const migrationReason =
      receipt.migrationReason === null
        ? null
        : choice(receipt.migrationReason, [
            "receipt-unavailable",
            "receipt-does-not-match-baseline",
          ] as const);
    if (
      (rehearsalVersion === null) !== (versionReason !== null) ||
      (candidateSha256 === null) !== (migrationReason !== null) ||
      data.runtimeReason !== null
    )
      throw new ContractError(
        "Environment provenance contradicts its availability.",
      );
    runtime = {
      rehearsalVersion,
      versionReason,
      baselineGenerationId,
      baselineDataSha256: provenanceDigest(receipt.baselineDataSha256),
      candidateSha256,
      migrationReason,
    };
  }
  const runtimeReason =
    data.runtimeReason === null
      ? null
      : choice(data.runtimeReason, [
          "receipt-unavailable",
          "receipt-invalid",
        ] as const);
  if ((runtime === null) !== (runtimeReason !== null))
    throw new ContractError(
      "Environment provenance contradicts its availability.",
    );
  return {
    schemaVersion: 1,
    inspectorVersion: provenanceVersion(data.inspectorVersion),
    verification: "recorded-not-reverified",
    configuredPorts,
    runtime,
    runtimeReason,
  };
};
export const parseResourceCatalog = (
  value: unknown,
): ResourceCatalogData | null | undefined => {
  if (value === undefined || value === null) return value;
  const data = record(value);
  if (data.schemaVersion !== 1)
    throw new ContractError("Resource details schema is unsupported.");
  const images = array(data.images).map((value) => {
    const image = record(value);
    return {
      id: imageId(image.id),
      service: text(image.service),
      tags: array(image.tags, 100).map(text),
      digests: array(image.digests, 100).map(text),
      createdAt: image.createdAt === null ? null : date(image.createdAt),
      bytes: number(image.bytes),
      state: choice(image.state, [
        "candidate",
        "in-use",
        "current",
        "outside-policy",
      ] as const),
      reason: text(image.reason),
      references: array(image.references).map((value) => {
        const reference = record(value);
        return {
          id: text(reference.id),
          name: text(reference.name),
          running: boolean(reference.running),
          ownership: choice(reference.ownership, ["project", "other"] as const),
        };
      }),
    };
  });
  if (new Set(images.map((image) => image.id)).size !== images.length)
    throw new ContractError("Duplicate resource image IDs.");
  if (
    images.some(
      (image) =>
        image.state === "candidate" &&
        (image.createdAt === null ||
          image.references.length > 0 ||
          !image.tags.length ||
          image.tags.some(
            (tag) => !tag.startsWith("public.ecr.aws/supabase/"),
          )),
    )
  )
    throw new ContractError(
      "Image cleanup eligibility conflicts with its evidence.",
    );
  const volumes = array(data.volumes).map((value) => {
    const v = record(value);
    return {
      name: text(v.name),
      target: v.target === null ? null : text(v.target),
      ownership: choice(v.ownership, [
        "project",
        "other",
        "conflicting",
      ] as const),
      purpose: choice(v.purpose, ["database", "storage", "unknown"] as const),
      bytes: v.bytes === null ? null : number(v.bytes),
      createdAt: v.createdAt === null ? null : date(v.createdAt),
      lastActivityAt: v.lastActivityAt === null ? null : date(v.lastActivityAt),
      state: choice(v.state, ["attached", "detached"] as const),
      protected: boolean(v.protected),
      containerCount: number(v.containerCount),
      reason: text(v.reason),
    };
  });
  const otherContainers = array(data.otherContainers).map((value) => {
    const c = record(value);
    return {
      id: text(c.id),
      name: text(c.name),
      running: boolean(c.running),
      ownership: choice(c.ownership, ["other", "conflicting"] as const),
      reason: text(c.reason),
    };
  });
  return { schemaVersion: 1, images, volumes, otherContainers };
};

export const parseImageCleanupReview = (
  value: unknown,
  selectedIds: readonly string[],
): { digest: string; images: ResourceCatalogData["images"]; bytes: number } => {
  const data = record(value);
  if (data.mode !== "preview")
    throw new ContractError("An image cleanup preview is required.");
  const plan = record(data.plan);
  const digest = text(plan.digest);
  if (!/^[a-f0-9]{64}$/u.test(digest))
    throw new ContractError("Cleanup digest is invalid.");
  const plans =
    plan.targets === undefined
      ? [plan]
      : array(plan.targets, 25).map((value) => record(record(value).plan));
  const images: ResourceCatalogData["images"][number][] = [];
  for (const p of plans) {
    const runtime = record(p.runtime);
    const baselines = record(p.baselines);
    if (
      p.imagesOnly !== true ||
      runtime.included !== false ||
      array(baselines.removed).length
    )
      throw new ContractError(
        "Image cleanup must not include environments, data volumes, or baselines.",
      );
    for (const value of array(record(p.images).candidates, 100)) {
      const image = record(value);
      images.push({
        id: imageId(image.id),
        service: "Image",
        tags: array(image.tags, 100).map(text),
        digests: [],
        createdAt: date(image.createdAt),
        bytes: number(image.bytes),
        state: "candidate",
        reason: "Exact core preview",
        references: [],
      });
    }
  }
  if (
    !selectedIds.length ||
    new Set(images.map((i) => i.id)).size !== images.length ||
    images.length !== selectedIds.length ||
    images.some(
      (i) =>
        !selectedIds.includes(i.id) ||
        !i.tags.length ||
        i.tags.some((tag) => !tag.startsWith("public.ecr.aws/supabase/")),
    )
  )
    throw new ContractError(
      "Cleanup preview does not match the selected images.",
    );
  return { digest, images, bytes: images.reduce((sum, i) => sum + i.bytes, 0) };
};
