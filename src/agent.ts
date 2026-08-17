/**
 * Phase 1 · 预制版 agent。
 *
 * `createReactAgent` 一行就把整张 ReAct 图（LLM 节点 + 工具节点 + 条件边）
 * 搭好了。这就是"先跑起来"的最短路径。Phase 2 的 graph.ts 会用手写的
 * StateGraph 复刻出功能等价的东西，两相对照理解其内部。
 */
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createModel } from "./model.js";
import { allTools } from "./tools/index.js";
import { SYSTEM_PROMPT } from "./prompt.js";

export interface BuildAgentOptions {
  tools?: StructuredToolInterface[];
  checkpointer?: BaseCheckpointSaver;
  model?: string;
}

export function buildAgent(options: BuildAgentOptions = {}) {
  const { tools = allTools, checkpointer, model } = options;
  const llm = createModel(model);

  return createReactAgent({
    llm,
    tools,
    prompt: SYSTEM_PROMPT,
    checkpointer,
  });
}
