/**
 * 嵌入式运行时（createEmbedServer）。
 *
 * 用 `@langchain/langgraph-api/experimental/embed` 在**进程内**起一个 LangGraph
 * Platform 路由子集（Hono app，经 @hono/node-server serve），注入：
 *   - graph        —— buildGraph()（不带 checkpointer 编译，由 server 注入持久化）
 *   - checkpointer —— 落盘的 NodeSqliteSaver（会话"内容"跨重启保留）
 *   - threads      —— 落盘的 ThreadSaver（会话"目录"）
 *
 * 无 CLI、无 Docker、无子进程 spawn。渲染层经 HTTP/SSE 访问（见 design.md D3）。
 * 该模块设计为可在 utilityProcess 中运行（把同步 SQLite 写与 graph 工作挪出 UI 线程）。
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createEmbedServer } from "@langchain/langgraph-api/experimental/embed";
import { buildGraph } from "../../core/graph.js";
import { allTools } from "../../core/tools/index.js";
import { loadMcpTools } from "../../core/mcp/index.js";
import { initTracing } from "../../core/tracing.js";
import { createSqliteCheckpointer } from "../../core/session/checkpointer.js";
import { createThreadSaver } from "./thread-store.js";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export interface RuntimeOptions {
  /** 数据目录（落盘 checkpointer 与 threads 各占一个 .db 文件）。 */
  dbDir: string;
  /** 监听端口；0 表示随机可用端口。 */
  port?: number;
  /** 模型名（可选，透传给 buildGraph）。 */
  model?: string;
}

export interface RuntimeHandle {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** 启动嵌入式运行时 server，仅监听回环地址。 */
export async function startRuntime(options: RuntimeOptions): Promise<RuntimeHandle> {
  const { dbDir, port = 0, model } = options;
  mkdirSync(dbDir, { recursive: true });

  const checkpointer = createSqliteCheckpointer(join(dbDir, "checkpoints.db"));
  const threads = createThreadSaver(join(dbDir, "threads.db"));
  // 合并内置工具与 MCP 工具（MCP 缺省/失败时降级为仅内置工具）
  const mcpTools = await loadMcpTools(join(dbDir, "mcp.json"));
  const baseGraph = buildGraph({ model, tools: [...allTools, ...mcpTools] });

  // tracing：配了 Langfuse 密钥则把 handler 烘焙进 graph（callbacks 沿图传播，
  // 覆盖每次 LLM 与工具调用）；未配则为 no-op（见 core/tracing.ts）。
  const tracing = initTracing();
  const graph = tracing.handler
    ? baseGraph.withConfig({ callbacks: [tracing.handler] })
    : baseGraph;

  const app = new Hono();
  app.use("*", cors({ origin: "*", exposeHeaders: ["Content-Location"] }));
  const embedApp = createEmbedServer({
    graph: { agent: graph as never },
    checkpointer,
    threads,
  });
  app.route("/", embedApp);

  const { server, boundPort } = await new Promise<{ server: ReturnType<typeof serve>; boundPort: number }>(
    (resolve) => {
      const s = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
        resolve({ server: s, boundPort: info.port });
      });
    },
  );

  return {
    url: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          threads.close();
          void tracing.flush().finally(() => resolve());
        });
      }),
  };
}
