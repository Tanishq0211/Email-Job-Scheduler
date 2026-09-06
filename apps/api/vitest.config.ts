import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    sequence: { concurrent: false },
    // Integration suites share one PostgreSQL/Redis instance, so all
    // files must run sequentially in a single fork.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
