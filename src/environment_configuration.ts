/** Friendly labels and protection are literals; technical ownership remains unchanged. */
import { editLiteralConfiguration } from "./literal_configuration.js";
export const editEnvironmentConfiguration = (
  source: string,
  values: { displayName?: string; protected?: boolean },
): string =>
  editLiteralConfiguration(
    source,
    Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({ path: `runtime.${key}`, value })),
  );
