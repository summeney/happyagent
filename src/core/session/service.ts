/**
 * 会话服务：桌面端主进程与命令行共用的会话运行时门面。
 *
 * 把三样东西粘在一起：
 *   - buildGraph()   —— agent 的唯一运行时（手写 StateGraph）
 *   - SqliteSaver    —— 会话内容的跨重启持久化（checkpointer）
 *   - SessionStore   —— 会话目录（补 checkpointer 缺失的"列出全部会话"）
 *
 * 对外暴露：列出 / 新建 / 读历史 / 发消息（流式事件）/ 审批解析。
 * 运行时的 interrupt/resume 循环与 chunk 分类逻辑，与 cli.ts 同源，只是把
 * "打印"换成"发事件"、把 readline 审批换成一个可被外部 resolve 的 Promise。
 */
import { randomUUID } from "node:crypto";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import { buildGraph } from "../graph.js";
import { setBashApprovalEnabled } from "../tools/index.js";
import { createSqliteCheckpointer } from "./checkpointer.js";
import { SessionStore } from "./store.js";
import type { RunEvent, UiMessage, SessionMeta } from "../../shared/ipc.js";

export type { RunEvent, UiMessage, SessionMeta } from "../../shared/ipc.js";

export type EmitFn = (event: RunEvent) => void;

export interface SessionServiceOptions {
  dbPath: string;
  model?: string;
  /** 是否对 run_bash 启用人工审批（默认关）。 */
  approval?: boolean;
}

/** 标题取首条用户消息的首行截断。 */
function truncateTitle(text: string, max = 40): string {
  const firstLine = text.trim().split("\n", 1)[0] ?? "";
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine || "新会话";
}

/** 从 interrupt 载荷里取出待执行命令字符串。 */
function extractCommand(value: unknown): string {
  if (typeof value === "object" && value !== null && "command" in value) {
    return String((value as { command: unknown }).command);
  }
  return JSON.stringify(value);
}

/** 把一条 LangChain 消息转成可序列化的 UI 消息；系统消息返回 null 被过滤。 */
function toUiMessage(m: BaseMessage): UiMessage | null {
  const type = m.getType();
  const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
  if (type === "human") return { role: "user", text };
  if (type === "ai") {
    const toolCalls =
      (m as { tool_calls?: { name: string; args: unknown }[] }).tool_calls ?? [];
    return { role: "ai", text, toolCalls };
  }
  if (type === "tool") return { role: "tool", text };
  return null;
}

export class SessionService {
  private store: SessionStore;
  private app: ReturnType<typeof buildGraph>;
  /** 全局单会话运行锁（design D7：同一时刻仅一个会话生成中）。 */
  private running = false;
  /** 待审批：runId → resolve(approved)。 */
  private pendingApprovals = new Map<string, (approved: boolean) => void>();

  constructor(opts: SessionServiceOptions) {
    this.store = new SessionStore(opts.dbPath);
    const checkpointer = createSqliteCheckpointer(opts.dbPath);
    setBashApprovalEnabled(Boolean(opts.approval));
    this.app = buildGraph({ checkpointer, model: opts.model });
  }

  /** 运行时开关人工审批（对应 UI 设置项）。 */
  setApproval(enabled: boolean): void {
    setBashApprovalEnabled(enabled);
  }

  /** 是否有会话正在生成。 */
  isRunning(): boolean {
    return this.running;
  }

  /** 列出全部会话，按最近更新倒序。 */
  list(): SessionMeta[] {
    return this.store.list();
  }

  /** 新建空会话并返回其元数据。 */
  create(): SessionMeta {
    return this.store.create(randomUUID());
  }

  /** 读回某会话的历史消息（经 checkpointer）。空会话返回空数组。 */
  async history(threadId: string): Promise<UiMessage[]> {
    const snapshot = await this.app.getState({
      configurable: { thread_id: threadId },
    });
    const messages = (snapshot?.values?.messages ?? []) as BaseMessage[];
    return messages
      .map(toUiMessage)
      .filter((m): m is UiMessage => m !== null);
  }

