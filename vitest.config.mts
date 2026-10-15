import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // Keep local editor tests from competing with database acceptance workloads.
    maxWorkers: 2,
  },
});
