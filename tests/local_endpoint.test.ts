import { describe, expect, it } from "vitest";
import { isLocalEndpoint, parseLocalEndpoint } from "../src/local_endpoint.js";
describe("reviewed local endpoints", () => {
  it("supports local IPv4, IPv6, HTTPS, and callback paths", () => {
    for (const url of [
      "http://localhost:5175/auth/callback",
      "http://127.0.0.1:1024",
      "https://[::1]:65535/app",
    ])
      expect(parseLocalEndpoint(url).toString()).toBe(new URL(url).toString());
  });
  it("rejects hosted, credentials, secret query strings, fragments and privileged/invalid ports", () => {
    for (const url of [
      "https://example.com",
      "http://localhost.evil:5175",
      "http://user:password@localhost:5175",
      "http://localhost:5175/?token=secret",
      "http://localhost:5175/#token",
      "file:///tmp/app",
      "http://localhost:22",
      "http://localhost:80",
      "https://localhost:443",
      "http://localhost",
      "http://localhost:65536",
      "http://localhost:5175/\n",
      "http://2130706433:5175",
    ])
      expect(isLocalEndpoint(url)).toBe(false);
  });
});
