/** Optional release metadata only; never part of passive project inspection. */
import { createHash } from "node:crypto";
import type { ExtensionReleaseEvidence } from "./extension_release_view.js";

export const UPDATE_RELEASES_URL =
  "https://github.com/Ddupasquier/rehearsal-vscode/releases";
export const UPDATE_METADATA_URLS = Object.freeze({
  core: "https://registry.npmjs.org/@rehearsal-db%2Fcore/latest",
  corePreview: "https://registry.npmjs.org/@rehearsal-db%2Fcore/beta",
  extension:
    "https://api.github.com/repos/Ddupasquier/rehearsal-vscode/releases?per_page=5",
});
const MAXIMUM_BYTES = 128 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const canonicalVersion =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
export const isPublishedVersion = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length > 80) return false;
  const match = canonicalVersion.exec(value);
  return (
    match !== null &&
    [match[1]!, match[2]!, match[3]!, ...(match[4]?.split(".") ?? [])].every(
      (part) =>
        !/^\d+$/u.test(part) ||
        ((part === "0" || !part.startsWith("0")) &&
          Number.isSafeInteger(Number(part))),
    )
  );
};
export function comparePublishedVersions(
  left: string,
  right: string,
): number | null {
  if (!isPublishedVersion(left) || !isPublishedVersion(right)) return null;
  const am = canonicalVersion.exec(left)!,
    bm = canonicalVersion.exec(right)!;
  const a = `${am[1]}.${am[2]}.${am[3]}`,
    ap = am[4];
  const b = `${bm[1]}.${bm[2]}.${bm[3]}`,
    bp = bm[4];
  const an = a!.split(".").map(Number),
    bn = b!.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (an[i] !== bn[i]) return an[i]! < bn[i]! ? -1 : 1;
  if (ap === undefined || bp === undefined)
    return ap === bp ? 0 : ap === undefined ? 1 : -1;
  const ax = ap.split("."),
    bx = bp.split(".");
  for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
    const x = ax[i],
      y = bx[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/u.test(x),
      yn = /^\d+$/u.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
/** Freshness is not a promise that a new compatibility series is safe to install. */
export function isEligibleCoreUpdate(
  installed: string,
  available: string,
): boolean {
  if (
    comparePublishedVersions(available, installed) !== 1 ||
    (!installed.includes("-") && available.includes("-"))
  )
    return false;
  const before = canonicalVersion.exec(installed)!,
    after = canonicalVersion.exec(available)!;
  return (
    before[1] === after[1] && (before[1] !== "0" || before[2] === after[2])
  );
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Unknown update metadata.");
  return value as Record<string, unknown>;
};
export interface PublishedUpdates {
  core: string | null;
  extension: string | null;
}
export function parseCoreUpdate(value: unknown): string {
  const data = object(value),
    dist = object(data.dist);
  if (
    data.name !== "@rehearsal-db/core" ||
    !isPublishedVersion(data.version) ||
    dist.tarball !==
      `https://registry.npmjs.org/@rehearsal-db/core/-/core-${data.version}.tgz` ||
    typeof dist.integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(dist.integrity)
  )
    throw new Error("Unknown update metadata.");
  return data.version;
}
export function parseExtensionUpdate(
  value: unknown,
  allowPreview: boolean,
): string | null {
  if (!Array.isArray(value) || value.length > 5)
    throw new Error("Unknown update metadata.");
  let latest: string | null = null;
  for (const raw of value) {
    const data = object(raw);
    if (data.draft === true || (!allowPreview && data.prerelease === true))
      continue;
    if (
      data.draft !== false ||
      typeof data.prerelease !== "boolean" ||
      typeof data.tag_name !== "string"
    )
      throw new Error("Unknown update metadata.");
    const version = data.tag_name.startsWith("v") ? data.tag_name.slice(1) : "";
    if (
      !isPublishedVersion(version) ||
      (!allowPreview && version.includes("-"))
    )
      continue;
    if (
      data.html_url !== `${UPDATE_RELEASES_URL}/tag/v${version}` ||
      !Array.isArray(data.assets) ||
      data.assets.length > 20
    )
      throw new Error("Unknown update metadata.");
    const names = data.assets.map((asset) => object(asset).name);
    if (
      !names.includes(`rehearsal-${version}.vsix`) ||
      !names.includes("SHA256SUMS")
    )
      continue;
    if (latest === null || comparePublishedVersions(version, latest)! > 0)
      latest = version;
  }
  return latest;
}
export async function fetchUpdateMetadata(
  kind: keyof typeof UPDATE_METADATA_URLS,
  signal: AbortSignal,
  fetchImplementation: typeof fetch = fetch,
): Promise<unknown> {
  if (!Object.hasOwn(UPDATE_METADATA_URLS, kind))
    throw new Error("Unknown update endpoint.");
  const options: NonNullable<Parameters<typeof fetch>[1]> & {
    cache: "no-store";
    referrerPolicy: "no-referrer";
  } = {
    signal,
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/json" },
  };
  const response = await fetchImplementation(
    UPDATE_METADATA_URLS[kind],
    options,
  );
  const mime = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    response.status !== 200 ||
    response.redirected ||
    !response.body ||
    response.url !== UPDATE_METADATA_URLS[kind] ||
    (mime !== "application/json" && mime !== "application/vnd.github+json")
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Update metadata unavailable.");
  }
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_BYTES)
  ) {
    await response.body.cancel().catch(() => {});
    throw new Error("Update metadata unavailable.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAXIMUM_BYTES)
        throw new Error("Update metadata unavailable.");
      chunks.push(next.value);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export interface UpdateProjectIdentity {
  readonly version: string | null;
  readonly origin: "registry" | "custom" | "unknown";
  readonly fingerprint: string;
  readonly dependencyGroup: DependencyGroup | null;
}
export type DependencyGroup =
  "dependencies" | "devDependencies" | "optionalDependencies";
export interface AdvisoryState {
  readonly offered: boolean;
  readonly enabled: boolean;
  readonly checkedAt: number;
  readonly deferredUntil: number;
  readonly skippedCore: string | null;
  readonly skippedExtension: string | null;
}
export const updateAdvisoryStorageKey = (key: string) =>
  `rehearsal.update-advisory.v1.${createHash("sha256").update(key).digest("hex")}`;
const initial: AdvisoryState = {
  offered: false,
  enabled: false,
  checkedAt: 0,
  deferredUntil: 0,
  skippedCore: null,
  skippedExtension: null,
};
export interface UpdateAdvisoryHost {
  extensionRelease?(key: string, evidence: ExtensionReleaseEvidence): void;
  checking<T>(action: () => Promise<T>): Promise<T>;
  allowed(key: string): boolean;
  identify(key: string): Promise<UpdateProjectIdentity>;
  load(key: string): unknown;
  save(key: string, state: AdvisoryState): Promise<void>;
  consent(
    key: string,
    manual: boolean,
  ): Promise<"enable" | "once" | "disable" | undefined>;
  notify(
    key: string,
    updates: PublishedUpdates,
    eligibleCore: boolean,
    installed: {
      core: string | null;
      extension: string;
      channel: "stable" | "preview";
    },
  ): Promise<"core" | "extension" | "later" | "skip" | "disable" | undefined>;
  information(message: string): void;
  updateCore(
    key: string,
    identity: UpdateProjectIdentity,
    version: string,
    permissionCurrent: () => boolean,
  ): Promise<void>;
  openRelease(version: string): Promise<void>;
  openCoreRelease(version: string): Promise<void>;
}
function savedState(value: unknown): AdvisoryState {
  try {
    const s = object(value);
    if (
      typeof s.offered !== "boolean" ||
      typeof s.enabled !== "boolean" ||
      !Number.isSafeInteger(s.checkedAt) ||
      Number(s.checkedAt) < 0 ||
      !Number.isSafeInteger(s.deferredUntil) ||
      Number(s.deferredUntil) < 0 ||
      !(s.skippedCore === null || isPublishedVersion(s.skippedCore)) ||
      !(s.skippedExtension === null || isPublishedVersion(s.skippedExtension))
    )
      return initial;
    return {
      offered: s.offered,
      enabled: s.enabled,
      checkedAt: Number(s.checkedAt),
      deferredUntil: Number(s.deferredUntil),
      skippedCore: s.skippedCore as string | null,
      skippedExtension: s.skippedExtension as string | null,
    };
  } catch {
    return initial;
  }
}
/** One opening-session check per workspace; no recurring timer, polling or silent install. */
export class UpdateAdvisoryController {
  private readonly seen = new Set<string>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly aborts = new Map<string, { cancel(): void }>();
  private readonly once = new Set<string>();
  private disposed = false;
  constructor(
    private readonly host: UpdateAdvisoryHost,
    private readonly extensionVersion: string,
    private readonly preview: boolean,
    private readonly request: (
      kind: keyof typeof UPDATE_METADATA_URLS,
      signal: AbortSignal,
    ) => Promise<unknown> = fetchUpdateMetadata,
    private readonly now: () => number = Date.now,
  ) {}
  open(key: string): Promise<void> {
    if (this.seen.has(key) || !this.allowed(key)) return Promise.resolve();
    this.seen.add(key);
    return this.check(key, false);
  }
  check(key: string, manual = true): Promise<void> {
    if (!this.allowed(key)) return Promise.resolve();
    const current = this.running.get(key);
    if (current) return current;
    const pending = this.perform(key, manual, this.once.delete(key))
      .catch(() => {
        if (this.allowed(key))
          this.host.extensionRelease?.(key, {
            status: "unknown",
            latestVersion: null,
            checkedAt: null,
            channel: this.preview ? "preview" : "stable",
          });
        if (manual && this.allowed(key))
          this.host.information(
            "Update availability is unknown. Nothing was changed; try again later.",
          );
      })
      .finally(() => {
        this.running.delete(key);
        this.aborts.delete(key);
      });
    this.running.set(key, pending);
    return pending;
  }
  async configure(key: string): Promise<void> {
    if (!this.allowed(key)) return;
    const choice = await this.host.consent(key, true);
    if (!this.allowed(key)) return;
    const state = savedState(this.host.load(key));
    await this.host.save(key, {
      ...state,
      offered: true,
      enabled: choice === "enable",
    });
    if (choice === "once") this.once.add(key);
    if (choice === "enable" || choice === "once") {
      await this.running.get(key);
      await this.check(key, true);
    }
  }
  remove(key: string): void {
    const abort = this.aborts.get(key);
    this.aborts.delete(key);
    abort?.cancel();
    this.seen.delete(key);
    this.once.delete(key);
  }
  dispose(): void {
    this.disposed = true;
    for (const abort of this.aborts.values()) abort.cancel();
    this.aborts.clear();
    this.seen.clear();
    this.once.clear();
  }
  private allowed(key: string) {
    return !this.disposed && this.host.allowed(key);
  }
  private async perform(key: string, manual: boolean, once = false) {
    let state = savedState(this.host.load(key));
    let permitted = state.enabled || once;
    if (!permitted && (manual || !state.offered)) {
      state = { ...state, offered: true };
      await this.host.save(key, state);
      if (!this.allowed(key)) return;
      const choice = await this.host.consent(key, manual);
      if (
        !this.allowed(key) ||
        JSON.stringify(savedState(this.host.load(key))) !==
          JSON.stringify(state)
      )
        return;
      permitted = choice === "enable" || choice === "once";
      state = { ...state, enabled: choice === "enable" };
      await this.host.save(key, state);
    }
    if (
      !permitted ||
      !this.allowed(key) ||
      (!manual &&
        (this.now() < state.deferredUntil ||
          (state.checkedAt > 0 && this.now() - state.checkedAt < DAY)))
    )
      return;
    const identity = await this.host.identify(key);
    if (
      !this.allowed(key) ||
      JSON.stringify(savedState(this.host.load(key))) !== JSON.stringify(state)
    )
      return;
    state = { ...state, checkedAt: this.now() };
    await this.host.save(key, state);
    const sameState = () =>
      this.allowed(key) &&
      JSON.stringify(savedState(this.host.load(key))) === JSON.stringify(state);
    if (!sameState()) return;
    const abort = new AbortController();
    let cancelledByOwner = false;
    this.aborts.set(key, {
      cancel: () => {
        cancelledByOwner = true;
        abort.abort();
      },
    });
    const unchanged = () => sameState() && !cancelledByOwner;
    this.host.extensionRelease?.(key, {
      status: "checking",
      latestVersion: null,
      checkedAt: null,
      channel: this.preview ? "preview" : "stable",
    });
    let timeout: ReturnType<typeof setTimeout>;
    let cancelled: () => void;
    let stoppedBy: "deadline" | "cancelled" | null = null;
    // A fulfilled stop signal remains safe even if native progress delays its task.
    const deadline = new Promise<void>((resolve) => {
      cancelled = () => {
        stoppedBy ??= "cancelled";
        clearTimeout(timeout);
        resolve();
      };
      abort.signal.addEventListener("abort", cancelled, { once: true });
      timeout = setTimeout(() => {
        stoppedBy = "deadline";
        abort.abort();
      }, 5_000);
    });
    let core: string | null = null,
      extension: string | null = null;
    const needsCore = Boolean(
      identity.version && identity.origin === "registry",
    );
    const needsPreview = needsCore && Boolean(identity.version?.includes("-"));
    let unknownChannel = false;
    try {
      const values = await this.host.checking(async () => {
        if (!unchanged()) return null;
        const settled: (PromiseSettledResult<unknown> | undefined)[] = [];
        if (abort.signal.aborted)
          return stoppedBy === "deadline" ? settled : null;
        const collect = (
          index: number,
          kind: keyof typeof UPDATE_METADATA_URLS,
        ): Promise<void> => {
          if (!unchanged() || abort.signal.aborted) return Promise.resolve();
          try {
            return Promise.resolve(this.request(kind, abort.signal)).then(
              (value) => {
                if (!abort.signal.aborted)
                  settled[index] = { status: "fulfilled", value };
              },
              () => {
                if (!abort.signal.aborted)
                  settled[index] = { status: "rejected", reason: null };
              },
            );
          } catch {
            settled[index] = { status: "rejected", reason: null };
            return Promise.resolve();
          }
        };
        await Promise.race([
          Promise.all([
            needsCore ? collect(0, "core") : Promise.resolve(),
            collect(1, "extension"),
            needsPreview ? collect(2, "corePreview") : Promise.resolve(),
          ]),
          deadline,
        ]);
        // Late completions cannot add facts after the shared deadline.
        return settled.slice();
      });
      if (
        values === null ||
        !unchanged() ||
        (abort.signal.aborted && stoppedBy !== "deadline")
      )
        return;
      let knownCore = !needsCore,
        knownPreview = !needsPreview,
        knownExtension = false;
      if (values[0]?.status === "fulfilled" && values[0].value !== null) {
        try {
          core = parseCoreUpdate(values[0].value);
          knownCore = true;
        } catch {}
      }
      if (values[2]?.status === "fulfilled" && values[2].value !== null) {
        try {
          const candidate = parseCoreUpdate(values[2].value);
          knownPreview = true;
          if (core === null || comparePublishedVersions(candidate, core)! > 0)
            core = candidate;
        } catch {}
      }
      if (values[1]?.status === "fulfilled") {
        try {
          extension = parseExtensionUpdate(values[1].value, this.preview);
          knownExtension = extension !== null;
        } catch {}
      }
      unknownChannel = !knownCore || !knownPreview || !knownExtension;
    } finally {
      clearTimeout(timeout!);
      abort.signal.removeEventListener("abort", cancelled!);
      // A failed progress host may leave its task pending; retire only our requests.
      abort.abort();
      if (!unchanged() && this.allowed(key))
        this.host.extensionRelease?.(key, {
          status: "unknown",
          latestVersion: null,
          checkedAt: null,
          channel: this.preview ? "preview" : "stable",
        });
    }
    if (!unchanged()) return;
    const current = await this.host.identify(key);
    if (!unchanged() || current.fingerprint !== identity.fingerprint) {
      if (this.allowed(key))
        this.host.extensionRelease?.(key, {
          status: "unknown",
          latestVersion: null,
          checkedAt: null,
          channel: this.preview ? "preview" : "stable",
        });
      if (manual && this.allowed(key))
        this.host.information(
          "The installed project changed during the check. Check for updates again; nothing was changed.",
        );
      return;
    }
    this.host.extensionRelease?.(key, {
      status: extension === null ? "unknown" : "checked",
      latestVersion: extension,
      checkedAt: extension === null ? null : this.now(),
      channel: this.preview ? "preview" : "stable",
    });
    const newerCore =
      core &&
      identity.version &&
      identity.origin === "registry" &&
      comparePublishedVersions(core, identity.version) === 1 &&
      (identity.version.includes("-") || !core.includes("-")) &&
      (manual || state.skippedCore !== core)
        ? core
        : null;
    const newerExtension =
      extension &&
      comparePublishedVersions(extension, this.extensionVersion) === 1 &&
      (manual || state.skippedExtension !== extension)
        ? extension
        : null;
    if (!newerCore && !newerExtension) {
      if (manual)
        this.host.information(
          identity.origin !== "registry"
            ? `No install was changed. Custom, candidate or unverified core installations need manual review; ${unknownChannel ? "extension update availability remains unknown." : "the extension release check is complete."}`
            : unknownChannel
              ? "Some update availability remains unknown. No newer release was confirmed from available metadata. Nothing was changed; try again later."
              : "No newer eligible Rehearsal release was found. Compatibility and update availability are separate checks.",
        );
      return;
    }
    const eligibleCore =
      newerCore !== null &&
      identity.dependencyGroup !== null &&
      isEligibleCoreUpdate(identity.version!, newerCore);
    const choice = await this.host.notify(
      key,
      { core: newerCore, extension: newerExtension },
      eligibleCore,
      {
        core: identity.version,
        extension: this.extensionVersion,
        channel: this.preview ? "preview" : "stable",
      },
    );
    if (!unchanged()) return;
    if (choice === "disable") state = { ...state, enabled: false };
    else if (choice === "skip")
      state = {
        ...state,
        skippedCore: newerCore,
        skippedExtension: newerExtension,
      };
    else if (choice === "later" || choice === undefined)
      state = { ...state, deferredUntil: this.now() + DAY };
    await this.host.save(key, state);
    if (!unchanged()) return;
    if (choice === "core" && newerCore) {
      const latest = await this.host.identify(key);
      if (unchanged() && latest.fingerprint === identity.fingerprint) {
        if (eligibleCore)
          await this.host.updateCore(key, identity, newerCore, unchanged);
        else await this.host.openCoreRelease(newerCore);
      } else if (this.allowed(key))
        this.host.information(
          "The project changed. Check for updates again before reviewing an install.",
        );
    } else if (choice === "extension" && newerExtension)
      await this.host.openRelease(newerExtension);
  }
}
