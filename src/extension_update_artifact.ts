/** Verified public release bytes only. Never writes files, extracts or installs. */
import { createHash, timingSafeEqual } from "node:crypto";
import { crc32, inflateRawSync } from "node:zlib";
import {
  comparePublishedVersions,
  isPublishedVersion,
} from "./update_advisory.js";

export const EXTENSION_UPDATE_LIMITS = Object.freeze({
  archiveBytes: 8 * 1024 * 1024,
  checksumBytes: 8 * 1024,
  entryBytes: 4 * 1024 * 1024,
  manifestBytes: 256 * 1024,
  uncompressedBytes: 32 * 1024 * 1024,
  entries: 512,
  timeoutMilliseconds: 30_000,
});
const UNAVAILABLE =
  "The official extension update could not be safely verified. Use the reviewed GitHub release or try again later.";
const fail = (): never => {
  throw new Error(UNAVAILABLE);
};
export interface ExtensionUpdateRuntime {
  readonly vscodeVersion: string;
  readonly nodeVersion: string;
}
export interface VerifiedExtensionManifest {
  readonly publisher: "rehearsal-db";
  readonly name: "rehearsal";
  readonly version: string;
  readonly engines: { readonly vscode: string; readonly node: string };
}
export interface VerifiedExtensionUpdate {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly manifest: VerifiedExtensionManifest;
}
const releaseAssets = (version: string) => {
  if (!isPublishedVersion(version)) return fail();
  const filename = `rehearsal-${version}.vsix`;
  const base = `https://github.com/Ddupasquier/rehearsal-vscode/releases/download/v${version}/`;
  return { filename, archive: base + filename, checksums: base + "SHA256SUMS" };
};
const decode = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail();

const requiredFiles = new Set([
  "[Content_Types].xml",
  "extension.vsixmanifest",
  "extension/package.json",
  "extension/dist/src/extension.js",
  "extension/readme.md",
  "extension/LICENSE.txt",
  "extension/PRIVACY.md",
  "extension/SECURITY.md",
  "extension/SUPPORT.md",
  "extension/changelog.md",
  "extension/media/rehearsal.svg",
  "extension/media/rehearsal-readme.png",
  "extension/media/workspace.css",
]);

