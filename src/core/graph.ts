/**
 * Phase 2 · 手写版 agent —— 用 StateGraph 复刻 createReactAgent。
 *
 * 这里把预制件内部隐藏的东西全摊开：
 *
 *        ┌──────────┐  shouldContinue   ┌──────────┐
 *   START│  llmCall  │──有 tool_calls──▶│ toolNode │──┐
 *      └▶│ (LLM节点) │                  └──────────┘  │
 *        └──────────┘◀───────────────────────────────┘
 *              │ 没有 tool_calls
 *              ▼ END
 *
 * - llmCall：把系统提示 + 历史消息交给绑好工具的模型，产出一条 AI 消息
 *   （可能带 tool_calls）。
 * - toolNode：执行 AI 消息里请求的工具，把结果作为 ToolMessage 回灌。
 * - shouldContinue：看最后一条消息有没有 tool_calls，决定回到 llmCall 还是结束。
 */
import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { isAIMessage, SystemMessage, type AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createModel } from "./model.js";
import { allTools } from "./tools/index.js";
import { SYSTEM_PROMPT } from "./prompt.js";

/** 供 graph 使用的最小模型接口：绑定工具后可 invoke 出一条 AI 消息。 */
export interface GraphChatModel {
  bindTools(tools: StructuredToolInterface[]): {
    invoke(messages: BaseMessage[]): Promise<AIMessage>;
  };
}

export interface BuildGraphOptions {
  tools?: StructuredToolInterface[];
  checkpointer?: BaseCheckpointSaver;
  /** 模型名（按名构建真实 Kimi 模型）。 */
  model?: string;
  /** 注入一个已构造的聊天模型（测试用替身，绕过真实网络）。优先于 `model`。 */
  chatModel?: GraphChatModel;
}

export function buildGraph(options: BuildGraphOptions = {}) {
  const { tools = allTools, checkpointer, model, chatModel } = options;
  const llm: GraphChatModel = chatModel ?? (createModel(model) as unknown as GraphChatModel);
  const llmWithTools = llm.bindTools(tools);
  const toolNode = new ToolNode(tools);

  // 节点 1：调用模型
  const llmCall = async (state: typeof MessagesAnnotation.State) => {
    const response = await llmWithTools.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  // 条件边：最后一条 AI 消息里有工具调用就去执行工具，否则结束
  const shouldContinue = (state: typeof MessagesAnnotation.State) => {
    const last = state.messages.at(-1);
    if (last && isAIMessage(last) && (last.tool_calls?.length ?? 0) > 0) {
      return "tools";
    }
    return END;
  };

  return new StateGraph(MessagesAnnotation)
    .addNode("llmCall", llmCall)
    .addNode("tools", toolNode)
    .addEdge(START, "llmCall")
    .addConditionalEdges("llmCall", shouldContinue, ["tools", END])
    .addEdge("tools", "llmCall")
    .compile({ checkpointer });
}
