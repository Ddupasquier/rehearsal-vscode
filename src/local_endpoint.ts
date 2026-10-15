/** One authority for user-entered local endpoints; never accept credential-bearing URLs. */
export const parseLocalEndpoint = (value: unknown): URL => {
  if (
    typeof value !== "string" ||
    value.length > 500 ||
    /[\u0000-\u0020]/u.test(value)
  )
    throw new Error("Use a bounded HTTP(S) localhost or loopback address.");
  if (
    !/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/iu.test(
      value,
    )
  )
    throw new Error(
      "Use an explicit localhost, 127.0.0.1, or [::1] loopback host.",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Enter a complete local URL, including http:// or https://.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTP(S) loopback URL without credentials, query strings, or fragments.",
    );
  const effectivePort = Number(
    url.port || (url.protocol === "https:" ? 443 : 80),
  );
  if (
    !Number.isInteger(effectivePort) ||
    effectivePort < 1024 ||
    effectivePort > 65535
  )
    throw new Error("Use a non-privileged local port from 1024 to 65535.");
  return url;
};

export const isLocalEndpoint = (value: unknown): boolean => {
  try {
    parseLocalEndpoint(value);
    return true;
  } catch {
    return false;
  }
};