/** ZIP32 only: verify every entry without extraction or trusting advertised sizes. */
const inspectArchive = (bytes: Uint8Array): Map<string, Buffer> => {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bounded = (offset: number, length: number) => {
    if (offset < 0 || length < 0 || offset + length > zip.length) fail();
  };
  let end = zip.length - 22;
  for (; end >= Math.max(0, zip.length - 65_557); end--)
    if (
      zip.readUInt32LE(end) === 0x06054b50 &&
      end + 22 + zip.readUInt16LE(end + 20) === zip.length
    )
      break;
  if (end < Math.max(0, zip.length - 65_557)) return fail();
  const count = zip.readUInt16LE(end + 10);
  const centralSize = zip.readUInt32LE(end + 12);
  const centralOffset = zip.readUInt32LE(end + 16);
  if (
    zip.readUInt16LE(end + 4) !== 0 ||
    zip.readUInt16LE(end + 6) !== 0 ||
    zip.readUInt16LE(end + 8) !== count ||
    count < 1 ||
    count > EXTENSION_UPDATE_LIMITS.entries ||
    centralOffset + centralSize !== end
  )
    return fail();
  const entries = new Map<string, Buffer>();
  const canonicalNames = new Set<string>();
  const spans: [number, number][] = [];
  let total = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index++) {
    bounded(cursor, 46);
    if (zip.readUInt32LE(cursor) !== 0x02014b50) return fail();
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const crc = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameSize = zip.readUInt16LE(cursor + 28);
    const extraSize = zip.readUInt16LE(cursor + 30);
    const commentSize = zip.readUInt16LE(cursor + 32);
    const mode = (zip.readUInt32LE(cursor + 38) >>> 16) & 0xf000;
    const local = zip.readUInt32LE(cursor + 42);
    bounded(cursor + 46, nameSize + extraSize + commentSize);
    const nameBytes = zip.subarray(cursor + 46, cursor + 46 + nameSize);
    const name = decode(nameBytes);
    if (
      // Only UTF-8 names and an optional data descriptor are supported.
      (flags & ~0x0808) !== 0 ||
      ![0, 8].includes(method) ||
      extraSize !== 0 ||
      zip.readUInt16LE(cursor + 34) !== 0 ||
      (mode !== 0 && mode !== 0x8000) ||
      (zip.readUInt32LE(cursor + 38) & 0x10) !== 0 ||
      !nameSize ||
      nameSize > 500 ||
      /[\\\x00-\x1f\x7f]/u.test(name) ||
      name.split("/").some((part) => part === "." || part === ".." || !part) ||
      canonicalNames.has(name.toLowerCase()) ||
      (!requiredFiles.has(name) &&
        !/^extension\/dist\/src\/[a-z][a-z0-9_]*\.js$/u.test(name)) ||
      size > EXTENSION_UPDATE_LIMITS.entryBytes ||
      ((name === "extension/package.json" ||
        name === "extension.vsixmanifest") &&
        size > EXTENSION_UPDATE_LIMITS.manifestBytes)
    )
      return fail();
    total += size;
    if (total > EXTENSION_UPDATE_LIMITS.uncompressedBytes) return fail();
    bounded(local, 30);
    const localNameSize = zip.readUInt16LE(local + 26);
    const localExtraSize = zip.readUInt16LE(local + 28);
    const dataOffset = local + 30 + localNameSize + localExtraSize;
    bounded(local + 30, localNameSize + localExtraSize + compressedSize);
    if (
      zip.readUInt32LE(local) !== 0x04034b50 ||
      zip.readUInt16LE(local + 6) !== flags ||
      zip.readUInt16LE(local + 8) !== method ||
      localExtraSize !== 0 ||
      !zip.subarray(local + 30, local + 30 + localNameSize).equals(nameBytes) ||
      (!(flags & 8) &&
        (zip.readUInt32LE(local + 14) !== crc ||
          zip.readUInt32LE(local + 18) !== compressedSize ||
          zip.readUInt32LE(local + 22) !== size)) ||
      ((flags & 8) !== 0 &&
        [14, 18, 22].some((offset) => zip.readUInt32LE(local + offset) !== 0))
    )
      return fail();
    let finish = dataOffset + compressedSize;
    if (flags & 8) {
      bounded(finish, 12);
      const descriptor =
        zip.readUInt32LE(finish) === 0x08074b50 ? finish + 4 : finish;
      bounded(descriptor, 12);
      if (
        zip.readUInt32LE(descriptor) !== crc ||
        zip.readUInt32LE(descriptor + 4) !== compressedSize ||
        zip.readUInt32LE(descriptor + 8) !== size
      )
        return fail();
      finish = descriptor + 12;
    }
    if (finish > centralOffset) return fail();
    spans.push([local, finish]);
    const compressed = zip.subarray(dataOffset, dataOffset + compressedSize);
    const data =
      method === 0
        ? compressed
        : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
    if (data.byteLength !== size || crc32(data) !== crc) return fail();
    entries.set(name, data);
    canonicalNames.add(name.toLowerCase());
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  if (cursor !== end) return fail();
  spans.sort((a, b) => a[0] - b[0]);
  if (
    spans[0]?.[0] !== 0 ||
    spans.at(-1)?.[1] !== centralOffset ||
    spans.some(
      (span, index) => index > 0 && spans[index - 1]![1] !== span[0],
    ) ||
    [...requiredFiles].some((name) => !entries.has(name))
  )
    return fail();
  return entries;
};

