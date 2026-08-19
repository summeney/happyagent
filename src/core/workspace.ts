/**
 * 工作区根目录。
 *
 * agent 的文件工具与 run_bash 以此为相对路径的根，而非依赖 `process.cwd()`
 * ——后者在 embed server 的 worker 执行上下文里不确定（见 design.md D3 / Open
 * Questions：工作目录未来应可按会话/项目选择）。
 *
 * 由环境变量 `HAPPYAGENT_WORKDIR` 指定；缺省回落到进程 cwd。
 */
import { resolve, isAbsolute } from "node:path";

/** 当前工作区根目录的绝对路径。 */
export function workspaceRoot(): string {
  return process.env.HAPPYAGENT_WORKDIR || process.cwd();
}

/** 把（可能是相对的）路径解析为工作区内的绝对路径。 */
export function resolveInWorkspace(p: string): string {
  return isAbsolute(p) ? p : resolve(workspaceRoot(), p);
}
