import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { DATABASE_URL: "postgres://caste:caste@localhost:5432/caste_test", PORT: "0", VAPID_PUBLIC_KEY: "BHObpTU94BwhkbMICPdRpPRFtpBbOfOM2uUABV7bRMmx8GbpLIl5-l6JIrjvTK76_8qemkHjgl77q17AZXzI8yc", VAPID_PRIVATE_KEY: "B5qw0YZDk9W-wrNZLKkh1VZlF8sj8TDWGo7MXfI0znk" },
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
