## Why

happyagent 最初是学习/研究项目：手写 StateGraph、自制 SQLite 持久化、命令行与桌面端并存，目的是把 LangGraph 的原理摊开来学。现在定位转变——它要成为作者**日常个人使用的全能工作 agent（小秘书）**：长期跑长线任务、接入 MCP 扩展能力、并发处理多个会话。学习期为"看懂原理"手写的运行时编排与持久化（`session/service.ts` 的单会话锁 + `node-sqlite-saver.ts` 391 行），恰恰是日常工具最不该自己背的长期维护债。此时把运行时编排交还给成熟的 LangGraph 平台、砍掉不再需要的命令行与人工审批，是收益最大的一步。

## What Changes

- **BREAKING** 运行时改为本地 LangGraph Server：Electron 主进程作为"监工"拉起并守护 `langgraphjs dev` 子进程（localhost，内存模式无需 Docker），并发、后台运行、取消、thread 管理、持久化由 server 原生接管。手写的 `SessionService` 运行循环与 `node-sqlite-saver.ts` 整体退役。
- **BREAKING** 删除命令行程序：移除 `src/cli.ts`，桌面端成为唯一入口。
- **BREAKING** 删除人工审批（HITL）：移除 `run_bash` 的 `interrupt`/审批分支、`setBashApprovalEnabled` 全局开关、以及 `service.ts` 的审批解析链。所有权限默认全开（仅本机个人使用）。`run_bash` 的 60 秒超时上调以支持长线任务。
- **新增并发多会话**：多个会话可同时生成，移除"同一时刻仅一个会话"的全局单锁。
- **新增 MCP 接入**：通过 `@langchain/mcp-adapters`（新依赖）连接外部 MCP server，把其工具并入 agent 工具集。
- **前端重写为 Vue 3 应用**：渲染层从 251 行原生 JS 改为 Vite + Vue 3 + `@langchain/vue` 的 `useStream`，经 HTTP 与本地 server 通信；渲染层纳入 TypeScript 类型系统（独立 tsconfig，含 DOM lib）。
- **目录结构重构**：采用"三进程约定 + 内核/外壳分层"——`src/core`（agent 内核：graph/model/tools/mcp/tracing）、`src/app`（Electron 外壳：main/preload）、`src/renderer`（Vue UI）、`src/shared`（跨层类型）。新增 `langgraph.json` 注册 graph。
- **引入测试**：单元测试（Vitest，覆盖 tools/model/graph 节点）与端到端测试（Playwright `_electron`），并把 `createModel` 改为可注入 fake LLM 以支持无网络集成测试。`smoke.ts` 升级为打标签的 Kimi function-calling 契约测试。
- **清理学习期遗产**：`llm-tracing` 从"供学习者回看"重定位为"工作 agent 的可观测性"，Langfuse 回调从 CLI 迁入随 graph 运行于 server；更新 README / package.json 描述去掉"学习/研究用途"。`vendor/langgraphjs` 保留作参考。

## Capabilities

### New Capabilities
- `mcp-integration`: 定义 agent 如何连接外部 MCP server、发现并调用其工具、以及连接失败时的可观察行为。
- `concurrent-sessions`: 定义多个会话同时运行、各自独立流式输出、可分别取消的可观察行为。
- `runtime-server`: 定义以本地 LangGraph Server 为唯一 agent 运行时——桌面应用启动时拉起、守护、退出时关闭 server 子进程，并在其不可用时的可观察行为。

### Modified Capabilities
- `agent-runtime`: 运行时不再"供命令行与桌面端共同复用"，改为注册进 LangGraph Server 的单一 graph；模型改为可注入。
- `desktop-ui`: 界面改为 Vue 3 + `useStream`，经 HTTP 与本地 server 通信；新增并发多会话切换；移除审批弹窗。
- `session-management`: 会话持久化与并发运行改由 LangGraph Server 的 checkpointer 接管，自制 SQLite saver 退役。
- `llm-tracing`: 从"供学习者回看 ReAct 循环"重定位为"工作 agent 运行可观测性"；Langfuse 回调迁入 server 内的 graph。
- `coding-agent`: 移除"命令行交互入口"与"危险操作人工审批"两项要求（命令行入口与审批链删除）；模型/文件系统工具/命令执行/ReAct 循环等能力保留，其中模型接入改为可注入以支持测试。

## Impact

- **删除**：`src/cli.ts`、`src/session/service.ts`（运行循环）、`src/session/node-sqlite-saver.ts`、`src/session/checkpointer.ts`、`scripts/build-electron.mjs`（改为 Vite 构建）、`electron/renderer/*`（原生 JS UI）、`run_bash` 审批分支、`tools/index.ts` 的审批导出。
- **新增**：`langgraph.json`、`src/core/mcp/*`、`src/renderer/*`（Vue 应用）、`src/shared/*`、`test/unit/*`、`test/e2e/*`、Vite/Vitest/Playwright 配置。
- **迁移/改造**：`graph.ts`/`model.ts`/`prompt.ts`/`tools/*`/`tracing.ts` 迁入 `src/core`；`electron/main.ts` 转型为 server 监工 + 窗口管理；`electron/preload.ts` 缩减为原生能力桥。
- **依赖**：新增 `@langchain/langgraph-cli`、`@langchain/langgraph-sdk`、`@langchain/vue`、`@langchain/mcp-adapters`、`vue`、`vite`、`vitest`、`@playwright/test`；`package.json` 描述与脚本更新。
- **保留不动**：`vendor/langgraphjs`（参考用，后续会挂更多第三方项目做参考）；`model.ts` 中 Kimi `temperature=1` 的约束必须保留。
- **风险**：LangGraph JS server 的打包分发（脱离 `npx` 后能否随 Electron 分发）、`@langchain/vue` 发布版成熟度、生产模式持久化落地——详见 design.md。
