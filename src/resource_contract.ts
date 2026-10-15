import { ContractError } from "./contracts.js";

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
