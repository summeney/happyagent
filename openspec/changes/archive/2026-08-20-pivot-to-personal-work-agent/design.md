## Context

动机见 proposal.md - Why。当前状态的关键约束：

- agent 内核（`graph.ts` / `model.ts` / `prompt.ts` / `tools/*`）成熟可复用，是真正的资产。
- 运行时编排与持久化为学习期手写：`session/service.ts`（含单会话锁 `this.running` 与 interrupt/审批循环）、`session/node-sqlite-saver.ts`（391 行，全项目最大文件）、`session/checkpointer.ts`、`session/store.ts`。
- 界面为 251 行原生 JS（`electron/renderer/*`），未纳入类型系统；`electron/` 与 `src/` 平级且 `electron/main.ts` 反向 `import "../src/…"`。
- `vendor/langgraphjs` 为 git submodule（37M），内含 `langgraph-api`、`langgraph-cli`、`sdk-vue`、`examples/ui-vue`——即本地起 server + Vue 前端的官方样板。
- 模型侧硬约束：Kimi K2.6 只接受 `temperature=1`（`model.ts` 已注释）。

## Goals / Non-Goals

**Goals：**
- 把运行时编排/持久化/并发交还给本机 LangGraph Server，自身只维护 graph + 一层薄壳。
- 建立三进程约定 + 内核/外壳分层的目录，使依赖方向自解释、renderer 进入类型系统。
- 让 agent 逻辑可脱离真实网络与 server 单测/集成测试。

**Non-Goals：**
- 不做云端部署/多用户/鉴权（server 仅监听本机回环）。
- 不在本次实现"定时任务/调度"等平台能力（留待后续，架构上不排斥）。
- 不重写工具的业务逻辑（`read_file`/`grep`/… 行为不变，仅迁移位置与去掉审批分支）。
- 不追求 renderer 的视觉设计打磨（本次先把数据链路与类型打通）。

## Decisions

### D1 · 运行时采用本地 LangGraph Server，而非继续手写编排

选 **S**（`langgraphjs dev` 子进程 + SDK over HTTP）。并发、后台运行、取消、thread 管理、持久化均由 server 原生提供；`session/service.ts` 的运行循环与 `node-sqlite-saver.ts` 整体退役。
- **备选 H0（现状：main 进程 + 单锁）**：一次只能跑一个会话，长线任务卡 UI——三条新需求全部不满足，出局。
- **备选 H1（手写并发运行时于 utilityProcess）**：全控、无 HTTP、依赖轻，但后台运行/断线重连/持久化等要逐项自建，长期维护重。
- **理由**：新需求（并发/长线/后台/未来调度）全是平台已做好的能力；作为日常工具，把这部分交还平台比自建更省。代价（D3/R1、R2）可控。

### D1.5 · 前置：整个 LangChain 栈升级到 1.x（实现期 spike 发现）

`langgraph-api@1.4.4`（本地 server）的 peer 要求 `@langchain/core ^1.1.48`、`@langchain/langgraph ^1.3.6`、`@langchain/langgraph-sdk ^1.9.3`。项目当前在 `core@0.3.80` / `langgraph@0.4.9` / `openai@0.6.17`。因此走 S 的**硬前置**是把 `core`/`langgraph`/`openai`/`langgraph-checkpoint` 全线升到 1.x。
- **迁移面评估（对照 vendor 1.0.47 源码）**：项目实际使用的 API（`MessagesAnnotation`、`StateGraph`、`ToolNode`、`Command`、`interrupt`、`MemorySaver`、`tool`、`isAIMessage`、`SystemMessage`、`ChatOpenAI`）在 1.x 中均保留；`zod` 保持 v3。唯一深度依赖 checkpoint 接口的 `node-sqlite-saver.ts` 在 S 方案本就删除。故为**中等规模大版本升级，非重写**。
- **主要待实测点**：`@langchain/openai` 1.x 的 `ChatOpenAI`（`configuration.baseURL` 指向 Moonshot + `temperature:1`）行为需实跑确认。
- **备选**：若升级证明代价过高，回退 H1（手写并发运行时，不需要 1.x server），此时 core 已解耦，改动集中在运行时封装层。

