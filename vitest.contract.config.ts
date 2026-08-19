import { defineConfig } from "vitest/config";

// 契约测试专用配置：打真实网络，独立于默认 `npm test`。
export default defineConfig({
  test: {
    include: ["test/contract/**/*.test.ts"],
    environment: "node",
  },
});
