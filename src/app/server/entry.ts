/**
 * utilityProcess 入口：在独立进程中运行嵌入式运行时。
 *
 * 由 main（监工）经 `utilityProcess.fork` 拉起。把同步 SQLite 写与 graph 工作
 * 隔离出 UI 线程，并获得崩溃隔离（见 design.md D3）。
 *
 * 与 main 的握手（经 parentPort）：
 *   子 → 父：{ type: "ready", url } | { type: "error", message }
 *   父 → 子：{ type: "shutdown" }
 *
 * 配置经 env 传入：HAPPYAGENT_DB_DIR（必填）、HAPPYAGENT_PORT、HAPPYAGENT_MODEL。
 */
import "dotenv/config";
import { startRuntime, type RuntimeHandle } from "./runtime.js";

// agent 的工作目录经 HAPPYAGENT_WORKDIR 传入，由 core/workspace.ts 在工具调用时读取
// （工具不依赖 process.cwd()，见 design.md Open Questions）。

// utilityProcess 中通过 process.parentPort 与父进程通信。
const parentPort = (process as unknown as {
  parentPort?: { postMessage(m: unknown): void; on(e: "message", cb: (e: { data: unknown }) => void): void };
}).parentPort;

let handle: RuntimeHandle | null = null;

async function main(): Promise<void> {
  const dbDir = process.env.HAPPYAGENT_DB_DIR;
  if (!dbDir) throw new Error("缺少 HAPPYAGENT_DB_DIR");
  const port = process.env.HAPPYAGENT_PORT ? Number(process.env.HAPPYAGENT_PORT) : 0;

  handle = await startRuntime({ dbDir, port, model: process.env.HAPPYAGENT_MODEL });
  parentPort?.postMessage({ type: "ready", url: handle.url });
}

parentPort?.on("message", async (e) => {
  const msg = e.data as { type?: string } | undefined;
  if (msg?.type === "shutdown") {
    await handle?.close();
    process.exit(0);
  }
});

main().catch((err) => {
  parentPort?.postMessage({
    type: "error",
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
