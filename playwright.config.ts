import { defineConfig } from "@playwright/test";

const E2E_DB = process.env.DATABASE_URL_E2E ?? "postgresql://postgres:postgres@localhost:5432/family_economy_e2e";
const PORT = 3200;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 390, height: 844 },
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : undefined,
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    env: { DATABASE_URL: E2E_DB, SETUP_TOKEN: "e2e-token", CRON_SECRET: "e2e-cron" },
  },
});