### D2 · 本地 dev 用内存态、按 `langgraph.json` 注册单一 graph；持久化另配

`langgraphjs dev` 内存运行、无需 Docker（Docker 仅出现在 `build`/`up`/`dockerfile` 部署路径）。graph 经 `langgraph.json` 的 `graphs.agent` 注册，指向 `src/core` 导出的已编译图。
- **持久化（R4）**：dev 内存态重启即丢，与 session-management 的"跨重启持久化 + 默认存储非易失"要求冲突。落地方式为在 server 端配置一个**落盘的 checkpointer**（sqlite 系），确认 JS server 的配置入口后接入；这是 spec 的硬约束，不能靠 dev 默认。

### D3 · 用 `createEmbedServer` 嵌入式运行时 + Electron 主进程"监工"（实现期 embed spike 确定）

**运行时不再依赖 CLI/Docker/子进程 spawn**，改用 `@langchain/langgraph-api/experimental/embed` 的 `createEmbedServer({ graph, checkpointer, threads, store? })`——它返回一个 **Hono app**，用 `@hono/node-server` 的 `serve()` 在**进程内**监听本机端口。SDK 与 `@langchain/vue` 经 HTTP/SSE 对接（官方 SDK 测试即以此为后端，路径已验证）。
- **进程边界**：embed server 运行在由 main `fork` 的 **utilityProcess** 中（崩溃隔离 + 把同步 SQLite 写与 graph 工作挪出 UI 线程；对应 R1）。main 作监工：fork → 健康探测就绪 → 建窗口；运行期监控、崩溃重启、退出时优雅关闭（对应 runtime-server 各要求）。utilityProcess 直接 bind localhost 端口，renderer 走 HTTP 访问，与在哪个进程无关。
- **注入契约**（spike 已验证）：`graph = buildGraph()`（不带 checkpointer 编译，server 注入）；`checkpointer` 注入落盘实现；`threads`（ThreadSaver：get/set/delete/search）提供线程目录。
- **CLI 仅 dev 用**：`langgraphjs dev` 保留作开发期 Studio UI 便利（`npm run dev:server`），不进生产/分发；其 `create-langgraph` 传递漏洞不随 app 分发。
- **备选**：直接在 main 进程内起 embed（少一个进程）。可作首个实现切面，但长线并发下同步 SQLite 写会抖 UI，故目标形态为 utilityProcess。

### D3.1 · 复用"本以为要删"的两个文件承载持久化契约

embed 的注入接口让两个原判为退役的文件获得新用途，减少删除、就地复用：
- `checkpointer`：`node-sqlite-saver.ts`（`BaseCheckpointSaver` 实现，node:sqlite 落盘，1.x 下 typecheck 通过）直接作为注入的 checkpointer（或替换为官方 sqlite checkpointer，二选一，见 Open Questions）。
- `threads`（ThreadSaver）：`store.ts` 的 `SessionStore`（list/create/title/touch）适配为 ThreadSaver，其 `search(sortBy/sortOrder)` 与"按 updated_at 倒序列会话 + 标题元数据"天然对应。
- 真正退役的仅剩 `service.ts` 的**运行编排循环**（interrupt/单锁）——被 embed server 的 run 处理取代。

### D4 · renderer = Vite + Vue 3 + `@langchain/vue` useStream，经 HTTP 连 server

界面数据链路走 `renderer ──HTTP──▶ localhost server`，不再走 IPC 到 main。preload 缩减为原生能力桥（文件对话框、app 路径、"请求重启 server"）。
- **框架 Vue**：作者熟 Vue；LangGraph 的 sdk-vue 与 sdk-react 均为一等公民，`useStream` 现成（官方 `examples/ui-vue` 为样板）。
- **副作用**：之前别扭的"`electron/` 反向 import `../src/`"随之消失——renderer 不 import core，二者只经 HTTP 协议对话；跨层共享的仅是 `src/shared` 里的类型/常量。

