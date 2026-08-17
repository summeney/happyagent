/**
 * run_bash 工具：执行一条 shell 命令，返回 stdout/stderr/退出码。
 *
 * ⚠️ 这把工具能执行任意命令，是最危险的一把。
 *   - Phase 1/2：裸跑（approval 关闭）。
 *   - Phase 3：打开人工审批（setBashApprovalEnabled(true)）后，执行前会通过
 *     LangGraph 的 `interrupt` 暂停并把待执行命令抛给用户确认。
 *
 * 注意：命令失败（非零退出码）不会抛异常中断整个 agent，而是把退出码和
 * 输出一并回灌给模型，让它自己决定下一步。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { interrupt } from "@langchain/langgraph";

const pexec = promisify(exec);

/** 是否在执行前请求人工审批（Phase 3 打开）。 */
let approvalEnabled = false;

/** 开关人工审批。CLI 在 --hitl 模式下调用它。 */
export function setBashApprovalEnabled(enabled: boolean): void {
  approvalEnabled = enabled;
}

function format(stdout: string, stderr: string, code: number): string {
  const parts = [`退出码: ${code}`];
  if (stdout.trim()) parts.push(`stdout:\n${stdout.trim()}`);
  if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`);
  if (!stdout.trim() && !stderr.trim()) parts.push("（无输出）");
  return parts.join("\n");
}

export const runBashTool = tool(
  async ({ command }: { command: string }): Promise<string> => {
    // —— Phase 3：危险操作人工审批 ——
    // interrupt 会中断图的执行，把这个 payload 抛给外层；外层用
    // Command({ resume: <决定> }) 恢复时，interrupt 的返回值即为该决定。
    if (approvalEnabled) {
      const decision = interrupt({ type: "approve_bash", command }) as unknown;
      const approved =
        decision === true ||
        decision === "approve" ||
        decision === "y" ||
        (typeof decision === "object" && decision !== null && (decision as { approved?: boolean }).approved === true);
      if (!approved) {
        return `已被用户拒绝执行该命令：${command}`;
      }
    }

    try {
      const { stdout, stderr } = await pexec(command, {
        timeout: 60_000,
        maxBuffer: 1024 * 1024,
      });
      return format(stdout, stderr, 0);
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      // exec 在非零退出码时会 reject，但 err 上仍带着 stdout/stderr/code。
      return format(e.stdout ?? "", e.stderr ?? e.message ?? "", e.code ?? 1);
    }
  },
  {
    name: "run_bash",
    description:
      "在系统 shell 中执行一条命令并返回其 stdout、stderr 和退出码。用于运行测试、编译、git 等。",
    schema: z.object({
      command: z.string().describe("要执行的完整 shell 命令"),
    }),
  },
);
