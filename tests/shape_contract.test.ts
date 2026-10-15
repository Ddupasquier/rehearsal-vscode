import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseBaselineShapeData } from "../src/shape_contract.js";
import { renderBaselineShapeEvidence } from "../src/shape_view.js";

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const receipt = (overrides: Record<string, unknown> = {}) => {
  const unsigned = {
    shapeVersion: 1,
    algorithm: "bounded-keyed-graph-v1",
    rehearsalVersion: "0.1.0-rc.4",
    generationId: "20261013T210000Z-111111111111",
    baselineDataSha256: "a".repeat(64),
    policySha256: "b".repeat(64),
    privacyPolicySha256: "c".repeat(64),
    sourceSchemaSha256: "d".repeat(64),
    sourceSnapshotSha256: "e".repeat(64),
    seedSha256: "f".repeat(64),
    maximumRows: 20,
    maximumSourceRows: 100,
    maximumSourceBytes: 100000,
    maximumDepth: 8,
    minimumCohortSize: 5,
    tables: [
      {
        schema: "public",
        table: "items",
        sourceRows: 40,
        selectedRows: 20,
        emittedRows: 20,
      },
    ],
    relationships: [{ id: "owner", checkedRows: 20, status: "passed" }],
    distributions: [
      {
        id: "active",
        required: true,
        tolerance: 0,
        status: "passed",
        buckets: [
          {
            bucket: "true",
            sourceCount: 20,
            selectedSourceCount: 10,
            baselineCount: 10,
            disposition: "represented",
            difference: 0,
            suppressed: false,
            reason: "within-tolerance",
            status: "passed",
          },
          {
            bucket: "false",
            sourceCount: 20,
            selectedSourceCount: 10,
            baselineCount: 10,
            disposition: "represented",
            difference: 0,
            suppressed: false,
            reason: "within-tolerance",
            status: "passed",
          },
        ],
      },
    ],
    warnings: [],
    limitations: ["Only declared relationships are measured."],
    ...overrides,
  };
  return {
    ...unsigned,
    evidenceSha256: createHash("sha256")
      .update(canonical(unsigned))
      .digest("hex"),
  };
};

