/** list_dir 工具：列出一个目录下的条目（目录名带尾部 "/"）。 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readdir } from "node:fs/promises";
import { resolveInWorkspace } from "../workspace.js";

export const listDirTool = tool(
  async ({ path }: { path: string }): Promise<string> => {
    try {
      const entries = await readdir(resolveInWorkspace(path), { withFileTypes: true });
      if (entries.length === 0) return `（空目录）${path}`;
      return entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join("\n");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return `错误：目录不存在: ${path}`;
      if (e.code === "ENOTDIR") return `错误：不是目录: ${path}`;
      return `错误：读取目录失败 (${path}): ${e.message}`;
    }
  },
  {
    name: "list_dir",
    description: "列出指定目录下的文件与子目录。子目录名以 / 结尾。",
    schema: z.object({
      path: z.string().describe("要列出的目录路径"),
    }),
  },
);
