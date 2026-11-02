/** Self-contained for the packaged controller. Defaults are not edit instructions. */
export const changedConfigurationFormValues = (
  initial: Readonly<Record<string, string>>,
  current: Readonly<Record<string, string>>,
): Record<string, string> => {
  const semantic = (name: string, value: string): string | number => {
    if (name === "retainBaselineGenerations" && value.trim() !== "") {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    if (name === "applicationUrl") {
      try {
        return new URL(value).toString().replace(/\/$/u, "");
      } catch {
        // Invalid changed values still reach the host's authoritative validation.
      }
    }
    return value;
  };
  return Object.fromEntries(
    Object.entries(current).filter(
      ([name, value]) =>
        Object.hasOwn(initial, name) &&
        semantic(name, value) !== semantic(name, initial[name]!),
    ),
  );
};
