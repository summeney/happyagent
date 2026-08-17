# Phase 2 笔记：手写 StateGraph vs createReactAgent

这份笔记对照 `src/agent.ts`（预制版）和 `src/graph.ts`（手写版），说明手写图里
每个原语，对应 `createReactAgent` 内部替你做了什么。两者对同一任务应产出等价结果。

## 一句话

`createReactAgent({ llm, tools })` ≈ 下面这张手写图：

```
        ┌──────────┐  shouldContinue   ┌──────────┐
   START│  llmCall  │──有 tool_calls──▶│  tools   │──┐
      └▶│ (LLM节点) │                  └──────────┘  │
        └──────────┘◀───────────────────────────────┘
              │ 没有 tool_calls
              ▼ END
```

## 逐个原语对照

| 手写版（graph.ts） | 预制版内部等价物 | 作用 |
|---|---|---|
| `new StateGraph(MessagesAnnotation)` | agent 内部的状态定义 | 声明流动的状态是一串 messages，`MessagesAnnotation` 自带"把新消息追加进历史"的 reducer |
| `llmCall` 节点：`llm.bindTools(tools).invoke([system, ...messages])` | agent 节点 | 把系统提示 + 历史交给绑了工具的模型，产出一条可能带 `tool_calls` 的 AI 消息 |
| `new ToolNode(tools)` | tools 节点 | 读最后一条 AI 消息里的 `tool_calls`，逐个执行对应工具，把结果作为 `ToolMessage` 回灌 |
| `shouldContinue` + `addConditionalEdges` | agent 后的条件路由 | 最后一条消息有 `tool_calls` → 去 `tools`；没有 → `END` |
| `addEdge("tools", "llmCall")` | tools → agent 回边 | 工具结果回灌后重新问模型，形成 ReAct 循环 |
| `.compile({ checkpointer })` | agent 的 checkpointer 选项 | 挂上记忆/中断所需的状态持久化 |
| `recursionLimit`（在 cli.ts 的 config 里） | agent 默认的递归上限 | 步数上限，避免无限循环 |

## 关键收获

1. **"agent" 不神秘**：它就是"LLM 节点 + 工具节点 + 一条看 `tool_calls` 的条件边"
   组成的循环。`createReactAgent` 只是把这几行封装起来。
2. **状态的核心是 messages**：`MessagesAnnotation` 的 reducer 负责把每个节点返回的
   `{ messages: [...] }` 追加进历史，所以每个节点只需返回"新增的消息"。
3. **工具调用是数据驱动的**：模型不直接执行工具，它只在 AI 消息里"请求"工具
   （`tool_calls`）；真正执行发生在 `ToolNode`，结果以 `ToolMessage` 回到模型面前。
4. **要加能力就是加节点/边**：记忆 = 加 checkpointer；人工审批 = 在工具里加 `interrupt`。
   图结构让这些扩展点一目了然，这正是它比"裸 while 循环"更值得学的地方。

## 动手验证

```bash
# 同一任务分别跑两版，比较过程与结果是否一致
npm run agent --        "统计 src 目录下有多少个 .ts 文件"
npm run agent -- --graph "统计 src 目录下有多少个 .ts 文件"
```
