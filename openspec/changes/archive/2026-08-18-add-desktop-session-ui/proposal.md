## Why

当前 happyagent 是一次性命令行工具：跑一个 task 就退出，且并排维护着两套等价实现（`createReactAgent` 预制版与手写 `StateGraph`）。作为已经理解过原语的学习项目，预制版分支的对照价值已经兑现，继续保留只是维护负担。同时，"跑完即退"的形态无法支撑真正的编码协作——用户希望在一个图形界面里对同一个会话持续追问、并在多个会话间自由切换。本次变更收敛实现分支，并把项目从一次性 CLI 升级为常驻的桌面对话应用。

## What Changes

- **BREAKING** 移除 `createReactAgent` 预制版分支：删除 `src/agent.ts`、CLI 的 `--graph` 开关，以及对照文档 `docs/notes-phase2.md`。手写 `StateGraph`（`buildGraph`）成为唯一运行时。
- 新增 **Electron 桌面应用**：主进程（Node）直接运行 `buildGraph()` 与工具（fs / run_bash），渲染进程提供图形界面，二者通过 IPC 通信。
- 支持**同一会话内的持续交互**：常驻输入框，向同一 `thread_id` 反复追加消息并流式展示 AI 思考、工具调用、工具结果。
- 支持**多会话切换**：新建、列出、切换会话；会话历史由 LangGraph 官方的 `SqliteSaver` 持久化，跨应用重启保留。
- 新增**会话目录**：一张自建 `sessions` 元数据表（id / 标题 / 时间），补齐嵌入式 checkpointer 缺失的"列出所有会话"能力；标题取首条用户消息截断。
- **HITL 审批 UI 化**：`run_bash` 执行前的人工审批从命令行 `y/N` 改为界面弹窗，interrupt/resume 机制不变。
- CLI 入口保留但简化（同步移除 `--graph`，只走 `buildGraph`）。

## Capabilities

### New Capabilities
- `agent-runtime`: 编码 agent 的核心运行时——以手写 `StateGraph` 为唯一实现，绑定工具集、系统提示与模型，暴露构建入口供 CLI 与桌面端复用。
- `session-management`: 会话的持久化与目录管理——基于 `SqliteSaver` 的跨重启历史存储，加自建 `sessions` 目录表，支持新建 / 列出 / 切换会话。
- `desktop-ui`: Electron 桌面应用——会话列表、聊天记录、常驻输入框、流式展示与 `run_bash` 审批弹窗，通过 IPC 驱动主进程的 agent 运行时。

### Modified Capabilities
<!-- 本项目 openspec/specs/ 下暂无既有 capability spec，故不涉及既有 spec 的修改；agent 分支的移除以 agent-runtime 新增能力中的行为要求表达。 -->

## Impact

- **删除**：`src/agent.ts`、`docs/notes-phase2.md`。
- **修改**：`src/cli.ts`（移除 `--graph` / `buildAgent`，永远 `buildGraph`）、`src/tools/index.ts` 与相关注释中的 Phase 措辞、`README.md`（删除 Phase 1 段落与 `--graph` 文档，补桌面端用法）。
- **新增**：Electron 主进程 / 预加载 / 渲染进程代码、IPC 事件协议、会话服务（`SqliteSaver` + `sessions` 表）、HITL 审批弹窗前端。
- **依赖**：新增 `electron`、`@langchain/langgraph-checkpoint-sqlite`（及其 sqlite 驱动）；`package.json` 新增桌面端启动 / 打包脚本。
- **数据**：新增本地 SQLite 文件（同时承载 checkpointer 表与 `sessions` 目录表），需在 `.gitignore` 忽略。
