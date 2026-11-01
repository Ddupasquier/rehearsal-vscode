import { describe, expect, it } from "vitest";
import {
  isLocalEndpoint,
  parseLocalEndpoint,
} from "../../src/runtime/local_endpoint.js";
describe("reviewed local endpoints", () => {
  it("supports local IPv4, IPv6, HTTPS, and callback paths", () => {
    for (const url of [
      "http://localhost:5175/auth/callback",
      "http://127.0.0.1:1024",
      "https://[::1]:65535/app",
    ])
      expect(parseLocalEndpoint(url).toString()).toBe(new URL(url).toString());
  });
  it.each([
    ["HTTP://LOCALHOST:05175/a/../app", "http://localhost:5175/app"],
    ["https://LOCALHOST:01024/./app", "https://localhost:1024/app"],
    ["http://[::1]:65535", "http://[::1]:65535/"],
    ["http://localhost:5175/a%3Fb%23c", "http://localhost:5175/a%3Fb%23c"],
  ])("normalizes a reviewed explicit local endpoint %s", (input, expected) => {
    expect(parseLocalEndpoint(input).toString()).toBe(expected);
  });
  it("bounds the input without converting invalid values to strings", () => {
    const longest = "http://localhost:5175/".padEnd(500, "a");
    expect(parseLocalEndpoint(longest).toString()).toBe(longest);
    for (const value of [
      `${longest}a`,
      undefined,
      null,
      5175,
      new URL("http://localhost:5175"),
      { toString: () => "http://localhost:5175" },
    ])
      expect(isLocalEndpoint(value)).toBe(false);
  });
  it("rejects hosted, credentials, secret query strings, fragments and privileged/invalid ports", () => {
    for (const url of [
      "https://example.com",
      "http://localhost.evil:5175",
      "http://user:password@localhost:5175",
      "http://localhost:5175/?token=secret",
      "http://localhost:5175/#token",
      "http://localhost:5175/?",
      "http://localhost:5175/#",
      "file:///tmp/app",
      "http://localhost:22",
      "http://localhost:80",
      "https://localhost:443",
      "http://localhost",
      "http://localhost:65536",
      "http://localhost:0",
      "http://localhost:1023",
      "http://localhost:00080",
      "https://localhost:00443",
      "http://localhost:/app",
      "http://localhost:5175/\n",
      "http://2130706433:5175",
      "http://127.1:5175",
      "http://127.000.0.1:5175",
      "http://[0:0:0:0:0:0:0:1]:5175",
      "http://localhost.:5175",
      "http://localhost%2eevil:5175",
      "http://localhost:5175@evil.example/app",
      "http://localhost:5175\\@evil.example/app",
    ])
      expect(isLocalEndpoint(url)).toBe(false);
  });
  it.each([
    "\0",
    "\t",
    "\r",
    "\n",
    "\u007f",
    "\u0085",
    "\u009f",
    "\u2028",
    "\u2029",
  ])(
    "refuses a raw control or line separator without exposing the input",
    (control) => {
      const input = `http://localhost:5175/PRIVATE_CANARY${control}`;
      expect(isLocalEndpoint(input)).toBe(false);
      try {
        parseLocalEndpoint(input);
        throw new Error("Expected a refusal.");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(String(error)).not.toContain("PRIVATE_CANARY");
        expect(String(error)).not.toContain(input);
      }
    },
  );
});
