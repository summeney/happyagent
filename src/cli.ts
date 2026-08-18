/**
 * 命令行入口。
 *
 * 用法：
 *   npm run agent -- "读取 package.json 并告诉我依赖了哪些包"
 *
 * 可选开关：
 *   --hitl             执行 run_bash 前需人工审批
 *   --thread <id>      指定会话 id（配合记忆/续跑，默认 "cli-session"）
 *   --model <name>     指定模型名（默认 kimi-k2.6）
 *
 * 例：
 *   npm run agent -- --hitl "运行 npm run typecheck"
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { buildGraph } from "./graph.js";
import { setBashApprovalEnabled } from "./tools/index.js";
import { initTracing } from "./tracing.js";

interface CliOptions {
  task: string;
  hitl: boolean;
  threadId: string;
  model?: string;
}

function parseArgs(argv: string[]): CliOptions {
  let hitl = false;
  let threadId = "cli-session";
  let model: string | undefined;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--hitl") hitl = true;
    else if (a === "--thread") threadId = argv[++i] ?? threadId;
    else if (a === "--model") model = argv[++i];
    else rest.push(a);
  }

  return { task: rest.join(" ").trim(), hitl, threadId, model };
}

function truncate(text: string, max = 800): string {
  return text.length > max ? `${text.slice(0, max)}…（省略 ${text.length - max} 字）` : text;
}

/** 打印一次 "updates" 流的节点更新：AI 思考、工具调用、工具结果。 */
function printUpdate(chunk: Record<string, unknown>): void {
  for (const update of Object.values(chunk)) {
    const messages = (update as { messages?: BaseMessage[] } | undefined)?.messages;
    if (!messages) continue;
    for (const m of messages) {
      const type = m.getType();
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      if (type === "ai") {
        if (text.trim()) console.log(`\n🤖 ${text.trim()}`);
        const toolCalls = (m as { tool_calls?: { name: string; args: unknown }[] }).tool_calls ?? [];
        for (const tc of toolCalls) {
          console.log(`  🔧 调用 ${tc.name}(${truncate(JSON.stringify(tc.args), 200)})`);
        }
      } else if (type === "tool") {
        console.log(`  ↳ ${truncate(text)}`);
      }
    }
  }
}

/** HITL：向用户展示待执行命令并询问是否批准。 */
async function askApproval(value: unknown): Promise<boolean> {
  const command =
    typeof value === "object" && value !== null && "command" in value
      ? String((value as { command: unknown }).command)
      : JSON.stringify(value);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\n⏸️  agent 想执行命令：\n    $ ${command}`);
    const answer = (await rl.question("   批准执行？[y/N] ")).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.task) {
    console.error('用法：npm run agent -- "你的任务描述" [--hitl] [--thread <id>] [--model <name>]');
    process.exitCode = 1;
    return;
  }

  if (opts.hitl) setBashApprovalEnabled(true);

  // tracing：配了 Langfuse 密钥就记录 trace，没配就是 no-op（agent 照常跑）。
  // handler 挂到下面 stream 的 config.callbacks 上，thread_id 作为 sessionId 分组。
  const tracing = initTracing();
  const handler = tracing.createHandler(opts.threadId);

  // HITL 或指定线程时需要 checkpointer（interrupt/续跑都依赖它保存状态）
  const checkpointer = opts.hitl ? new MemorySaver() : undefined;

  const app = buildGraph({ checkpointer, model: opts.model });

  console.log(`▶ 运行 coding agent（手写 StateGraph${opts.hitl ? " · HITL 审批开" : ""}）`);
  console.log(`  任务：${opts.task}`);

  const config = {
    configurable: { thread_id: opts.threadId },
    recursionLimit: 50, // 步数上限，防止无限循环
    // 挂上 Langfuse callback：LangGraph 会把它自动传播到每个节点 / LLM / 工具调用，
    // 所以 agent.ts 与 graph.ts 两条路都不用改。未启用 tracing 时不注入。
    ...(handler ? { callbacks: [handler] } : {}),
  };

  // 有 interrupt 时需要循环：stream 中断 → 询问 → Command({ resume }) 恢复
  let input: { messages: BaseMessage[] } | Command = {
    messages: [new HumanMessage(opts.task)],
  };

  try {
    while (true) {
      for await (const chunk of await app.stream(input, { ...config, streamMode: "updates" })) {
        if ((chunk as Record<string, unknown>).__interrupt__) continue; // 中断信号，下面统一处理
        printUpdate(chunk as Record<string, unknown>);
      }

      if (!checkpointer) break; // 无 checkpointer 不会有 interrupt

      const state = await app.getState(config);
      const pending = (state.tasks ?? []).flatMap((t) => t.interrupts ?? []);
      if (pending.length === 0) break;

      const approved = await askApproval(pending[0].value);
      // 用对象包裹决定：LangGraph 会把 falsy 的 resume 当成"空 Command"报错，
      // 所以拒绝时不能直接传 false。run_bash 里按 { approved } 解析。
      input = new Command({ resume: { approved } });
    }

    console.log("\n✅ 完成。");
  } finally {
    // 短命 CLI：退出前刷新，保证 trace 不因进程提前退出而丢失。
    // 正常完成与抛异常两条路径都会走到这里（异常随后由 main().catch 打印）。
    await tracing.flush();
  }
}

main().catch((err) => {
  console.error("\n❌ 运行出错：", err.message);
  process.exitCode = 1;
});
