/**
 * edit_file 工具：把文件中某段精确的旧文本替换为新文本。
 *
 * 比 write_file 整体覆盖更安全：只改动指定片段，且要求旧文本在文件中
 * 唯一出现，避免误改多处或改错位置。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFile, writeFile } from "node:fs/promises";

export const editFileTool = tool(
  async ({
    path,
    old_text,
    new_text,
  }: {
    path: string;
    old_text: string;
    new_text: string;
  }): Promise<string> => {
    let content: string;
    try {
      content = await readFile(path, "utf-8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return `错误：文件不存在: ${path}`;
      return `错误：读取文件失败 (${path}): ${e.message}`;
    }

    const occurrences = content.split(old_text).length - 1;
    if (occurrences === 0) {
      return `错误：在 ${path} 中未找到指定的 old_text，未做任何修改。`;
    }
    if (occurrences > 1) {
      return `错误：old_text 在 ${path} 中出现了 ${occurrences} 次（要求唯一）。请提供更长、更具上下文的片段。`;
    }

    const updated = content.replace(old_text, new_text);
    try {
      await writeFile(path, updated, "utf-8");
    } catch (err) {
      return `错误：写回文件失败 (${path}): ${(err as Error).message}`;
    }
    return `已修改 ${path}：替换了 1 处片段。`;
  },
  {
    name: "edit_file",
    description:
      "将文件中一段唯一出现的旧文本精确替换为新文本。若 old_text 不存在或出现多次则报错、不改动。",
    schema: z.object({
      path: z.string().describe("要修改的文件路径"),
      old_text: z.string().describe("要被替换的原文片段（必须在文件中唯一出现）"),
      new_text: z.string().describe("替换后的新文本"),
    }),
  },
);
