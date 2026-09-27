import { defineConfig, devices } from "@playwright/test";

/**
 * Task 23, Step 1 — e2e smoke tests.
 *
 * One browser project only (Chromium desktop): this is a *smoke* suite, so the
 * goal is "the built app serves and the funnel renders", not a device matrix.
 * The webServer boots the production build (`next start`) on a fixed port so
 * CI needs no external service — no database, no backend, no network. Tests
 * must therefore assert on static marketing/product routes and gracefully skip
 * anything that needs a live Openfront backend (see e2e/smoke.spec.ts).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: ".artifacts/playwright-report" }]] : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start -- --port 3100 --hostname 127.0.0.1",
    url: "http://127.0.0.1:3100/us",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: "3100",
      OPENFRONT_DATABASE_URL: "postgresql://ci:ci@127.0.0.1:5432/ci",
      SESSION_SECRET: "ci-session-secret-0123456789abcdef0123456789",
      NEXT_PUBLIC_BACKEND_URL: "http://127.0.0.1:3000",
    },
  },
});
