import { describe, expect, it } from "vitest";
import { ClientSecretCredential } from "@azure/identity";
import { version } from "@azure/msal-node";

describe("patched development-only packaging authentication", () => {
  it("loads the exact patched MSAL through the installed toolchain", () => {
    expect(version).toBe("7.1.1");
  });

  it("reaches the synthetic noninteractive credential transport without networking", async () => {
    let blocked = 0;
    const credential = new ClientSecretCredential(
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      "synthetic-fixture-not-a-real-secret",
      {
        disableInstanceDiscovery: true,
        retryOptions: { maxRetries: 0 },
        httpClient: {
          async sendRequest() {
            blocked++;
            throw new Error("Synthetic transport: networking disabled.");
          },
        },
      },
    );
    await expect(
      credential.getToken("https://management.azure.com/.default"),
    ).rejects.toThrow();
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThanOrEqual(3);
  });
});
