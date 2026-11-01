import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadVerifiedExtensionUpdate,
  EXTENSION_UPDATE_LIMITS,
  validateExtensionUpdateArtifact,
} from "../../src/updates/extension_update_artifact.js";

const version = "0.1.99";
const runtime = { vscodeVersion: "1.110.0", nodeVersion: "24.21.0" };
const base = `https://github.com/Ddupasquier/rehearsal-vscode/releases/download/v${version}/`;
const filename = `rehearsal-db-${version}.vsix`;
const manifest = {
  name: "rehearsal-db",
  publisher: "rehearsal-db",
  version,
  main: "./dist/src/extension.js",
  engines: { vscode: "^1.101.0", node: ">=22 <27" },
  scripts: { build: "tsc" },
};
const xml = `<PackageManifest><Metadata><Identity Language="en-US" Id="rehearsal-db" Version="${version}" Publisher="rehearsal-db" /></Metadata></PackageManifest>`;
const required = [
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
];
interface Entry {
  name: string;
  text: string;
  method?: number;
  descriptor?: boolean;
  flags?: number;
  mode?: number;
  localName?: string;
  extra?: Buffer;
  claimedSize?: number;
  badCrc?: boolean;
}
const fixtureEntries = (patch: Record<string, unknown> = {}): Entry[] =>
  required.map((name) => ({
    name,
    text:
      name === "extension/package.json"
        ? JSON.stringify({ ...manifest, ...patch })
        : name === "extension.vsixmanifest"
          ? xml
          : "synthetic public file",
  }));

/** In-memory ZIP fixtures only: no disk, shell, services or external resources. */
const archive = (entries = fixtureEntries()): Buffer => {
  const locals: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      localName = Buffer.from(entry.localName ?? entry.name);
    const data = Buffer.from(entry.text),
      method = entry.method ?? 8;
    const compressed = method === 0 ? data : deflateRawSync(data);
    const checksum = entry.badCrc ? (crc32(data) + 1) >>> 0 : crc32(data);
    const flags = entry.flags ?? 0x800 | (entry.descriptor ? 8 : 0);
    const size = entry.claimedSize ?? data.byteLength,
      extra = entry.extra ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!(flags & 8)) {
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(size, 22);
    }
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const descriptor = flags & 8 ? Buffer.alloc(16) : Buffer.alloc(0);
    if (flags & 8) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(size, 12);
    }
    const record = Buffer.concat([
      local,
      localName,
      extra,
      compressed,
      descriptor,
    ]);
    locals.push(record);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(0x314, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(size, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(((entry.mode ?? 0x81a4) << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, name, extra]));
    offset += record.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const verify = (bytes: Uint8Array, host = runtime) =>
  validateExtensionUpdateArtifact(bytes, version, digest(bytes), host);
const response = (
  url: string,
  body: string | Uint8Array,
  options: ResponseInit = {},
) => {
  const result = new Response(
    typeof body === "string" ? body : new Uint8Array(body),
    {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
      ...options,
    },
  );
  Object.defineProperty(result, "url", { value: url });
  return result;
};
const transport = (
  bytes = archive(),
  checksum = `${digest(bytes)}  ${filename}\n`,
) =>
  vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    return response(url, url.endsWith("SHA256SUMS") ? checksum : bytes);
  });
afterEach(() => vi.restoreAllMocks());

