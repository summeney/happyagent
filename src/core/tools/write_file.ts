/** write_file 工具：写入/覆盖一个文件（自动创建所需的父目录）。 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const writeFileTool = tool(
  async ({ path, content }: { path: string; content: string }): Promise<string> => {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf-8");
      return `已写入 ${path}（${content.length} 字符）`;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      return `错误：写入文件失败 (${path}): ${e.message}`;
    }
  },
  {
    name: "write_file",
    description:
      "将内容写入指定文件（若文件存在则整体覆盖，不存在则新建，必要时创建父目录）。",
    schema: z.object({
      path: z.string().describe("要写入的文件路径"),
      content: z.string().describe("要写入的完整文本内容"),
    }),
  },
);
