## 1. 依赖与配置

- [x] 1.1 在 `package.json` 添加依赖:`@langfuse/langchain`、`@langfuse/otel`、`@opentelemetry/sdk-trace-node`,并 `npm install`
- [x] 1.2 在 `.env.example` 增加 `LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_BASE_URL`(默认 `http://localhost:3000`)三项及注释说明
- [x] 1.3 新增 `docker-compose.yml`(照 Langfuse 官方自托管配置),用于本地起 Langfuse

## 2. tracing 模块(src/tracing.ts)

- [x] 2.1 实现初始化函数:检测 `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` 是否存在
- [x] 2.2 有密钥时:注册 `NodeTracerProvider` + `LangfuseSpanProcessor`(读取 baseUrl/密钥环境变量),返回 `{ createHandler(sessionId), flush() }`
- [x] 2.3 `createHandler(sessionId)` 返回以 `sessionId` 构造的 `CallbackHandler`,用于会话分组
- [x] 2.4 无密钥时:返回 no-op 版本(`createHandler` 返回 `undefined`、`flush()` 为空操作),并打印一行「tracing 未启用」的提示,不抛错

## 3. 挂载到 CLI(src/cli.ts)

- [x] 3.1 在 `main()` 中初始化 tracing,用 `opts.threadId` 创建 handler
- [x] 3.2 在 `app.stream(input, config)` 的 config 里注入 `callbacks: [handler]`(handler 为 `undefined` 时不注入),不改动 `agent.ts` / `graph.ts`
- [x] 3.3 在 while 循环结束后 `await flush()`;并在 `main().catch` 的异常路径中同样 `await flush()`,保证正常与异常退出都不丢 trace

## 4. 文档

- [x] 4.1 README 增加 tracing 使用说明:起 Langfuse、建项目取密钥、填 `.env`、运行后在 UI 查看 trace
- [x] 4.2 新增 `docs/notes-trace.md`:说明 Langfuse trace 视图如何对应本项目的 ReAct 原语(LLM 节点 / 工具节点 / 条件边),并示范用同一任务对比 `createReactAgent` 与 `--graph` 两条 trace

## 5. 验证

- [x] 5.1 无密钥场景:未配置 Langfuse 时运行任意任务,终端输出与引入前一致、无 tracing 相关报错(验证优雅降级)
- [ ] 5.2 有密钥场景:配置密钥后运行含工具调用的任务,确认 Langfuse 中出现结构化 trace(LLM 调用 + 工具调用嵌套、含输入/输出与 token)
- [ ] 5.3 会话分组:以相同 `--thread <id>` 连续运行多次,确认归属同一 session
- [ ] 5.4 两路覆盖:默认模式与 `--graph` 模式各跑一次同任务,确认产生结构等价的 trace
- [x] 5.5 `npm run typecheck` 通过