describe("verified extension ZIP and manifests", () => {
  it("accepts stored/deflated official-shaped runtime files and data descriptors", () => {
    const entries = fixtureEntries();
    entries[0]!.method = 0;
    entries[1]!.descriptor = true;
    const result = verify(archive(entries));
    expect(result.manifest).toEqual({
      name: "rehearsal-db",
      publisher: "rehearsal-db",
      version,
      engines: manifest.engines,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each([
    { publisher: "another-publisher" },
    { name: "another-extension" },
    { name: "rehearsal" },
    { version: "0.1.98" },
    { main: "./alternate.js" },
    { browser: "./web.js" },
    { scripts: { postinstall: "unreviewed command" } },
    { extensionDependencies: ["another.extension"] },
    { extensionPack: ["another.extension"] },
    { engines: { vscode: "*", node: ">=22 <27" } },
    { engines: { vscode: "^1.101.0", node: ">=22" } },
  ])(
    "rejects changed identity or unsupported executable metadata %j",
    (patch) => {
      expect(() => verify(archive(fixtureEntries(patch)))).toThrow(
        "safely verified",
      );
    },
  );

  it("rejects the complete legacy identity even when its JSON and XML agree", () => {
    const entries = fixtureEntries({ name: "rehearsal" });
    entries[1]!.text = xml.replace('Id="rehearsal-db"', 'Id="rehearsal"');
    expect(() => verify(archive(entries))).toThrow("safely verified");
  });

  it.each([
    { vscodeVersion: "1.100.0", nodeVersion: "24.0.0" },
    { vscodeVersion: "2.0.0", nodeVersion: "24.0.0" },
    { vscodeVersion: "1.110.0", nodeVersion: "21.0.0" },
    { vscodeVersion: "1.110.0", nodeVersion: "27.0.0" },
    { vscodeVersion: "unknown", nodeVersion: "24.0.0" },
  ])("fails closed for an incompatible editor/host %j", (host) => {
    expect(() => verify(archive(), host)).toThrow("safely verified");
  });

  it.each([
    "../outside.js",
    "extension/dist/src/../outside.js",
    "extension\\package.json",
    "/extension/package.json",
    "extension/node_modules/dependency/index.js",
    "extension/test-results/private.json",
  ])(
    "rejects traversal and files outside the public runtime allowlist %s",
    (name) => {
      expect(() =>
        verify(archive([...fixtureEntries(), { name, text: "forbidden" }])),
      ).toThrow();
    },
  );

  it("rejects duplicate/case-folded names and local-versus-central name disagreement", () => {
    expect(() =>
      verify(archive([...fixtureEntries(), fixtureEntries()[2]!])),
    ).toThrow();
    expect(() =>
      verify(
        archive([
          ...fixtureEntries(),
          { name: "extension/PACKAGE.json", text: "{}" },
        ]),
      ),
    ).toThrow();
    const entries = fixtureEntries();
    entries[2]!.localName = "extension/alternate.json";
    expect(() => verify(archive(entries))).toThrow();
  });

  it.each([
    { flags: 0x801 },
    { method: 99 },
    { mode: 0xa1ff },
    { badCrc: true },
    { extra: Buffer.from([0x75, 0x70, 0, 0]) },
    { claimedSize: EXTENSION_UPDATE_LIMITS.entryBytes + 1 },
    { claimedSize: 1 },
  ])(
    "rejects encryption, unknown compression, links, bad CRC, extra fields or bombs %j",
    (change) => {
      const entries = fixtureEntries();
      Object.assign(entries[0]!, change);
      expect(() => verify(archive(entries))).toThrow("safely verified");
    },
  );

  it("rejects archive/manifest overflow, missing required files, truncation and digest mismatch", () => {
    expect(() =>
      verify(new Uint8Array(EXTENSION_UPDATE_LIMITS.archiveBytes + 1)),
    ).toThrow();
    const entries = fixtureEntries();
    entries[2]!.text = " ".repeat(EXTENSION_UPDATE_LIMITS.manifestBytes + 1);
    expect(() => verify(archive(entries))).toThrow();
    expect(() => verify(archive(fixtureEntries().slice(1)))).toThrow();
    expect(() => verify(archive().subarray(0, archive().length - 8))).toThrow();
    expect(() =>
      validateExtensionUpdateArtifact(
        archive(),
        version,
        "0".repeat(64),
        runtime,
      ),
    ).toThrow();
  });

  it.each([
    xml.replace('Publisher="rehearsal-db"', 'Publisher="foreign"'),
    xml.replace('Id="rehearsal-db"', 'Id="rehearsal"'),
    xml.replace(`Version="${version}"`, 'Version="0.1.98"'),
    xml.replace("<Identity", "<!DOCTYPE unsafe><Identity"),
    xml.replace("</Metadata>", '<Identity Id="rehearsal" /></Metadata>'),
    `<!--${xml}--><Identity Publisher="foreign"></Identity>`,
  ])("cross-checks the VSIX identity without XML expansion", (text) => {
    const entries = fixtureEntries();
    entries[1]!.text = text;
    expect(() => verify(archive(entries))).toThrow();
  });

  it.each([
    '<Property Id="Microsoft.VisualStudio.Code.Engine" Value="^2.0.0" />',
    '<Property Value="foreign.extension" Id="Microsoft.VisualStudio.Code.ExtensionDependencies" />',
    '<Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="foreign.extension" />',
  ])("refuses conflicting VSIX engine/dependency metadata %s", (property) => {
    const entries = fixtureEntries();
    entries[1]!.text = xml.replace("</Metadata>", `${property}</Metadata>`);
    expect(() => verify(archive(entries))).toThrow();
  });
});

describe("bounded anonymous official release transport", () => {
  it("fetches only the exact fixed checksum/archive pair with no credentials or redirects", async () => {
    const fetchImplementation = transport();
    const result = await downloadVerifiedExtensionUpdate(
      version,
      new AbortController().signal,
      { ...runtime, fetchImplementation },
    );
    expect(result.manifest.version).toBe(version);
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      base + "SHA256SUMS",
      base + filename,
    ]);
    for (const [, init] of fetchImplementation.mock.calls as unknown as [
      string,
      RequestInit,
    ][]) {
      expect(init).toMatchObject({
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/octet-stream",
          "Accept-Encoding": "identity",
        },
      });
      expect(init.headers).not.toHaveProperty("Authorization");
      expect(init.headers).not.toHaveProperty("Cookie");
    }
  });

  it("allows exactly one HTTPS redirect to the fixed GitHub release-assets host", async () => {
    const bytes = archive();
    const fetchImplementation = vi.fn(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (url.startsWith("https://github.com/")) {
          const location = `https://release-assets.githubusercontent.com/github-production-release-asset/123/${url.endsWith("SHA256SUMS") ? "checksums" : "archive"}?signed=fixture`;
          return response(url, "", { status: 302, headers: { location } });
        }
        return response(
          url,
          url.includes("/checksums?")
            ? `${digest(bytes)}  ${filename}\n`
            : bytes,
        );
      },
    );
    const result = await downloadVerifiedExtensionUpdate(
      version,
      new AbortController().signal,
      { ...runtime, fetchImplementation },
    );
    expect(result.sha256).toBe(digest(bytes));
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
  });

  it.each([
    "http://release-assets.githubusercontent.com/a",
    "https://github.com/another/repo/a",
    "https://release-assets.githubusercontent.com.attacker.invalid/a",
    "https://attacker.invalid/a",
    "https://user:password@release-assets.githubusercontent.com/a",
    "https://release-assets.githubusercontent.com:9443/a",
    "https://release-assets.githubusercontent.com/a#fragment",
  ])("rejects an unapproved redirect %s", async (location) => {
    const fetchImplementation = vi.fn(
      async (input: Parameters<typeof fetch>[0]) =>
        response(String(input), "", { status: 302, headers: { location } }),
    );
    await expect(
      downloadVerifiedExtensionUpdate(version, new AbortController().signal, {
        ...runtime,
        fetchImplementation,
      }),
    ).rejects.toThrow("safely verified");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it.each([
    (sha: string) => `${sha}  alternate.vsix\n`,
    (sha: string) => `${sha}  rehearsal-${version}.vsix\n`,
    (sha: string) => `${sha}  ${filename}\n${sha}  ${filename}\n`,
    (sha: string) => `${sha}  ../${filename}\n`,
    () => "invalid checksum",
  ])(
    "refuses missing/duplicate/foreign checksum names before fetching the archive",
    async (checksum) => {
      const bytes = archive(),
        fetchImplementation = transport(bytes, checksum(digest(bytes)));
      await expect(
        downloadVerifiedExtensionUpdate(version, new AbortController().signal, {
          ...runtime,
          fetchImplementation,
        }),
      ).rejects.toThrow();
      expect(fetchImplementation).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { status: 404 },
    { headers: { "content-type": "text/html" } },
    {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": "8193",
      },
    },
    {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": "invalid",
      },
    },
    {
      headers: {
        "content-type": "application/octet-stream",
        "content-encoding": "gzip",
      },
    },
  ])("refuses failed, unsafe or oversized responses %j", async (init) => {
    const fetchImplementation = vi.fn(
      async (input: Parameters<typeof fetch>[0]) =>
        response(String(input), "fixture", init),
    );
    await expect(
      downloadVerifiedExtensionUpdate(version, new AbortController().signal, {
        ...runtime,
        fetchImplementation,
      }),
    ).rejects.toThrow();
  });

  it("enforces actual stream bounds, declared length and one redirect only", async () => {
    for (const fetchImplementation of [
      vi.fn(async (input: Parameters<typeof fetch>[0]) =>
        response(String(input), "x".repeat(8193)),
      ),
      vi.fn(async (input: Parameters<typeof fetch>[0]) =>
        response(String(input), "fixture", {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": "1",
          },
        }),
      ),
      vi.fn(async (input: Parameters<typeof fetch>[0]) =>
        response(String(input), "", {
          status: 302,
          headers: {
            location: "https://release-assets.githubusercontent.com/loop",
          },
        }),
      ),
    ]) {
      await expect(
        downloadVerifiedExtensionUpdate(version, new AbortController().signal, {
          ...runtime,
          fetchImplementation,
        }),
      ).rejects.toThrow();
    }
  });

  it("does not fetch for malformed versions or pre-cancelled work", async () => {
    const fetchImplementation = transport(),
      controller = new AbortController();
    controller.abort();
    await expect(
      downloadVerifiedExtensionUpdate(version, controller.signal, {
        ...runtime,
        fetchImplementation,
      }),
    ).rejects.toThrow();
    await expect(
      downloadVerifiedExtensionUpdate(
        "../unsafe",
        new AbortController().signal,
        { ...runtime, fetchImplementation },
      ),
    ).rejects.toThrow();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("terminates an unresponsive fetch when caller consent is revoked or the deadline expires", async () => {
    for (const timeout of [false, true]) {
      const controller = new AbortController(),
        deadline = new AbortController();
      const fetchImplementation = vi.fn(() => new Promise<Response>(() => {}));
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
      const pending = downloadVerifiedExtensionUpdate(
        version,
        controller.signal,
        { ...runtime, fetchImplementation },
      );
      const assertion = expect(pending).rejects.toThrow("safely verified");
      (timeout ? deadline : controller).abort();
      await assertion;
      expect(AbortSignal.timeout).toHaveBeenCalledWith(30_000);
      vi.restoreAllMocks();
    }
  });

  it("cancels a stalled response body without waiting for a hung stream cleanup", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const result = new Response(stream, {
      headers: { "content-type": "application/octet-stream" },
    });
    Object.defineProperty(result, "url", { value: base + "SHA256SUMS" });
    const fetchImplementation = vi.fn(async () => result);
    const pending = downloadVerifiedExtensionUpdate(
      version,
      controller.signal,
      {
        ...runtime,
        fetchImplementation,
      },
    );
    const rejected = expect(pending).rejects.toThrow("safely verified");
    await vi.waitFor(() => expect(stream.locked).toBe(true));
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not expose raw transport errors, signed URLs or credential-like text", async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error(
        "PRIVATE_CANARY https://release-assets.githubusercontent.com/a?token=private",
      );
    });
    await expect(
      downloadVerifiedExtensionUpdate(version, new AbortController().signal, {
        ...runtime,
        fetchImplementation,
      }),
    ).rejects.toThrow(
      "The official extension update could not be safely verified. Use the reviewed GitHub release or try again later.",
    );
  });
});
