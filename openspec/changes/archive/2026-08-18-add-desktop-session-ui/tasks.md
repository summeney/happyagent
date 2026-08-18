## 1. 收敛：移除 agent 预制版分支

- [x] 1.1 删除 `src/agent.ts`
- [x] 1.2 `src/cli.ts`：移除 `--graph` 开关与 `buildAgent` 导入，构建统一走 `buildGraph`
- [x] 1.3 `src/tools/index.ts` 及相关注释去除 Phase 措辞（保留工具集本身）
- [x] 1.4 删除 `docs/notes-phase2.md`
- [x] 1.5 `README.md` 删除 Phase 1 段落与 `--graph` 文档
- [x] 1.6 `npm run typecheck` 通过（零残留 agent 引用）；`npm run agent` 实时单轮运行受限于本环境无法访问 api.moonshot.cn，需在本机确认

## 2. 依赖与持久化后端

- [x] 2.1 依赖：`electron`、`esbuild`、`@langchain/langgraph-checkpoint`（基座，供自写 saver）。**改用运行时内置 `node:sqlite`**，移除原生 `better-sqlite3` / `@langchain/langgraph-checkpoint-sqlite` / `@electron/rebuild`（原生模块在 Electron 43 编译失败，见 design D4/R2）
- [x] 2.2 `.gitignore` 忽略本地数据库文件与构建产物（`data/`、`*.db*`、`dist-electron/`）
- [x] 2.3 `src/session/node-sqlite-saver.ts` 自写 node:sqlite checkpointer；`checkpointer.ts` 封装 `NodeSqliteSaver.fromConnString(...)`，`SessionService` 注入 `buildGraph({ checkpointer })`
- [x] 2.4 验证：checkpointer 层已无头验证跨实例(=跨重启)持久化——put 后新开 saver 读同一 .db，`channel_values` 完全一致（`verify_saver.ts` 通过）。完整 graph 多轮续接因依赖 Kimi API（本环境无法访问）留待本机确认

## 3. 会话服务（主进程）

- [x] 3.1 `src/session/store.ts`：在同一 .db 建 `sessions(id, title, created_at, updated_at)` 表并封装读写
- [x] 3.2 `SessionStore.list()`：按 `updated_at` 倒序返回全部会话
- [x] 3.3 `SessionService.create()`：分配新 `thread_id`（randomUUID）、空历史、写入目录
- [x] 3.4 `SessionService.history(threadId)`：经 `app.getState` 读回消息并脱成可序列化 UiMessage
- [x] 3.5 `setTitleIfEmpty`（首条消息截断）+ `touch`（每轮结束刷新 `updated_at`）
- [x] 3.6 `SessionService.send`：对指定 `thread_id` 调 `app.stream(streamMode:"updates")`，全局单会话运行锁

## 4. IPC 协议与桥

- [x] 4.1 `electron/preload.ts`：`contextIsolation` 开、`nodeIntegration` 关，`contextBridge` 暴露受限 `invoke`/`on` 桥
- [x] 4.2 `electron/main.ts` 请求-响应通道：`sessions:list` / `sessions:create` / `sessions:history` / `chat:send` / `approval:resolve` / `settings:setApproval`
- [x] 4.3 事件流 `run:event`：归一化为 `run:ai` / `run:tool_call` / `run:tool_result` / `run:interrupt` / `run:done` / `run:error`（带 `threadId`+`runId`）
- [x] 4.4 `SessionService.emitFromChunk` 复用 `printUpdate` 的 ai/tool_call/tool_result 分类，由"打印"改为"发事件"

## 5. 渲染界面

- [x] 5.1 `electron/renderer/`（index.html + styles.css）：左侧会话列表 + 右侧聊天区 + 底部常驻输入框
- [x] 5.2 `renderer.js` 启动加载会话列表；点击 `selectSession` → 拉取并展示目标会话历史
- [x] 5.3 `＋` 按钮 → `newSession` 新建空白会话并加入列表
- [x] 5.4 `submit` 发送 → `onRunEvent` 订阅事件流，按序增量渲染 AI 文本 / 工具调用 / 工具结果
- [x] 5.5 `setRunning` 运行中禁用输入/发送/新建，`run:done`/`run:error` 后恢复

## 6. HITL 审批弹窗

- [x] 6.1 UI「run_bash 审批」勾选框 → `settings:setApproval` → `setBashApprovalEnabled`（默认关）
- [x] 6.2 收到 `run:interrupt` → `showApproval` 弹窗展示待执行命令，提供批准/拒绝
- [x] 6.3 `resolveApproval(runId, approved)` → 主进程 `new Command({ resume:{ approved } })` 恢复同一 stream
- [ ] 6.4 验证：批准则执行并展示结果，拒绝则跳过并标注、循环继续 — ⏳ 需本机运行时

## 7. 文档与端到端验证

- [x] 7.1 `package.json` 新增 `build:electron` / `desktop` / `rebuild:native` 脚本与 `main` 字段（+ `scripts/build-electron.mjs`）
- [x] 7.2 README 增补桌面端形态、架构图与启动说明
- [ ] 7.3 端到端：新建会话 → 连续多轮 → 切到另一会话查看历史 → 重启应用历史仍在 — ⏳ 需本机 GUI 运行时
- [ ] 7.4 覆盖三份 spec 的关键场景：会话隔离、跨重启持久化、流式增量、审批批准/拒绝 — ⏳ 需本机 GUI 运行时
