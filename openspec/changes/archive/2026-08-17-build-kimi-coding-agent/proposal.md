## Why

我想通过"亲手搭一个能用的 coding agent"来系统学习 LangGraph.js 的 agent 构建方式。市面上的教程大多停留在玩具级问答 agent，而 coding agent（能读代码、改代码、跑命令的循环状态机）恰好把 LangGraph 的核心原语——状态图、工具节点、条件边、检查点、人工审批——全都用上了，是最好的学习载体。模型侧使用国产 Kimi K2.6（Moonshot），走 OpenAI 兼容接口。

## What Changes

- **以 git submodule 形式引入 `langchain-ai/langgraphjs` 整个 monorepo**（放在 `vendor/langgraphjs`），仅作只读的学习资料 / 源码与示例参考，不参与构建。
- **新建一个 TypeScript 项目骨架**（`package.json`、`tsconfig`、`.env` 约定），实际构建通过 npm 安装的发布版 `@langchain/langgraph` + `@langchain/openai`。
- **接入 Kimi 模型层**：用 `ChatOpenAI` 覆盖 `baseURL` 为 `https://api.moonshot.cn/v1`，模型 `kimi-k2.6`，密钥读 `MOONSHOT_API_KEY`。
- **Phase 0 冒烟测试**：验证 Kimi 通过 LangChain 能正确返回 `tool_calls`（function calling），这是整个 ReAct 循环成立的前提。
- **Phase 1（先跑起来）**：用预制件 `createReactAgent` + 最小工具四件套（`read_file` / `list_dir` / `write_file` / `run_bash`）搭出一个"能用"的 coding agent，配一个命令行入口。
- **Phase 2（回头拆）**：用手写 `StateGraph`（LLM 节点 + `ToolNode` + `shouldContinue` 条件边）复刻 `createReactAgent`，功能等价、原语可见；补充 `grep` / `edit_file` 工具。
- **Phase 3（进阶）**：加入检查点（记忆/多轮）与 `interrupt` 人工审批（在执行 `run_bash` 前暂停询问）。
- 这是一个**学习/研究用途**的项目，非生产系统；安全边界以"够学习、能演示 HITL"为准。

## Capabilities

### New Capabilities
- `coding-agent`: 一个基于 LangGraph.js 构建、由 Kimi 驱动的命令行 coding agent，具备模型接入、工具调用、ReAct 循环、记忆与危险操作人工审批等行为。

### Modified Capabilities
<!-- 无：这是全新项目，不修改已有能力。 -->

## Impact

- **新增依赖**：`@langchain/langgraph`、`@langchain/openai`、`@langchain/core`、`zod`、`dotenv`、`typescript` 及运行工具（如 `tsx`）。
- **新增 submodule**：`vendor/langgraphjs`（`.gitmodules`）。
- **新增源码**：`src/`（模型层、工具、agent 图、CLI）。
- **外部依赖**：需要有效的 `MOONSHOT_API_KEY` 和访问 `api.moonshot.cn` 的网络。
- **风险**：`run_bash` 工具可执行任意命令；学习阶段先裸跑，Phase 3 通过 `interrupt` 加人工审批收敛风险。
- **待验证未知数**：Kimi K2.6 经由 `ChatOpenAI` 路径是否稳定输出规范的 `tool_calls`（由 Phase 0 消除）。
