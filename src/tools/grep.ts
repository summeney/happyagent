/**
 * grep 工具：在目录树里按正则搜索匹配的代码行。
 *
 * 存在意义：代码库很大时无法把所有文件都塞进上下文，agent 需要先"搜"
 * 再按需 read_file。这是 coding agent 处理大项目的最小上下文管理手段。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "vendor", "dist"]);
const MAX_RESULTS = 200;

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_RESULTS) return;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(join(dir, e.name), out);
    } else if (e.isFile()) {
      out.push(join(dir, e.name));
    }
  }
}

export const grepTool = tool(
  async ({ pattern, path }: { pattern: string; path?: string }): Promise<string> => {
    const root = path ?? ".";
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch (err) {
      return `错误：无效的正则表达式 "${pattern}": ${(err as Error).message}`;
    }

    try {
      const st = await stat(root);
      if (!st.isDirectory()) return `错误：不是目录: ${root}`;
    } catch {
      return `错误：路径不存在: ${root}`;
    }

    const files: string[] = [];
    await walk(root, files);

    const hits: string[] = [];
    for (const file of files) {
      if (hits.length >= MAX_RESULTS) break;
      let content: string;
      try {
        content = await readFile(file, "utf-8");
      } catch {
        continue; // 跳过二进制/无法读取的文件
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          hits.push(`${file}:${i + 1}: ${lines[i].trim()}`);
          if (hits.length >= MAX_RESULTS) break;
        }
      }
    }

    if (hits.length === 0) return `未找到匹配 "${pattern}" 的内容（搜索根目录: ${root}）`;
    const capped = hits.length >= MAX_RESULTS ? `\n（结果过多，仅显示前 ${MAX_RESULTS} 条）` : "";
    return hits.join("\n") + capped;
  },
  {
    name: "grep",
    description:
      "在目录树中按正则表达式搜索匹配的代码行，返回 文件:行号: 内容。自动跳过 node_modules/.git/vendor/dist。",
    schema: z.object({
      pattern: z.string().describe("要搜索的正则表达式"),
      path: z.string().optional().describe("搜索的根目录，默认当前目录 '.'"),
    }),
  },
);
