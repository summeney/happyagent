import { defineConfig } from "@playwright/test";
import "dotenv/config";

// e2e：用 Playwright 的 _electron 启动真实 Electron app。
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
});
