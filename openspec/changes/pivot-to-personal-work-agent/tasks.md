## 1. 目录重构与类型分层（先于测试，避免返工）

- [x] 1.1 建立目录骨架：`src/core/`、`src/app/main/`、`src/app/preload/`、`src/renderer/`、`src/shared/`
- [x] 1.2 迁移 agent 内核到 `src/core/`：`graph.ts`、`model.ts`、`prompt.ts`、`tools/*`、`tracing.ts`、`server-graph.ts`、`smoke.ts`、`session/*`（整棵子树同迁，内部相对 import 不变）
- [x] 1.3 迁移 Electron 外壳到 `src/app/`（main→`app/main/`、preload→`app/preload/`）、renderer→`src/renderer/`；更新其跨层 import，编译通过（外壳待 Group 3/5 改造）
- [x] 1.4 跨层契约类型抽到 `src/shared/ipc.ts`（`RunEvent`/`UiMessage`/`SessionMeta`）；preload/main/store 改从 shared 取类型，消除反向 import 实现文件
- [x] 1.5 拆分 tsconfig：`tsconfig.json`（Node：core/app/shared，types=node）+ `tsconfig.renderer.json`（DOM lib，备 Group 5 用）
- [x] 1.6 `npm run typecheck` 全绿；`langgraph.json` 指向更新为 `src/core/server-graph.ts` 并复验 server 仍能加载 graph

## 2. 本地 LangGraph Server 集成

- [x] 2.0 **前置（spike 发现）**：LangChain 栈升级到 1.x（`core`/`langgraph`/`openai`/`langgraph-checkpoint`）；keeper 代码（graph/model/tools）typecheck 通过（仅 cli.ts/service.ts 因待删的 Command/interrupt 代码报错）
- [x] 2.1 新增依赖：`@langchain/langgraph-cli`、`@langchain/langgraph-sdk`
- [x] 2.2 编写 `langgraph.json`，`graphs.agent` 指向已编译 graph（当前 `src/server-graph.ts`，Group 1 后迁入 `src/core`）
- [x] 2.3 本地 `langgraphjs dev` 能起来并注册 `agent` 图；用 SDK 直连跑通一轮 ReAct（list_dir 工具调用端到端，Moonshot 在 openai@1.x 下正常）
- [x] 2.4 **验证 R2 打包**：embed spike 通过——`createEmbedServer` 进程内 `serve()`（Hono + `@hono/node-server`，无 CLI/Docker），注入我们的 graph + checkpointer + ThreadSaver，SDK 经 SSE 跑通一轮 ReAct（read_file），thread state 正确落盘（R4 一并验证）。新增依赖 `@langchain/langgraph-api`、`hono`、`@hono/node-server`
- [ ] 2.5 保留 Kimi `temperature=1` 约束于 `src/core/model.ts`（迁入时补一条单测断言）

## 3. 嵌入式运行时（createEmbedServer）与监工

- [x] 3.1 新建 `src/app/server/runtime.ts`：`createEmbedServer({ graph: buildGraph(), checkpointer, threads })` + `@hono/node-server` `serve()`，bind `127.0.0.1:<port>`（headless 验证通过）
- [x] 3.2 注入**落盘** checkpointer（复用 `core/session/node-sqlite-saver` via `createSqliteCheckpointer`）；`ThreadSaver` 用新写的 `src/app/server/thread-store.ts` 落盘实现（get/set/delete/search）取代 SessionStore（更贴合接口，SessionStore 转由 Group 4 清理）
- [x] 3.3 `src/app/server/entry.ts`（utilityProcess 入口，parentPort 握手）+ `main.ts` 监工（fork→就绪→建窗口）；真 Electron 启动验证：进程树含 utilityProcess(node service, --experimental-sqlite) + renderer 窗口，app 内 server `200`
- [x] 3.4 监工守护：崩溃退避重启（杀子进程→日志"1000ms 后重启"→端口恢复 200）；退出优雅关闭（kill app 后无孤儿）
- [x] 3.5 `serve({ hostname: "127.0.0.1" })` 仅监听回环；curl 127.0.0.1 通、外部接口不监听
- [x] 3.7 修复工具工作目录：`core/workspace.ts`（HAPPYAGENT_WORKDIR）+ 全部文件工具/run_bash 显式解析；修复 runtime 打包（`packages: external`，避免 langchain 用 import.meta.url 读自身 package.json 时错位）。真 Electron 端到端 read_file 通过
- [x] 3.6 验证跨重启读回历史（落盘 checkpointer 生效）：同一 dbDir 重启后 thread state 4 条消息完整读回，线程目录能列出

## 4. 删除旧运行时与命令行/审批

