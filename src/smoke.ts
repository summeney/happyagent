/**
 * Phase 0 · 冒烟测试：验证 Kimi 经由 ChatOpenAI 能返回规范的 tool_calls。
 *
 * 这是整套方案唯一的真实未知数 —— coding agent 全靠 function calling 驱动。
 * 用最小代价（绑一个假工具、发一条会触发它的消息）先把这个风险消除。
 *
 * 运行：npm run smoke
 * 通过标准：控制台打印出 tool_calls，且包含工具名 get_weather 和结构化参数。
 */
import "dotenv/config";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createModel } from "./model.js";

const fakeWeatherTool = tool(async ({ city }: { city: string }) => `晴，25℃（${city}）`, {
  name: "get_weather",
  description: "查询某个城市的当前天气。",
  schema: z.object({ city: z.string().describe("城市名") }),
});

async function main() {
  const model = createModel().bindTools([fakeWeatherTool]);

  console.log("→ 向 Kimi 发送会触发工具的消息：'北京今天天气怎么样？'\n");
  const res = await model.invoke("北京今天天气怎么样？请用 get_weather 工具查询。");

  const toolCalls = res.tool_calls ?? [];
  if (toolCalls.length > 0) {
    console.log("✅ 冒烟测试通过：Kimi 返回了规范的 tool_calls\n");
    console.log(JSON.stringify(toolCalls, null, 2));
  } else {
    console.log("⚠️ 未拿到 tool_calls。模型的文本回复如下（可能需要降级方案）：\n");
    console.log(res.text);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("❌ 冒烟测试出错：", err.message);
  process.exitCode = 1;
});
