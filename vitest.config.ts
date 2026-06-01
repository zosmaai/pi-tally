import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Exclude smoke-live.mjs which requires a running TallyPrime
    exclude: ["node_modules", "test/smoke-live.mjs"],
    environment: "node",
    testTimeout: 10000,
  },
});
