## 1. 项目初始化与 submodule

- [x] 1.1 以 submodule 引入 langgraphjs：`git submodule add git@github.com:langchain-ai/langgraphjs.git vendor/langgraphjs`，并 `git submodule update --init --recursive`
- [x] 1.2 初始化 TypeScript 项目：`package.json`、`tsconfig.json`，安装 `@langchain/langgraph`、`@langchain/openai`、`@langchain/core`、`zod`、`dotenv`，开发依赖 `typescript`、`tsx`
- [x] 1.3 约定环境变量：新建 `.env.example`（含 `MOONSHOT_API_KEY`），并在 `.gitignore` 忽略 `.env` 与 `node_modules`
- [x] 1.4 写 `README.md`：说明项目目标、`git submodule update --init` 用法、如何配置密钥与运行

## 2. Phase 0 · 冒烟测试（消除唯一未知数）

- [x] 2.1 实现模型层 `src/model.ts`：`ChatOpenAI` 指向 Moonshot（`baseURL`、`kimi-k2.6`、读 `MOONSHOT_API_KEY`）；缺少密钥时给出清晰报错
- [x] 2.2 写一个 `src/smoke.ts`：绑定一个假工具，向 Kimi 发一条会触发工具的消息，打印返回的 `tool_calls`，确认能拿到规范的工具名+结构化参数
- [x] 2.3 运行冒烟测试并确认通过：Kimi 稳定返回规范 `tool_calls`，唯一未知数消除（附带修复：`kimi-k2.6` 只接受 `temperature=1`）

## 3. Phase 1 · 先跑起来（createReactAgent + 四件套 + CLI）

- [x] 3.1 实现 `src/tools/read_file.ts`（读文件，文件不存在时返回清晰错误）
- [x] 3.2 实现 `src/tools/list_dir.ts`（列目录条目）
- [x] 3.3 实现 `src/tools/write_file.ts`（写/覆盖文件，返回成功确认）
- [x] 3.4 实现 `src/tools/run_bash.ts`（执行命令，返回 stdout/stderr/退出码；失败不抛出中断）
- [x] 3.5 实现 `src/agent.ts`：`createReactAgent({ llm, tools })` 组装四件套
- [x] 3.6 实现 `src/cli.ts`：接收命令行任务描述，`agent.stream(...)` 流式打印思考、工具调用与最终答复；设置最大步数上限
- [x] 3.7 端到端验证：agent 调用 read_file 读取 package.json 后正确总结依赖；多步工具调用 → 最终答复链路跑通

## 4. Phase 2 · 回头拆（手写 StateGraph 复刻 + 补工具）

- [x] 4.1 实现 `src/graph.ts`：手写 `StateGraph`（`MessagesAnnotation` + `llmCall` 节点 + `ToolNode` + `shouldContinue` 条件边），功能对齐 `createReactAgent`
- [x] 4.2 让 CLI 可切换"预制版 / 手写版"（`--graph` 开关）；并排一致性由用户用真实密钥跑同一任务比对
- [x] 4.3 补充 `src/tools/grep.ts`（按模式搜代码）与 `src/tools/edit_file.ts`（旧文本→新文本的精准替换）
- [x] 4.4 撰写简短笔记 `docs/notes-phase2.md`，对照说明"手写图的每个原语对应 createReactAgent 内部的什么"

## 5. Phase 3 · 进阶（记忆 + 人工审批）

- [x] 5.1 接入 Checkpointer（`MemorySaver`），用 `thread_id` 支持多轮/续跑（`--thread` 开关）
- [x] 5.2 在 `run_bash` 执行前用 `interrupt` 暂停并展示待执行命令，等待用户批准/拒绝（`--hitl` 开关）
- [x] 5.3 处理审批结果：批准则执行并继续；拒绝则把"已被用户拒绝"作为工具结果回灌给模型
- [x] 5.4 端到端验证 HITL：批准路径执行命令并回灌输出；拒绝路径把"已被用户拒绝"回灌给模型（附带修复：拒绝时需 `resume: { approved:false }`，直接传 `false` 会被 LangGraph 当空 Command 报错）

## 6. 收尾

- [x] 6.1 用 spec 中的场景逐条自测：模型接入/缺少密钥、tool_calls、read_file、list_dir、run_bash 成功与失败、多步 ReAct、CLI、HITL 批准/拒绝 均已实跑通过
- [x] 6.2 更新 README：补充四个 Phase 的运行示例与一张 ReAct 循环示意图
- [x] 6.3 运行 `openspec validate build-kimi-coding-agent --strict` 确认无误