### D5 · 目录：三进程约定 + 内核/外壳分层（A+B）

```
src/
  core/      agent 内核（不知道 Electron/HTTP）：graph model prompt tools/ mcp/ tracing
  app/       Electron 外壳：main/（监工+窗口） preload/（原生桥）
  renderer/  Vue 应用（独立 tsconfig，含 DOM lib）
  shared/    跨层类型/常量（端口、MCP 配置 schema 等）
langgraph.json   注册 graph
test/  unit/  e2e/
```
- 每个运行环境独立 tsconfig（Node / preload / DOM），解决当前"单一 tsconfig 让 renderer 拿不到 DOM 类型、只能写纯 JS"的问题。

### D6 · 删除人工审批；`run_bash` 放开并延长超时

审批链（`run_bash` 的 `interrupt` 分支、`setBashApprovalEnabled`、`service.ts` 审批解析、界面弹窗）整体删除（对应各 spec 的 REMOVED）。`run_bash` 的 `timeout` 从 60s 上调以支持长线命令。
- **安全立场**：仅本机个人使用、默认全权限，是作者明确选择；限制交由 OS 层（受限用户/沙箱）。design 层不再实现审批。

### D7 · MCP 经 `@langchain/mcp-adapters` 在 graph 构建时并入工具集

新增依赖 `@langchain/mcp-adapters`（vendor 内无，独立 npm 包）。按用户配置连接 MCP server，发现工具并 `[...allTools, ...mcpTools]` 并入；连接/调用失败降级为"跳过该工具/回灌可读错误"，不拖垮运行（对应 mcp-integration）。
- MCP 客户端为长连接，集中在 server 侧的 graph 加载期建立与管理，避免每会话重建。

### D8 · 测试三层 + 模型可注入

- **单元（Vitest）**：`tools/*`、`model`、纯函数（`toUiMessage`/`truncateTitle`/…）、graph 节点。
- **集成**：直接 `invoke` 已编译 graph，注入**替身模型**（预设 tool_calls/文本），不发真实网络、不起 server——依赖 `createModel` 改为可接受注入实例（对应 agent-runtime / coding-agent 的注入要求）。
- **e2e（Playwright `_electron`）**：启动整个 Electron app（连带拉起 server），走"新建会话→发消息→断言流式渲染"。另可用 SDK 直连 `langgraphjs dev` 做 server 契约测试。
- `smoke.ts` 升级为打标签的 Kimi function-calling 契约测试，不进 CI 默认路径，手动/定时跑，卡"换模型/模型端改行为"风险。

## Risks / Trade-offs

