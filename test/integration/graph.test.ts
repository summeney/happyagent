import { describe, it, expect } from "vitest";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buildGraph, type GraphChatModel } from "../../src/core/graph.js";

/** 轻量替身模型：按队列顺序返回预置的 AI 消息（超出则重复最后一条）。不发真实网络。 */
class FakeModel implements GraphChatModel {
  private i = 0;
  constructor(private queue: AIMessage[]) {}
  bindTools() {
    return {
      invoke: async (_messages: BaseMessage[]): Promise<AIMessage> =>
        this.queue[Math.min(this.i++, this.queue.length - 1)],
    };
  }
}

const echoTool = tool(async ({ x }: { x: string }) => `echoed:${x}`, {
  name: "echo",
  description: "回显输入",
  schema: z.object({ x: z.string() }),
});

describe("buildGraph（注入替身模型）", () => {
  it("多步：模型请求工具 → 执行 → 回灌 → 最终答复", async () => {
    const fake = new FakeModel([
      new AIMessage({ content: "", tool_calls: [{ name: "echo", args: { x: "hi" }, id: "1" }] }),
      new AIMessage({ content: "最终答复：完成" }),
    ]);
    const app = buildGraph({ chatModel: fake, tools: [echoTool] });

    const result = await app.invoke({ messages: [new HumanMessage("请回显 hi")] });
    const msgs = result.messages;

    // 应包含一条工具结果消息 echoed:hi
    const toolMsg = msgs.find((m) => m.getType() === "tool");
    expect(toolMsg?.content).toBe("echoed:hi");
    // 最后一条是最终 AI 答复
    expect(msgs.at(-1)?.content).toContain("最终答复");
  });

  it("无工具调用：模型直接答复即结束", async () => {
    const fake = new FakeModel([new AIMessage({ content: "直接回答" })]);
    const app = buildGraph({ chatModel: fake, tools: [echoTool] });
    const result = await app.invoke({ messages: [new HumanMessage("你好")] });
    expect(result.messages.at(-1)?.content).toBe("直接回答");
    expect(result.messages.some((m) => m.getType() === "tool")).toBe(false);
  });

  it("步数上限：模型持续请求工具则在 recursionLimit 处安全终止", async () => {
    // 每次返回全新消息（唯一 id），确保真正循环而非被 id 去重
    const loopFake: GraphChatModel = {
      bindTools: () => ({
        invoke: async () =>
          new AIMessage({
            content: "",
            tool_calls: [{ name: "echo", args: { x: "loop" }, id: crypto.randomUUID() }],
          }),
      }),
    };
    const app = buildGraph({ chatModel: loopFake, tools: [echoTool] });
    await expect(
      app.invoke({ messages: [new HumanMessage("循环")] }, { recursionLimit: 5 }),
    ).rejects.toThrow();
  });
});
