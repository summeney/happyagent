import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createModel, DEFAULT_MODEL, MOONSHOT_BASE_URL } from "../../src/core/model.js";

const saved = process.env.MOONSHOT_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.MOONSHOT_API_KEY;
  else process.env.MOONSHOT_API_KEY = saved;
});

describe("createModel", () => {
  it("缺少 MOONSHOT_API_KEY 时抛出清晰错误", () => {
    delete process.env.MOONSHOT_API_KEY;
    expect(() => createModel()).toThrow(/MOONSHOT_API_KEY/);
  });

  it("提供 key 时构建成功，且 temperature=1（Kimi 约束）", () => {
    process.env.MOONSHOT_API_KEY = "test-key";
    const m = createModel();
    expect(m.temperature).toBe(1);
  });

  it("默认模型名与 Moonshot 端点常量正确", () => {
    expect(DEFAULT_MODEL).toBe("kimi-k2.6");
    expect(MOONSHOT_BASE_URL).toContain("moonshot");
  });
});
