import { createHash } from "node:crypto";
import type { ProjectSnapshot } from "./project_snapshot.js";

export interface WorkspaceDraftField {
  readonly key: string;
  readonly kind: "value" | "checked";
  readonly value: string | boolean;
}

export interface WorkspaceDraftForm {
  readonly key: string;
  readonly fields: readonly WorkspaceDraftField[];
}

export interface WorkspaceDraftFocus {
  readonly form: string;
  readonly control: string;
}

export interface WorkspaceFormDraftState {
  readonly version: 1;
  readonly identity: string;
  readonly forms: readonly WorkspaceDraftForm[];
  readonly focus: WorkspaceDraftFocus | null;
}

/** Opaque, project-local identity: source changes invalidate remembered proposals. */
export const workspaceFormDraftIdentity = (
  snapshot: ProjectSnapshot,
  revision = 0,
): string | null => {
  const source = snapshot.configurationMetadata?.sourceSha256;
  if (
    !source ||
    !/^[a-f0-9]{64}$/u.test(source) ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    return null;
  return createHash("sha256")
    .update(
      JSON.stringify([
        snapshot.workspaceRoot,
        snapshot.configPath,
        snapshot.version,
        source,
        revision,
        snapshot.resources?.environments.map((environment) => [
          environment.target,
          environment.configPath,
          environment.projectId,
          environment.displayName,
          environment.protected,
        ]),
      ]),
    )
    .digest("hex");
};

/**
 * Self-contained for serialization into the webview; no Node APIs or imported
 * helpers. Known controls are captured from approved forms, never from saved keys.
 * Bounds are 128 forms, 512 fields, 64 KiB per value and 256 KiB total UTF-8.
 */
export const reconcileWorkspaceFormDrafts = (
  saved: unknown,
  identity: string | null,
  knownForms: readonly WorkspaceDraftForm[],
  knownFocus: readonly WorkspaceDraftFocus[],
): WorkspaceFormDraftState | null => {
  const object = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value));
  if (
    !identity ||
    !/^[a-f0-9]{64}$/u.test(identity) ||
    !object(saved) ||
    Object.keys(saved).some(
      (key) => !["version", "identity", "forms", "focus"].includes(key),
    ) ||
    saved.version !== 1 ||
    saved.identity !== identity ||
    !Array.isArray(saved.forms) ||
    saved.forms.length > 128
  )
    return null;
  const known = new Map(
    knownForms
      .slice(0, 128)
      .map((form) => [
        form.key,
        new Map(form.fields.map((field) => [field.key, field.kind])),
      ]),
  );
  const forms: WorkspaceDraftForm[] = [];
  const seen = new Set<string>();
  let count = 0;
  const encoder = new TextEncoder();
  for (const form of saved.forms) {
    if (
      !object(form) ||
      Object.keys(form).some((key) => !["key", "fields"].includes(key)) ||
      typeof form.key !== "string" ||
      form.key.length > 150 ||
      seen.has(form.key) ||
      !Array.isArray(form.fields) ||
      form.fields.length > 512
    )
      return null;
    seen.add(form.key);
    const allowed = known.get(form.key);
    const fields: WorkspaceDraftField[] = [];
    const fieldKeys = new Set<string>();
    for (const field of form.fields) {
      count++;
      if (
        count > 512 ||
        !object(field) ||
        Object.keys(field).some(
          (key) => !["key", "kind", "value"].includes(key),
        ) ||
        typeof field.key !== "string" ||
        field.key.length > 500 ||
        fieldKeys.has(field.key) ||
        typeof field.kind !== "string" ||
        !["value", "checked"].includes(field.kind) ||
        (field.kind === "checked"
          ? typeof field.value !== "boolean"
          : typeof field.value !== "string" ||
            field.value.length > 65536 ||
            encoder.encode(field.value).byteLength > 65536)
      )
        return null;
      fieldKeys.add(field.key);
      if (allowed?.get(field.key) !== field.kind) continue;
      fields.push({
        key: field.key,
        kind: field.kind as "value" | "checked",
        value: field.value as string | boolean,
      });
    }
    if (allowed && fields.length) forms.push({ key: form.key, fields });
  }
  let focus: WorkspaceDraftFocus | null = null;
  const savedFocus = saved.focus;
  if (savedFocus !== null && savedFocus !== undefined) {
    if (
      !object(savedFocus) ||
      Object.keys(savedFocus).some(
        (key) => !["form", "control"].includes(key),
      ) ||
      typeof savedFocus.form !== "string" ||
      savedFocus.form.length > 150 ||
      typeof savedFocus.control !== "string" ||
      savedFocus.control.length > 500
    )
      return null;
    const form = savedFocus.form;
    const control = savedFocus.control;
    if (
      knownFocus.some(
        (entry) => entry.form === form && entry.control === control,
      )
    )
      focus = { form, control };
  }
  const result: WorkspaceFormDraftState = {
    version: 1,
    identity,
    forms,
    focus,
  };
  return encoder.encode(JSON.stringify(result)).byteLength <= 256 * 1024
    ? result
    : null;
};