const verifyManifest = (
  entries: Map<string, Buffer>,
  version: string,
  runtime: ExtensionUpdateRuntime,
): VerifiedExtensionManifest => {
  const data = object(
    JSON.parse(decode(entries.get("extension/package.json")!)),
  );
  const engines = object(data.engines);
  const vscode =
    typeof engines.vscode === "string"
      ? /^\^(1\.\d+\.\d+)$/u.exec(engines.vscode)?.[1]
      : null;
  const node =
    typeof engines.node === "string"
      ? /^>=(\d+) <(\d+)$/u.exec(engines.node)
      : null;
  if (
    data.publisher !== "rehearsal-db" ||
    data.name !== "rehearsal" ||
    data.version !== version ||
    data.main !== "./dist/src/extension.js" ||
    data.browser !== undefined ||
    !vscode ||
    !isPublishedVersion(vscode) ||
    !isPublishedVersion(runtime.vscodeVersion) ||
    runtime.vscodeVersion.split(".")[0] !== "1" ||
    comparePublishedVersions(runtime.vscodeVersion, vscode) === -1 ||
    !node ||
    !isPublishedVersion(runtime.nodeVersion) ||
    runtime.nodeVersion.includes("-") ||
    Number(runtime.nodeVersion.split(".")[0]) < Number(node[1]) ||
    Number(runtime.nodeVersion.split(".")[0]) >= Number(node[2]) ||
    !Number.isSafeInteger(Number(node[1])) ||
    !Number.isSafeInteger(Number(node[2])) ||
    Number(node[1]) >= Number(node[2]) ||
    ["extensionDependencies", "extensionPack"].some(
      (key) =>
        data[key] !== undefined &&
        (!Array.isArray(data[key]) || data[key].length !== 0),
    ) ||
    (data.scripts !== undefined &&
      Object.keys(object(data.scripts)).some((name) =>
        /^(?:preinstall|install|postinstall|prepare|prepublish|prepublishOnly|prepack|postpack|vscode:prepublish)$/u.test(
          name,
        ),
      ))
  )
    return fail();
  const xml = decode(entries.get("extension.vsixmanifest")!);
  if (/<!/u.test(xml)) return fail();
  const identities = [...xml.matchAll(/<Identity\b([^<>]*)\/\s*>/gu)];
  if (
    identities.length !== 1 ||
    [...xml.matchAll(/<(?:[A-Za-z][\w.-]*:)?Identity\b/gu)].length !== 1
  )
    return fail();
  const xmlAttributes = (source: string) => {
    const attributes = new Map<string, string>();
    for (const match of source.matchAll(
      /([A-Za-z][A-Za-z0-9_.:-]*)="([^"<>]*)"/gu,
    )) {
      if (attributes.has(match[1]!)) return fail();
      attributes.set(match[1]!, match[2]!);
    }
    if (source.replace(/[A-Za-z][A-Za-z0-9_.:-]*="[^"<>]*"/gu, "").trim())
      return fail();
    return attributes;
  };
  const attributes = xmlAttributes(identities[0]![1]!);
  if (
    attributes.get("Publisher") !== "rehearsal-db" ||
    attributes.get("Id") !== "rehearsal" ||
    attributes.get("Version") !== version ||
    (attributes.has("TargetPlatform") &&
      attributes.get("TargetPlatform") !== "universal")
  )
    return fail();
  const properties = [...xml.matchAll(/<Property\b([^<>]*)\/\s*>/gu)];
  if (properties.length !== [...xml.matchAll(/<Property\b/gu)].length)
    return fail();
  const seenProperties = new Set<string>();
  for (const property of properties) {
    const value = xmlAttributes(property[1]!);
    const id = value.get("Id");
    if (!id || seenProperties.has(id)) return fail();
    seenProperties.add(id);
    if (
      (id === "Microsoft.VisualStudio.Code.Engine" &&
        value.get("Value") !== engines.vscode) ||
      ([
        "Microsoft.VisualStudio.Code.ExtensionDependencies",
        "Microsoft.VisualStudio.Code.ExtensionPack",
      ].includes(id) &&
        value.get("Value") !== "")
    )
      return fail();
  }
  return {
    publisher: "rehearsal-db",
    name: "rehearsal",
    version,
    engines: { vscode: engines.vscode as string, node: engines.node as string },
  };
};

export const validateExtensionUpdateArtifact = (
  bytes: Uint8Array,
  version: string,
  sha256: string,
  runtime: ExtensionUpdateRuntime,
): VerifiedExtensionUpdate => {
  try {
    releaseAssets(version);
    if (
      bytes.byteLength < 22 ||
      bytes.byteLength > EXTENSION_UPDATE_LIMITS.archiveBytes ||
      !/^[a-f0-9]{64}$/u.test(sha256)
    )
      return fail();
    const actual = createHash("sha256").update(bytes).digest();
    if (!timingSafeEqual(actual, Buffer.from(sha256, "hex"))) return fail();
    const manifest = verifyManifest(inspectArchive(bytes), version, runtime);
    return { bytes, sha256, manifest };
  } catch {
    return fail();
  }
};

