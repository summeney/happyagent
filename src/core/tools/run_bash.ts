/**
 * run_bash 工具：执行一条 shell 命令，返回 stdout/stderr/退出码。
 *
 * ⚠️ 这把工具能执行任意命令，是最危险的一把。本项目定位为作者本机个人使用、
 * 默认全权限，不设人工审批（见 design.md D6）；如需限制，请在操作系统层面
 * （受限用户/沙箱）约束应用运行环境。
 *
 * 注意：命令失败（非零退出码）不会抛异常中断整个 agent，而是把退出码和
 * 输出一并回灌给模型，让它自己决定下一步。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { workspaceRoot } from "../workspace.js";

const pexec = promisify(exec);

/** 长线任务超时上限（10 分钟）与更大的输出缓冲。 */
const TIMEOUT_MS = 600_000;
const MAX_BUFFER = 10 * 1024 * 1024;

function format(stdout: string, stderr: string, code: number): string {
  const parts = [`退出码: ${code}`];
  if (stdout.trim()) parts.push(`stdout:\n${stdout.trim()}`);
  if (stderr.trim()) parts.push(`stderr:\n${stderr.trim()}`);
  if (!stdout.trim() && !stderr.trim()) parts.push("（无输出）");
  return parts.join("\n");
}

export const runBashTool = tool(
  async ({ command }: { command: string }): Promise<string> => {
    try {
      const { stdout, stderr } = await pexec(command, {
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        cwd: workspaceRoot(),
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
