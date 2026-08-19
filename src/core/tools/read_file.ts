/**
 * read_file 工具：读取一个文件的文本内容。
 *
 * 每把工具 = 一个函数 + 一份给模型看的说明（name/description/schema）。
 * description 和参数 schema 写得清不清楚，直接决定 Kimi 会不会、能不能正确调用它。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolveInWorkspace } from "../workspace.js";

export const readFileTool = tool(
  async ({ path }: { path: string }): Promise<string> => {
    try {
      return await readFile(resolveInWorkspace(path), "utf-8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        return `错误：文件不存在: ${path}`;
      }
      return `错误：读取文件失败 (${path}): ${e.message}`;
    }
  },
  {
    name: "read_file",
    description: "读取指定路径文件的完整文本内容。用于查看代码或配置。",
    schema: z.object({
      path: z.string().describe("要读取的文件路径（相对或绝对）"),
    }),
  },
);