const abortable = async <T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> => {
  if (signal.aborted) {
    void pending.catch(() => {});
    return fail();
  }
  let cancel: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(new Error(UNAVAILABLE));
    signal.addEventListener("abort", cancel, { once: true });
  });
  try {
    return await Promise.race([pending, aborted]);
  } finally {
    if (cancel) signal.removeEventListener("abort", cancel);
  }
};
const fetchAsset = async (
  initial: string,
  maximumBytes: number,
  signal: AbortSignal,
  fetchImplementation: typeof fetch,
): Promise<Uint8Array> => {
  const requestOptions: NonNullable<Parameters<typeof fetch>[1]> & {
    cache: "no-store";
    referrerPolicy: "no-referrer";
  } = {
    signal,
    redirect: "manual",
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: {
      Accept: "application/octet-stream",
      "Accept-Encoding": "identity",
    },
  };
  let url = initial;
  for (let hop = 0; hop <= 1; hop++) {
    if (signal.aborted) return fail();
    const response = await abortable(
      fetchImplementation(url, requestOptions),
      signal,
    );
    if (response.redirected || response.url !== url) {
      void response.body?.cancel().catch(() => {});
      return fail();
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      void response.body?.cancel().catch(() => {});
      if (hop !== 0 || !location || location.length > 8192) return fail();
      const next = new URL(location);
      if (
        next.protocol !== "https:" ||
        next.hostname !== "release-assets.githubusercontent.com" ||
        next.username ||
        next.password ||
        next.port ||
        next.hash
      )
        return fail();
      url = next.toString();
      continue;
    }
    const mime = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const declared = response.headers.get("content-length");
    if (
      response.status !== 200 ||
      !response.body ||
      ![null, "identity"].includes(response.headers.get("content-encoding")) ||
      !["application/octet-stream", "application/zip", "text/plain"].includes(
        mime ?? "",
      ) ||
      (declared !== null &&
        (!/^\d+$/u.test(declared) || Number(declared) > maximumBytes))
    ) {
      void response.body?.cancel().catch(() => {});
      return fail();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      for (;;) {
        const next = await abortable(reader.read(), signal);
        if (next.done) break;
        count += next.value.byteLength;
        if (count > maximumBytes) return fail();
        chunks.push(next.value);
      }
      if (declared !== null && Number(declared) !== count) return fail();
      const bytes = new Uint8Array(count);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    } finally {
      void reader.cancel().catch(() => {});
    }
  }
  return fail();
};

export const downloadVerifiedExtensionUpdate = async (
  version: string,
  signal: AbortSignal,
  options: ExtensionUpdateRuntime & {
    readonly fetchImplementation?: typeof fetch;
  },
): Promise<VerifiedExtensionUpdate> => {
  const boundedSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(EXTENSION_UPDATE_LIMITS.timeoutMilliseconds),
  ]);
  try {
    const assets = releaseAssets(version);
    const fetchImplementation = options.fetchImplementation ?? fetch;
    const checksum = decode(
      await fetchAsset(
        assets.checksums,
        EXTENSION_UPDATE_LIMITS.checksumBytes,
        boundedSignal,
        fetchImplementation,
      ),
    );
    const lines = checksum.split(/\r?\n/u).filter((line) => line.length > 0);
    const match =
      lines.length === 1
        ? /^([a-f0-9]{64}) [ *]([^\r\n]+)$/u.exec(lines[0]!)
        : null;
    if (!match || match[2] !== assets.filename) return fail();
    const bytes = await fetchAsset(
      assets.archive,
      EXTENSION_UPDATE_LIMITS.archiveBytes,
      boundedSignal,
      fetchImplementation,
    );
    if (boundedSignal.aborted) return fail();
    return validateExtensionUpdateArtifact(bytes, version, match[1]!, options);
  } catch {
    return fail();
  }
};