  /** 外部（渲染层的审批弹窗）对某次 interrupt 给出批准 / 拒绝。 */
  resolveApproval(runId: string, approved: boolean): void {
    const resolve = this.pendingApprovals.get(runId);
    if (resolve) {
      resolve(approved);
      this.pendingApprovals.delete(runId);
    }
  }

  private waitApproval(runId: string): Promise<boolean> {
    return new Promise((resolve) => this.pendingApprovals.set(runId, resolve));
  }

  /** 把一次 stream 的 chunk 归一化为事件（分类逻辑与 cli.printUpdate 同源）。 */
  private emitFromChunk(
    chunk: Record<string, unknown>,
    runId: string,
    threadId: string,
    emit: EmitFn,
  ): void {
    for (const update of Object.values(chunk)) {
      const messages = (update as { messages?: BaseMessage[] } | undefined)?.messages;
      if (!messages) continue;
      for (const m of messages) {
        const type = m.getType();
        const text =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        if (type === "ai") {
          if (text.trim()) emit({ type: "run:ai", runId, threadId, text: text.trim() });
          const toolCalls =
            (m as { tool_calls?: { name: string; args: unknown }[] }).tool_calls ?? [];
          for (const tc of toolCalls) {
            emit({ type: "run:tool_call", runId, threadId, name: tc.name, args: tc.args });
          }
        } else if (type === "tool") {
          emit({ type: "run:tool_result", runId, threadId, text });
        }
      }
    }
  }

  /**
   * 向指定会话发一条消息，流式发出运行事件。
   *
   * 同一时刻只允许一个会话运行；重复提交会抛错（渲染层据此禁用输入）。
   * 命中 interrupt 时发 run:interrupt 并等待外部 resolveApproval。
   */
  async send(threadId: string, text: string, emit: EmitFn): Promise<void> {
    if (this.running) {
      throw new Error("已有会话正在生成，请等待本轮结束。");
    }
    if (!this.store.get(threadId)) {
      throw new Error(`会话不存在：${threadId}`);
    }

    this.running = true;
    const runId = randomUUID();
    try {
      // 首条用户消息 → 生成会话标题
      this.store.setTitleIfEmpty(threadId, truncateTitle(text));

      const config = {
        configurable: { thread_id: threadId },
        recursionLimit: 50,
      };
      let input: { messages: BaseMessage[] } | Command = {
        messages: [new HumanMessage(text)],
      };

      // interrupt 循环：stream 中断 → 发 interrupt 事件 → 等审批 → Command 恢复
      while (true) {
        // 注：此运行循环（含 interrupt/审批与单会话锁）将在 Group 4 随迁移到
        // LangGraph Server 而整体移除；此处 input 的类型转换仅为过渡期编译通过。
        for await (const chunk of await this.app.stream(input as never, {
          ...config,
          streamMode: "updates",
        })) {
          if ((chunk as Record<string, unknown>).__interrupt__) continue;
          this.emitFromChunk(chunk as Record<string, unknown>, runId, threadId, emit);
        }

        const state = await this.app.getState(config);
        const pending = (state.tasks ?? []).flatMap((t) => t.interrupts ?? []);
        if (pending.length === 0) break;

        emit({
          type: "run:interrupt",
          runId,
          threadId,
          command: extractCommand(pending[0].value),
        });
        const approved = await this.waitApproval(runId);
        input = new Command({ resume: { approved } });
      }

      this.store.touch(threadId);
      emit({ type: "run:done", runId, threadId });
    } catch (err) {
      emit({
        type: "run:error",
        runId,
        threadId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.running = false;
      this.pendingApprovals.delete(runId);
    }
  }

  close(): void {
    this.store.close();
  }
}
