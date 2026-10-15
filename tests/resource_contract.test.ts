import { describe, it, expect } from "vitest";
import {
  parseResourceCatalog,
  parseImageCleanupReview,
} from "../src/resource_contract.js";
const id = `sha256:${"a".repeat(64)}`;
const image = {
  id,
  service: "postgres",
  tags: ["public.ecr.aws/supabase/postgres:old"],
  digests: [],
  createdAt: "2026-09-01T00:00:00Z",
  bytes: 100,
  state: "candidate",
  reason: "Unused older image",
  references: [],
};
const catalog = {
  schemaVersion: 1,
  images: [image],
  volumes: [],
  otherContainers: [],
};
const preview = {
  mode: "preview",
  plan: {
    digest: "b".repeat(64),
    imagesOnly: true,
    runtime: { included: false },
    baselines: { removed: [] },
    images: { candidates: [image] },
  },
};
describe("individual resource contracts", () => {
  it("accepts bounded core metadata and preserves unsupported/unavailable states", () => {
    expect(parseResourceCatalog(catalog)?.images[0]?.id).toBe(id);
    expect(parseResourceCatalog(undefined)).toBeUndefined();
    expect(parseResourceCatalog(null)).toBeNull();
  });
  it("refuses contradictory cleanup evidence, duplicate identities and invalid measurements", () => {
    for (const images of [
      [{ ...image, bytes: -1 }],
      [image, image],
      [
        {
          ...image,
          references: [
            {
              id: "container",
              name: "stopped",
              running: false,
              ownership: "other",
            },
          ],
        },
      ],
      [{ ...image, tags: ["private/db:old"] }],
    ])
      expect(() => parseResourceCatalog({ ...catalog, images })).toThrow();
    expect(() =>
      parseResourceCatalog({ ...catalog, schemaVersion: 2 }),
    ).toThrow("unsupported");
  });
  it("accepts an exact image-only preview and rejects volume/runtime/baseline or selection drift", () => {
    expect(parseImageCleanupReview(preview, [id])).toMatchObject({
      digest: "b".repeat(64),
      bytes: 100,
    });
    expect(() =>
      parseImageCleanupReview(preview, [`sha256:${"c".repeat(64)}`]),
    ).toThrow("match");
    for (const plan of [
      { ...preview.plan, runtime: { included: true } },
      { ...preview.plan, baselines: { removed: ["baseline"] } },
      { ...preview.plan, imagesOnly: false },
      { ...preview.plan, images: { candidates: [image, image] } },
    ])
      expect(() =>
        parseImageCleanupReview({ ...preview, plan }, [id]),
      ).toThrow();
  });
});
