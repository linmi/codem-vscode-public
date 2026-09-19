import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  testIgnore: ["**/host/**"],
  snapshotPathTemplate: "tests/screenshots/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: process.env["PLAYWRIGHT_WORKERS"]
    ? Number.parseInt(process.env["PLAYWRIGHT_WORKERS"]!, 10) || undefined
    : undefined,
  reporter: process.env["CI"] ? [["dot"]] : [["list"]],
  use: {
    baseURL: "http://localhost:6007",
    // VS Code sidebar is typically 350-450px wide
    viewport: { width: 420, height: 720 },
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 420, height: 720 } },
    },
  ],
  webServer: {
    command:
      "pnpm exec storybook build -o ./storybook-static && pnpm exec http-server ./storybook-static -p 6007 --silent",
    url: "http://localhost:6007",
    reuseExistingServer: !process.env["CI"],
    timeout: 300_000,
  },
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
})