- **R0 · 全栈 1.x 大版本升级**（见 D1.5）：`core`/`langgraph`/`openai` 从 0.3/0.4 升到 1.x 可能带来隐性行为变化 → 升级后先以 `typecheck` + 现有行为冒烟（真实跑一轮 ReAct）作为关口，尤其验证 Moonshot 端点在 `openai@1.x` 下的工具调用；不通则回退 H1。
- **R1 · server 子进程生命周期复杂**（起不来/端口占用/崩溃/退出清理）→ 监工统一处理健康探测、重启退避、`app.on('will-quit')` 优雅关闭；界面有"运行时不可用"态兜底（runtime-server 已成 spec）。
- **R2 · 打包分发 → 已基本解决**（embed spike）：`createEmbedServer` 是纯 JS Hono app，进程内 `serve()`，无 CLI/Docker/spawn，随 Electron 常规打包即可。剩余待验证仅"utilityProcess 内 bind 端口 + node:sqlite 在打包环境可用"，Group 3 落地时确认。
- **R3 · `@langchain/vue` 成熟度**：官方 SDK（含 vue）测试即以 `createEmbedServer` 为后端 → 对接路径已被官方覆盖；仍需在 Group 5 确认 npm 发布版与 useStream API。不稳则以 sdk（非框架 hook）自封装 Vue 组合式函数。
- **R4 · 持久化 → 已解决**（embed spike）：`checkpointer` 由我们注入，spike 中 thread state 正确落 4 条消息。落地用 `node-sqlite-saver` 或官方 sqlite checkpointer；e2e 覆盖"重启后读回"。
- **R7 · esbuild 打包破坏依赖的 `import.meta.url` 自解析（实现期踩坑，已解决）**：langchain/langgraph 用 `import.meta.url` 读自身 `package.json` 做版本检测；被打进 `runtime.mjs` 后 `import.meta.url` 变为 bundle 位置，相对路径错指 → 运行时 ENOENT。**解法**：runtime 构建用 `packages: "external"`，只打我们的 `src/*`，node_modules 依赖运行时加载（分发时随包携带 node_modules）。附带确立"工作区根"设计：文件工具/`run_bash` 经 `core/workspace.ts` 的 `HAPPYAGENT_WORKDIR` 解析相对路径，不依赖不确定的 `process.cwd()`。
- **R6 · WebSocket 传输被 hono 版本冲突挡住**：`@hono/node-ws@1.3` peer 要 `node-server ^1.x`，与 langgraph-api 要的 `node-server ^2.x` 冲突 → 暂不装 node-ws，走 SSE 传输（spike 已验证够用）；WebSocket 作为后续增强，待生态版本对齐再加。
- **R5 · Kimi `temperature=1` 约束在迁移中丢失** → 迁入 `src/core/model.ts` 时保留该约束，并加一条单测断言构造参数。
- **Trade-off · 引入 HTTP 边界与一个额外进程**：换来的是不必自建整套编排/持久化。对日常工具，这笔交换划算；但确实新增了"管一个子进程"的复杂度。

## Migration Plan

分阶段、每阶段可独立验证（详见 tasks.md）：
1. **目录重构**：`src/core` / `src/app` / `src/renderer` / `src/shared` 就位，拆分 tsconfig，`typecheck` 绿——先于测试，避免按旧结构写测试再返工。
2. **server 集成**：`langgraph.json` + `langgraphjs dev` 起得来，SDK 能连、能跑一轮；**尽早验证 R2 打包**。
3. **监工 + 持久化**：main 托管 server 生命周期；配置落盘 checkpointer。
4. **删旧运行时**：移除 `service.ts` 运行循环、`node-sqlite-saver.ts`、`cli.ts`、审批链。
5. **Vue renderer**：useStream 打通流式渲染与多会话切换。
6. **并发 + MCP**：验证多会话并发、接入 `@langchain/mcp-adapters`。
7. **测试**：补齐单元/集成/e2e；`smoke` 转契约测试。
8. **清理**：README/package.json 去"学习/研究用途"，tracing 迁入 core 并重定位文案。

**回滚**：各阶段独立提交；若 R2 证伪，止步于阶段 2 并切换到 H1 方案（core 已解耦，改动集中在 app/ 与运行时封装层）。

## Open Questions（实现后回填）

- ~~落盘 checkpointer 形态~~ → **已定**：复用 `node-sqlite-saver`，落 `${userData}/checkpoints.db`；线程目录另用 `thread-store.ts` 落 `threads.db`。
- ~~MCP 配置存放位置~~ → **已定**：`${userData}/mcp.json`（`HAPPYAGENT_MCP_CONFIG` 可覆盖），首版配置文件；设置 UI 留待后续。
- **agent 工作目录**（实现期新增）：当前经 `HAPPYAGENT_WORKDIR` 指定、桌面端默认 `app.getAppPath()`。后续应做成**按会话/项目可选**（工作 agent 常在不同项目间切换）——不改变现有工具的可观察行为，属增强。
- ~~完整 Langfuse trace 投递与 session 分组~~ → **已验证**：配置密钥后 Langfuse 收到嵌套观测（LangGraph→llmCall→ChatOpenAI），会话分组经 `config.metadata.langfuseSessionId=thread_id` 接线。注意：v4 events_only 部署下读取走 `/api/public/v2/observations`（旧 `/traces`、`/sessions` 端点禁用）。
- **WebSocket 传输**（见 R6）：当前走 SSE；待 hono 生态版本对齐后可加 `@hono/node-ws` 增强。
