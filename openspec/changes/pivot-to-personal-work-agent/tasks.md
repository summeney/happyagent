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
- [ ] 3.3 用 `utilityProcess.fork` 在独立进程跑 embed 模块；main 作监工：fork → 健康探测就绪 → 再建窗口〔待 Electron 可启动后验证，与 Group 5 build 一并做〕
- [ ] 3.4 监工守护：子进程崩溃按退避重启并把可用性状态传给界面；`app` 退出时优雅关闭，验证无孤儿进程〔同上，待 Electron 启动〕
- [ ] 3.5 验证 server 仅监听回环地址、外部地址不可达〔已在 `serve({ hostname: "127.0.0.1" })` 实现，外部不可达待启动后验证〕
- [x] 3.6 验证跨重启读回历史（落盘 checkpointer 生效）：同一 dbDir 重启后 thread state 4 条消息完整读回，线程目录能列出

## 4. 删除旧运行时与命令行/审批

- [ ] 4.1 删除 `src/session/service.ts` 运行循环、`node-sqlite-saver.ts`、`checkpointer.ts`（保留仍需要的 `store`/`paths` 中确有用的部分或一并清理）
- [x] 4.2 删除 `src/cli.ts`（Group 1 提前完成：它无处安放于新结构且是 typecheck 报错源之一）
- [ ] 4.3 删除审批链：`run_bash` 的 `interrupt`/审批分支、`tools/index.ts` 的 `setBashApprovalEnabled` 导出、界面审批弹窗
- [ ] 4.4 `run_bash` 的 `timeout` 上调以支持长线命令
- [ ] 4.5 移除旧构建脚本 `scripts/build-electron.mjs`（改用 Vite 构建）

## 5. Vue 渲染层

- [ ] 5.1 新增依赖：`vue`、`vite`、`@langchain/vue`；确认 `@langchain/vue` npm 发布版可用（R3），不稳则以 sdk 自封装组合式函数
- [ ] 5.2 Vite + Vue 3 应用骨架接入 Electron renderer；preload 缩减为原生能力桥
- [ ] 5.3 用 `useStream` 打通流式渲染：AI 文本 / 工具调用 / 工具结果三类增量呈现
- [ ] 5.4 会话列表：新建、点击切换、按最近更新倒序、自动生成标题
- [ ] 5.5 同一会话运行中禁止重复提交（限制仅作用于该会话）

## 6. 并发多会话与 MCP

- [ ] 6.1 验证多会话并发：会话 A 长任务运行中，会话 B 可同时发起并生成，事件不串会话
- [ ] 6.2 分别取消：取消会话 A 不影响会话 B；切换视图不中断后台运行
- [ ] 6.3 新增依赖 `@langchain/mcp-adapters`；按配置连接 MCP server 并把工具并入 `allTools`
- [ ] 6.4 MCP 故障降级：连接失败跳过其工具、调用出错回灌可读错误，agent 不崩溃
- [ ] 6.5 确定 MCP 配置存放位置（首版配置文件即可，见 design Open Questions）

## 7. 测试

- [ ] 7.1 引入 Vitest；`createModel` 改为可注入替身模型实例
- [ ] 7.2 单元测试：`tools/*`、`model`（含 `temperature=1` 断言）、纯函数
- [ ] 7.3 集成测试：注入替身模型直接 `invoke` graph，覆盖多步工具调用与步数上限，不发真实网络
- [ ] 7.4 引入 Playwright `_electron`；e2e 覆盖 新建会话→发消息→流式渲染、跨重启读回历史
- [ ] 7.5 `smoke.ts` 转为打标签的 Kimi function-calling 契约测试（不进 CI 默认路径）

## 8. 可观测性与清理

- [ ] 8.1 Langfuse 回调迁入 `src/core`，随 graph 运行于 server；验证会话分组按 `thread_id`、运行结束刷新、退出前刷新
- [ ] 8.2 更新 README 与 `package.json` 描述/脚本，去掉"学习/研究用途"，反映纯桌面 + server 形态
- [ ] 8.3 确认 `vendor/langgraphjs` 保留为参考，不进构建/分发
- [ ] 8.4 全量 `typecheck` + 单元/集成/e2e 通过；手动跑一次真实任务冒烟
