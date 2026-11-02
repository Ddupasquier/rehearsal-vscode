import { describe, expect, it } from "vitest";
import {
  nativeZshInitialization,
  nativeCandidateForScenario,
  nativeCandidateShaForScenario,
  nativeLeasedPorts,
  selectNativeScenario,
} from "../../scripts/native/verify-native-cancellation.js";

describe("isolated native terminal integration", () => {
  const integration =
    "/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/workbench/contrib/terminal/common/scripts/shellIntegration-rc.zsh";
  it("sources only the official selected-app script in VS Code terminals", () => {
    expect(nativeZshInitialization(integration)).toBe(
      `[[ "$TERM_PROGRAM" == "vscode" ]] && source '${integration}'\n`,
    );
  });
  it.each(["/tmp/other.zsh", "$(touch PRIVATE_CANARY)", `${integration}\n`])(
    "refuses another script without evaluating it",
    (value) => {
      expect(() => nativeZshInitialization(value)).toThrow(
        "Shell integration must come from the selected installed VS Code application",
      );
    },
  );
});

describe("native companion scenario selection", () => {
  it("preserves cancellation as the default", () => {
    expect(selectNativeScenario()).toBe("cancellation");
    expect(selectNativeScenario(undefined)).toBe("cancellation");
  });
  it.each([
    "cancellation",
    "workbench-review",
    "presentation-review",
    "configuration-guidance",
    "comparison-export",
  ])("accepts the fixed %s scenario", (value) => {
    expect(selectNativeScenario(value)).toBe(value);
  });
  const rejectedInputs: unknown[] = [
    "",
    "../PRIVATE_CANARY.cjs",
    "/tmp/PRIVATE_CANARY.cjs",
    "./native-cancellation-test.cjs",
    "constructor",
    "toString",
    "CANCELLATION",
    null,
    [],
    {},
  ];
  it.each(rejectedInputs.map((value) => [value]))(
    "rejects unreviewed scenario input without echoing it",
    (value) => {
      expect(() => selectNativeScenario(value)).toThrow(
        "Native scenario must be cancellation, workbench-review, presentation-review, configuration-guidance or comparison-export",
      );
      try {
        selectNativeScenario(value);
      } catch (error) {
        expect(String(error)).not.toContain("PRIVATE_CANARY");
      }
    },
  );

  it.each([
    "cancellation",
    "workbench-review",
    "presentation-review",
    "configuration-guidance",
    "comparison-export",
  ] as const)("uses the current exact public artifact for %s", (scenario) => {
    expect(nativeCandidateShaForScenario(scenario)).toBe(
      "468c17f604e65b1f64a726094a652126d1b696754833fb290c58ca4efc96cecd",
    );
    expect(nativeCandidateForScenario(scenario)).toEqual({
      version: "0.1.23",
      sha256: nativeCandidateShaForScenario(scenario),
      distribution: "published",
      numericRefusal: "before-review",
    });
  });

  const historicalPublic =
    "f2682714a037be5e335e471d44cd025af7dc4927f46cc87d8826cf8666c46631";
  const historicalPrivate =
    "efeacf087f1bd2f15222a0e95c1f8add14e3d9ebbff98f34b80d76b9033855e5";
  it.each(["cancellation", "workbench-review", "presentation-review"] as const)(
    "retains the exact historical public artifact only for %s",
    (scenario) => {
      expect(nativeCandidateForScenario(scenario, historicalPublic)).toEqual({
        version: "0.1.22",
        sha256: historicalPublic,
        distribution: "published",
        numericRefusal: "on-apply",
      });
    },
  );
  it("retains the historical private artifact only for configuration guidance", () => {
    expect(
      nativeCandidateForScenario("configuration-guidance", historicalPrivate),
    ).toEqual({
      version: "0.1.22",
      sha256: historicalPrivate,
      distribution: "unreleased-private",
      numericRefusal: "before-review",
    });
    for (const scenario of [
      "cancellation",
      "workbench-review",
      "presentation-review",
    ] as const)
      expect(() =>
        nativeCandidateForScenario(scenario, historicalPrivate),
      ).toThrow("exact reviewed native-companion artifact");
    expect(() =>
      nativeCandidateForScenario("configuration-guidance", historicalPublic),
    ).toThrow("exact reviewed native-companion artifact");
    expect(() =>
      nativeCandidateForScenario("comparison-export", historicalPublic),
    ).toThrow("exact reviewed native-companion artifact");
    expect(() =>
      nativeCandidateForScenario("comparison-export", historicalPrivate),
    ).toThrow("exact reviewed native-companion artifact");
  });
  it.each(
    ["", "PRIVATE_CANARY", "a".repeat(64), null, {}, []].map((value) => [
      value,
    ]),
  )("rejects an unreviewed candidate without echoing input", (sha) => {
    expect(() => nativeCandidateForScenario("cancellation", sha)).toThrow(
      "exact reviewed native-companion artifact",
    );
    try {
      nativeCandidateForScenario("cancellation", sha);
    } catch (error) {
      expect(String(error)).not.toContain("PRIVATE_CANARY");
    }
  });
  it("keeps selected candidate metadata immutable", () => {
    expect(Object.isFrozen(nativeCandidateForScenario("cancellation"))).toBe(
      true,
    );
  });
});

describe("native companion leased ports", () => {
  it.each([1024, 54000, 54352, 65507])(
    "derives both ports from validated leased base %i without a fixed machine port",
    (base) => {
      expect(nativeLeasedPorts(base)).toEqual({
        database: base + 25,
        application: base + 28,
      });
    },
  );
  it.each([0, -1, 1023, 65508, 65535, 54000.5, NaN, Infinity, "54000", null])(
    "rejects a base that cannot safely provide all unprivileged ports",
    (base) => {
      expect(() => nativeLeasedPorts(base)).toThrow(
        "valid unprivileged leased base",
      );
    },
  );
});