describe("baseline shape contract", () => {
  it("accepts bounded digest-bound public aggregates and renders honest limitations", () => {
    const shape = parseBaselineShapeData(receipt());
    const html = renderBaselineShapeEvidence(shape);
    expect(html).toContain("Selected / source rows");
    expect(html).toContain("20 / 40");
    expect(html).toContain("Required");
    expect(html).toContain("not a promise");
    expect(renderBaselineShapeEvidence(null)).toContain(
      "No measured shape receipt",
    );
  });

  it("rejects unknown private values even when a sender recomputes the checksum", () => {
    expect(() =>
      parseBaselineShapeData(
        receipt({ rows: [{ email: "private@example.test" }] }),
      ),
    ).toThrow("unexpected fields");
    expect(() =>
      parseBaselineShapeData(receipt({ sourceUrl: "https://private.example" })),
    ).toThrow("unexpected fields");
    expect(() => parseBaselineShapeData(receipt({ shapeVersion: 2 }))).toThrow(
      "unsupported",
    );
  });

  it("rejects tampering, contradictory counts and required failures", () => {
    const value = receipt();
    expect(() =>
      parseBaselineShapeData({ ...value, seedSha256: "0".repeat(64) }),
    ).toThrow("checksum");
    expect(() =>
      parseBaselineShapeData(
        receipt({
          tables: [
            {
              schema: "public",
              table: "items",
              sourceRows: 10,
              selectedRows: 20,
              emittedRows: 20,
            },
          ],
        }),
      ),
    ).toThrow("contradict");
    expect(() =>
      parseBaselineShapeData(
        receipt({
          distributions: [
            {
              id: "active",
              required: true,
              tolerance: 0,
              status: "failed",
              buckets: [],
            },
          ],
        }),
      ),
    ).toThrow("not proved");
  });

  it.each([10, 21])(
    "keeps core table conservation when emitted rows are %s rather than the selected 20",
    (emittedRows) => {
      // Recomputing the receipt digest and using advisory goals never waives core's
      // selected/emitted row equality. Privacy transforms may change fields/classes,
      // but unsupported row loss must not be presented as an accepted baseline.
      const value = receipt({
        maximumRows: 40,
        tables: [
          {
            schema: "public",
            table: "items",
            sourceRows: 40,
            selectedRows: 20,
            emittedRows,
          },
        ],
        distributions: [
          {
            id: "active",
            required: false,
            tolerance: 0,
            status: "failed",
            buckets: [
              {
                bucket: "true",
                sourceCount: 20,
                selectedSourceCount: 10,
                baselineCount: 0,
                disposition: "transformed",
                difference: 0.5,
                suppressed: false,
                reason: "outside-tolerance",
                status: "failed",
              },
            ],
          },
        ],
      });
      expect(() =>
        parseBaselineShapeData(JSON.parse(JSON.stringify(value))),
      ).toThrow("Shape table counts contradict each other");
    },
  );

  it("refuses leaked low cohorts and renders properly suppressed goals", () => {
    expect(() =>
      parseBaselineShapeData(
        receipt({
          distributions: [
            {
              id: "rare",
              required: false,
              tolerance: 1,
              status: "passed",
              buckets: [
                {
                  bucket: "null",
                  sourceCount: 1,
                  selectedSourceCount: 0,
                  baselineCount: 0,
                  disposition: "omitted",
                  difference: 0.025,
                  suppressed: false,
                  reason: "within-tolerance",
                  status: "passed",
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow("low-count");
    const shape = parseBaselineShapeData(
      receipt({
        distributions: [
          {
            id: "rare",
            required: false,
            tolerance: 1,
            status: "suppressed",
            buckets: [
              {
                bucket: "null",
                sourceCount: null,
                selectedSourceCount: null,
                baselineCount: null,
                disposition: "suppressed",
                difference: null,
                suppressed: true,
                reason: "privacy-cohort",
                status: "suppressed",
              },
            ],
          },
        ],
      }),
    );
    expect(renderBaselineShapeEvidence(shape)).toContain("Privacy-limited");
    expect(renderBaselineShapeEvidence(shape)).toContain(
      "rare bucket counts stay hidden",
    );
    expect(() =>
      parseBaselineShapeData(
        receipt({
          distributions: [
            {
              id: "rare",
              required: false,
              tolerance: 1,
              status: "suppressed",
              buckets: [
                {
                  bucket: "null",
                  sourceCount: 1,
                  selectedSourceCount: null,
                  baselineCount: null,
                  disposition: "suppressed",
                  difference: null,
                  suppressed: true,
                  reason: "privacy-cohort",
                  status: "suppressed",
                },
              ],
            },
          ],
        }),
      ),
    ).toThrow("suppressed cohort");
  });

  it("keeps text bounded and HTML-escapes explanatory strings", () => {
    const shape = parseBaselineShapeData(
      receipt({ limitations: ["<script>unsafe</script>"] }),
    );
    expect(renderBaselineShapeEvidence(shape)).not.toContain("<script>");
    expect(renderBaselineShapeEvidence(shape)).toContain("&lt;script&gt;");
    expect(() =>
      parseBaselineShapeData(receipt({ warnings: ["x".repeat(501)] })),
    ).toThrow("invalid");
  });

  it("rejects partial suppression even when the sender recalculates its checksum", () => {
    const value = receipt({
      distributions: [
        {
          id: "rare",
          required: false,
          tolerance: 1,
          status: "suppressed",
          buckets: [
            {
              bucket: "null",
              sourceCount: null,
              selectedSourceCount: null,
              baselineCount: null,
              disposition: "suppressed",
              difference: null,
              suppressed: true,
              reason: "privacy-cohort",
              status: "suppressed",
            },
            {
              bucket: "true",
              sourceCount: 20,
              selectedSourceCount: 10,
              baselineCount: 10,
              disposition: "represented",
              difference: 0,
              suppressed: false,
              reason: "within-tolerance",
              status: "passed",
            },
          ],
        },
      ],
    });
    expect(() => parseBaselineShapeData(value)).toThrow("complementary");
  });
});
