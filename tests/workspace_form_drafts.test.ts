import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import type { ProjectSnapshot } from "../src/project_snapshot.js";
import {
  reconcileWorkspaceFormDrafts,
  workspaceFormDraftIdentity,
  type WorkspaceDraftForm,
  type WorkspaceFormDraftState,
} from "../src/workspace_form_drafts.js";

const identity = "a".repeat(64);
const known: readonly WorkspaceDraftForm[] = [
  {
    key: "configuration-controls",
    fields: [{ key: "retention", kind: "value", value: "2" }],
  },
  {
    key: "resource:primary",
    fields: [
      { key: "name", kind: "value", value: "Primary sandbox" },
      { key: "protection", kind: "checked", value: false },
    ],
  },
];
const focus = [{ form: "resource:primary", control: "button:submit:0" }];
const draft = (): WorkspaceFormDraftState => ({
  version: 1,
  identity,
  forms: [
    {
      key: "configuration-controls",
      fields: [{ key: "retention", kind: "value", value: "4" }],
    },
    {
      key: "resource:primary",
      fields: [
        { key: "name", kind: "value", value: "My unsaved sandbox" },
        { key: "protection", kind: "checked", value: true },
      ],
    },
  ],
  focus: focus[0]!,
});

describe("configuration form recovery", () => {
  it("retains known draft values, checkbox state and an exact known focus reference", () => {
    expect(
      reconcileWorkspaceFormDrafts(draft(), identity, known, focus),
    ).toEqual(draft());
  });

  it("expires drafts after source/project identity changes or when source proof is unavailable", () => {
    for (const current of [null, "b".repeat(64), "unknown"])
      expect(
        reconcileWorkspaceFormDrafts(draft(), current, known, focus),
      ).toBeNull();
    expect(
      reconcileWorkspaceFormDrafts(undefined, identity, known, focus),
    ).toBeNull();
  });

  it("ignores removed forms, unknown fields and unknown focus without using saved selectors", () => {
    const saved = {
      ...draft(),
      forms: [
        {
          key: "configuration-controls",
          fields: [
            { key: "retention", kind: "value", value: "3" },
            { key: "password", kind: "value", value: "not restored" },
          ],
        },
        { key: "other-project", fields: [] },
      ],
      focus: { form: "resource:primary", control: "arbitrary-css-selector" },
    };
    expect(reconcileWorkspaceFormDrafts(saved, identity, known, focus)).toEqual(
      {
        version: 1,
        identity,
        forms: [
          {
            key: "configuration-controls",
            fields: [{ key: "retention", kind: "value", value: "3" }],
          },
        ],
        focus: null,
      },
    );
  });

  it("will not restore a value onto a checkbox or a boolean onto a text field", () => {
    const saved = {
      ...draft(),
      forms: [
        {
          key: "resource:primary",
          fields: [{ key: "protection", kind: "value", value: "true" }],
        },
      ],
    };
    expect(
      reconcileWorkspaceFormDrafts(saved, identity, known, focus)?.forms,
    ).toEqual([]);
    expect(
      reconcileWorkspaceFormDrafts(
        {
          ...draft(),
          forms: [
            {
              key: "configuration-controls",
              fields: [{ key: "retention", kind: "value", value: true }],
            },
          ],
        },
        identity,
        known,
        focus,
      ),
    ).toBeNull();
  });

  it("rejects duplicate forms/fields and unexpected stored properties", () => {
    const saved = draft();
    for (const malformed of [
      { ...saved, version: 2 },
      { ...saved, unexpected: "not retained" },
      {
        ...saved,
        forms: [
          {
            key: "configuration-controls",
            fields: [
              { key: "retention", kind: { toString: null }, value: "3" },
            ],
          },
        ],
      },
      { ...saved, forms: [saved.forms[0], saved.forms[0]] },
      {
        ...saved,
        forms: [
          {
            key: "configuration-controls",
            fields: [saved.forms[0]!.fields[0], saved.forms[0]!.fields[0]],
          },
        ],
      },
    ])
      expect(
        reconcileWorkspaceFormDrafts(malformed, identity, known, focus),
      ).toBeNull();
  });

  it("bounds UTF-8 field values and the complete retained state", () => {
    const state = (value: string) => ({
      ...draft(),
      forms: [
        {
          key: "configuration-controls",
          fields: [{ key: "retention", kind: "value", value }],
        },
      ],
    });
    expect(
      reconcileWorkspaceFormDrafts(
        state("a".repeat(65536)),
        identity,
        known,
        [],
      ),
    ).not.toBeNull();
    for (const value of ["a".repeat(65537), "😀".repeat(16385)])
      expect(
        reconcileWorkspaceFormDrafts(state(value), identity, known, []),
      ).toBeNull();
    const fields = Array.from({ length: 5 }, (_, index) => ({
      key: String(index),
      kind: "value" as const,
      value: "a".repeat(65536),
    }));
    expect(
      reconcileWorkspaceFormDrafts(
        { ...draft(), forms: [{ key: "large", fields }] },
        identity,
        [{ key: "large", fields }],
        [],
      ),
    ).toBeNull();
  });

  it("limits forms and fields even when incoming keys are unknown", () => {
    for (const forms of [
      Array.from({ length: 129 }, (_, index) => ({
        key: String(index),
        fields: [],
      })),
      [
        {
          key: "unknown",
          fields: Array.from({ length: 513 }, (_, index) => ({
            key: String(index),
            kind: "value",
            value: "x",
          })),
        },
      ],
    ])
      expect(
        reconcileWorkspaceFormDrafts(
          { ...draft(), forms },
          identity,
          known,
          [],
        ),
      ).toBeNull();
  });

  it("runs the serialized reconciler without module, Buffer or process globals", () => {
    const result = new Script(
      `const __name=value=>value; (${reconcileWorkspaceFormDrafts.toString()})(saved,identity,known,focus)`,
    ).runInNewContext(
      { saved: draft(), identity, known, focus, TextEncoder },
      { timeout: 1000 },
    );
    expect(JSON.parse(JSON.stringify(result))).toEqual(draft());
  });

  it("binds opaque identity to known project/configuration source, not runtime status", () => {
    const snapshot: ProjectSnapshot = {
      workspaceName: "Fixture",
      workspaceRoot: "/project-one",
      availability: "ready",
      version: "1.0.0",
      configPath: "rehearsal.config.mjs",
      configurationMetadata: {
        schemaVersion: 1,
        path: "rehearsal.config.mjs",
        sourceSha256: identity,
        fields: [],
        profiles: [],
        pathResolution: "project-local",
        manualFields: "",
      },
    };
    const current = workspaceFormDraftIdentity(snapshot);
    expect(workspaceFormDraftIdentity(snapshot, 0)).toBe(current);
    expect(workspaceFormDraftIdentity(snapshot, 1)).not.toBe(current);
    expect(workspaceFormDraftIdentity(snapshot, -1)).toBeNull();
    expect(current).toMatch(/^[a-f0-9]{64}$/u);
    expect(current).not.toContain("project-one");
    expect(
      workspaceFormDraftIdentity({ ...snapshot, availability: "loading" }),
    ).toBe(current);
    expect(
      workspaceFormDraftIdentity({
        ...snapshot,
        workspaceRoot: "/project-two",
      }),
    ).not.toBe(current);
    expect(
      workspaceFormDraftIdentity({
        ...snapshot,
        configurationMetadata: {
          ...snapshot.configurationMetadata!,
          sourceSha256: "b".repeat(64),
        },
      }),
    ).not.toBe(current);
    const { configurationMetadata: _metadata, ...unproven } = snapshot;
    expect(workspaceFormDraftIdentity(unproven)).toBeNull();
  });
});
