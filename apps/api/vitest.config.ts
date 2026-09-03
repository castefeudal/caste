import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { DATABASE_URL: "postgres://localhost:5432/caste_test", PORT: "0" },
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