- [x] 4.1 删除 `src/core/session/service.ts`（运行编排循环）、`store.ts`、`paths.ts`（被 embed 运行时取代且无引用）；`node-sqlite-saver.ts`/`checkpointer.ts` 保留（作注入 checkpointer 复用）
- [x] 4.2 删除 `src/cli.ts`（Group 1 提前完成：它无处安放于新结构且是 typecheck 报错源之一）
- [x] 4.3 删除审批链：`run_bash` 的 `interrupt`/审批分支、`tools/index.ts` 的 `setBashApprovalEnabled` 导出（旧界面审批弹窗随旧 renderer 一并退役）
- [x] 4.4 `run_bash` 的 `timeout` 上调至 600s、`maxBuffer` 至 10MB 以支持长线命令
- [x] 4.5 `scripts/build-electron.mjs` 改造复用（打包 main/preload/runtime 三入口）；Vue renderer 的 Vite 构建 Group 5 另立，故此脚本保留而非移除

## 5. Vue 渲染层

- [x] 5.1 新增依赖 `vue`/`vite`/`@vitejs/plugin-vue`；按 R3 选择**回退路径**（SDK Client + 自封装 Vue 组合式），不赌 `@langchain/vue` useStream 在 Electron file:// 下的未知行为，换取全控与并发支持
- [x] 5.2 Vite + Vue 3 应用（`vite.config.ts` base './'，构建到 dist-electron/renderer）；preload 已为原生桥；env.d.ts 声明 window.happyagent 与 .vue
- [x] 5.3 `lib/agent.ts` 组合式经 SDK `runs.stream(updates)` 增量呈现 AI 文本/工具调用/工具结果（App.vue 三类分别渲染）；模拟 UI 流程验证 read_file 端到端
- [x] 5.4 会话列表：新建、点击切换、`threads.search(updated_at desc)` 倒序、首条消息 `threads.update` 写 metadata.title 自动标题
- [x] 5.5 每会话运行锁（`state.running[id]`）：运行中该会话禁止重复提交，不阻止其他会话

## 6. 并发多会话与 MCP

- [x] 6.1 多会话并发验证：两会话 Promise.all 并发跑（2.5s 并行非串行），各得正确隔离结果（A→4、B→北京）；composable 每会话独立消息/运行锁支持后台运行
- [x] 6.2 分别取消：composable 每会话 AbortController + `cancel(id)`（App.vue 停止按钮）；验证取消 A（AbortError）不影响并发 B 正常完成
- [x] 6.3 新增 `@langchain/mcp-adapters`；`core/mcp/index.ts` 用 MultiServerMCPClient 连接并入 `buildGraph` 工具集；验证 filesystem server 合并 14 个工具、agent 实际调用 `fs__get_file_info`
- [x] 6.4 MCP 故障降级：`throwOnLoadError:false` + 外层 try/catch；验证坏配置下日志降级、agent 仍用内置工具正常运行
- [x] 6.5 MCP 配置位置：`${userData}/mcp.json`（或 `HAPPYAGENT_MCP_CONFIG` 覆盖）；提供 `mcp.example.json` 示例

## 7. 测试

- [x] 7.1 引入 Vitest（`npm test`）；`buildGraph` 增 `chatModel` 注入口 + `GraphChatModel` 接口，可注入替身模型绕过真实网络
- [x] 7.2 单元测试：`tools/*`（临时工作区读写/编辑/grep/run_bash 退出码）、`workspace`、`model`（缺 key 抛错 + temperature=1）——共 17 例
- [x] 7.3 集成测试：注入替身模型 `invoke` graph，覆盖多步工具调用、无工具直接答复、步数上限（recursionLimit 抛错）——3 例；全部 20 例通过，test 纳入 typecheck
- [x] 7.4 Playwright `_electron` e2e（`npm run test:e2e`）：真 Electron 启动，①新建会话→发消息→流式 AI 答复渲染 ②relaunch 同 userData 验证会话持久化读回——2 例通过
- [x] 7.5 `smoke.ts` 转为 `test/contract/kimi.contract.test.ts`（独立 config、`npm run test:contract`，缺 key 自动跳过，不进默认路径）；真实 Kimi function-calling 契约通过

## 8. 可观测性与清理

- [x] 8.1 `core/tracing.ts` 重构为 embed 友好（`initTracing` 返回 handler）；runtime 用 `graph.withConfig({callbacks})` 烘焙进图（callbacks 沿图传播覆盖 LLM+工具），close 时 flush。验证 no-op 优雅降级（无 key → agent 正常、无报错）。〔完整 trace 投递与 session 分组需配 Langfuse key 验证，用户当前无 key〕
- [x] 8.2 README 全面重写为新架构（Electron+embed server+Vue+并发+MCP+测试）；`package.json` 描述改为"个人全能工作 agent"；`.env.example` 补 HAPPYAGENT_* 可选项
- [x] 8.3 确认 `src` 无 import `vendor`（仅 grep 描述字符串提及）；构建（esbuild+vite）只打 src，vendor 不进分发
- [x] 8.4 全量通过：typecheck 绿、20 单元/集成、2 e2e、契约测试；手动真实任务冒烟（统计 .ts 文件数=16 正确）
