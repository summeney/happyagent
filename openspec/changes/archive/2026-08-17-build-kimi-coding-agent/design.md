## Context

这是一个从零开始、以学习 LangGraph.js agent 构建为目标的项目（动机见 proposal.md - Why）。当前仓库为空壳，仅有 OpenSpec 脚手架。约束：

- 模型固定为 Kimi K2.6，走 Moonshot 的 OpenAI 兼容端点 `https://api.moonshot.cn/v1`。
- 学习节奏是"先跑起来能用的版本，再回头拆开理解每个原语"（proposal 的 Phase 0~3）。
- langgraphjs 以 submodule 形式引入仅作学习资料，实际构建用 npm 发布版。
- 学习/研究用途，非生产系统。

## Goals / Non-Goals

**Goals:**
- 用最短路径先得到一个"能用"的 coding agent（`createReactAgent` + 工具四件套 + CLI）。
- 随后用手写 `StateGraph` 复刻同一个 agent，让 ReAct 循环的每个原语（节点、`ToolNode`、条件边）都显式可见、可对照。
- 把 LangGraph 相对"裸 while 循环调 API"的差异化价值——检查点记忆、`interrupt` 人工审批——各自落成一个可演示的学习关卡。

**Non-Goals:**
- 不追求生产级安全沙箱；`run_bash` 的隔离仅到"Phase 3 用人工审批兜底"为止。
- 不做多 agent 编排、RAG、向量检索、复杂上下文压缩（可作为后续探索，不在本次范围）。
- 不部署为服务，不提供 Web UI；只做本地 CLI。
- 不修改或向上游贡献 langgraphjs（submodule 只读）。

## Decisions

### 决策 1：Kimi 通过 `ChatOpenAI` 覆盖 `baseURL` 接入，而非自写 HTTP 客户端
LangChain 的消息与工具调用协议本就是 OpenAI 方言，Moonshot 端点同样是 OpenAI 兼容协议，因此只需 `new ChatOpenAI({ model: "kimi-k2.6", apiKey: process.env.MOONSHOT_API_KEY, configuration: { baseURL: "https://api.moonshot.cn/v1" } })` 即可打通，再 `.bindTools(tools)` 绑定工具。
- **备选**：直接用官方 `openai` SDK 手写循环——但那样就绕开了 LangGraph，失去学习目标。
- **备选**：用 `@langchain/community` 里可能存在的 Moonshot 封装——增加不确定性，且 `ChatOpenAI` + baseURL 是最通用、最透明的做法。

### 决策 2：Phase 1 用预制件 `createReactAgent`，Phase 2 手写 `StateGraph` 复刻
先用 `createReactAgent({ llm, tools })` 一行拿到可用 agent，符合"先跑起来"。再手写等价图：`llmCall` 节点 + `ToolNode` + `shouldContinue` 条件边（`addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])`，并 `addEdge("toolNode", "llmCall")`）。两版功能等价、并排对照，是本项目的核心学习手段。
- **备选**：一上来就手写图——违背"先跑起来"的选择，且容易在早期被细节劝退。

### 决策 3：工具用 `tool()` + `zod` schema 定义，每把工具单独成文件
每个工具形如 `tool(fn, { name, description, schema: z.object({...}) })`。清晰的 `description` 与参数 schema 直接决定 Kimi 能否正确调用，是 coding agent 成败关键。工具分文件便于逐个讲解。最小四件套：`read_file` / `list_dir` / `write_file` / `run_bash`；Phase 2 增补 `grep` / `edit_file`。
- **备选**：把所有工具塞一个文件——不利于逐个学习与讲解。

### 决策 4：先做 Phase 0 冒烟测试再进入 Phase 1
在搭完整循环前，先用一个假工具验证 Kimi 经 `ChatOpenAI` 能返回规范 `tool_calls`。这是整套方案唯一的真实未知数，用最小代价（~10 行）前置消除，避免在复杂图里排查根因。

### 决策 5：`run_bash` 的人工审批用 LangGraph 的 `interrupt`（Phase 3）
在 tool 执行前通过 `interrupt` 暂停、把待执行命令抛给用户确认，配合 Checkpointer 保存/恢复状态。这既是关键安全阀，又正好演示 LangGraph 的 human-in-the-loop 能力。Phase 1/2 可先裸跑，Phase 3 再收敛。
- **备选**：在工具函数内部用 `readline` 直接问——简单，但绕过了框架能力，学不到 `interrupt`。

### 决策 6：运行时用 `tsx` 直接跑 TypeScript，`zod` 作 schema，`dotenv` 读密钥
`tsx` 免去编译步骤，最贴合"边写边跑"的学习循环。

## Risks / Trade-offs

- **Kimi 的 `tool_calls` 兼容性不确定** → 由 Phase 0 冒烟测试前置验证；若不达标，回退到在 system prompt 中约定 JSON 输出并手工解析（降级方案，作为 Open Question 跟踪）。
- **`run_bash` 可执行任意命令，存在破坏工作区/系统的风险** → 学习阶段在受控目录内使用；Phase 3 引入 `interrupt` 人工审批作为主要缓解；可选叠加命令白名单/工作目录限制。
- **LLM 可能陷入反复工具调用（无限循环）** → 图设置最大步数上限（recursion limit），到达即安全终止。
- **大代码库超出上下文窗口** → 本次范围先用 `grep` + 按需 `read_file` 缓解；系统化的上下文管理明确列为 Non-Goal / 后续探索。
- **submodule 拉取整个 monorepo 体积较大、克隆变慢** → 接受此代价（换来完整示例与源码参考）；README 说明 `git submodule update --init` 的用法。

## Open Questions

- 若 Phase 0 显示 Kimi 的原生 `tool_calls` 不稳定，是否采用"system prompt 约定 JSON + 手工解析"的降级方案？（不影响 specs 的对外行为，可在实现时按测试结果决定。）
- CLI 的形态是"单次任务执行"还是"可持续对话的 REPL"？（先做单次执行满足需求，REPL 可作为 Phase 3 结合 Checkpointer 的增强。）
