/**
 * Kimi function-calling 契约测试（打真实网络，需 MOONSHOT_API_KEY）。
 *
 * 不在 `npm test` 默认路径内（vitest include 只含 unit/integration）；
 * 手动/定时运行：`npm run test:contract`。缺少 key 时自动跳过。
 *
 * 卡住的风险：换模型或模型端改变 function-calling 行为——这是整套 agent
 * 的唯一真实未知数（模型必须能返回规范 tool_calls）。
 */
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createModel } from "../../src/core/model.js";

const hasKey = !!process.env.MOONSHOT_API_KEY;

describe.skipIf(!hasKey)("Kimi function-calling 契约", () => {
  it("模型能对触发性提示返回规范的 tool_calls（工具名 + 结构化参数）", async () => {
    const weather = tool(async ({ city }: { city: string }) => `晴，25℃（${city}）`, {
      name: "get_weather",
      description: "查询某个城市的当前天气。",
      schema: z.object({ city: z.string().describe("城市名") }),
    });

    const model = createModel().bindTools([weather]);
    const res = await model.invoke("北京今天天气怎么样？请用工具查询。");

    const calls = (res as { tool_calls?: { name: string; args: Record<string, unknown> }[] }).tool_calls ?? [];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].name).toBe("get_weather");
    expect(calls[0].args).toHaveProperty("city");
  }, 30_000);
});
