import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileTool } from "../../src/core/tools/read_file.js";
import { listDirTool } from "../../src/core/tools/list_dir.js";
import { writeFileTool } from "../../src/core/tools/write_file.js";
import { editFileTool } from "../../src/core/tools/edit_file.js";
import { grepTool } from "../../src/core/tools/grep.js";
import { runBashTool } from "../../src/core/tools/run_bash.js";

let ws: string;

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), "happyagent-tools-"));
  process.env.HAPPYAGENT_WORKDIR = ws;
  writeFileSync(join(ws, "a.txt"), "hello\nworld\nfoo bar");
});

afterAll(() => {
  rmSync(ws, { recursive: true, force: true });
  delete process.env.HAPPYAGENT_WORKDIR;
});

describe("read_file", () => {
  it("按工作区相对路径读取存在的文件", async () => {
    expect(await readFileTool.invoke({ path: "a.txt" })).toContain("hello");
  });
  it("读取不存在的文件返回可读错误而非抛出", async () => {
    const r = await readFileTool.invoke({ path: "nope.txt" });
    expect(r).toMatch(/不存在/);
  });
});

describe("write_file + edit_file", () => {
  it("写入后能读回", async () => {
    await writeFileTool.invoke({ path: "sub/b.txt", content: "abc" });
    expect(await readFileTool.invoke({ path: "sub/b.txt" })).toBe("abc");
  });
  it("edit_file 唯一片段替换成功", async () => {
    await writeFileTool.invoke({ path: "c.txt", content: "one two three" });
    await editFileTool.invoke({ path: "c.txt", old_text: "two", new_text: "TWO" });
    expect(await readFileTool.invoke({ path: "c.txt" })).toBe("one TWO three");
  });
  it("edit_file 片段不存在时报错且不改动", async () => {
    const r = await editFileTool.invoke({ path: "c.txt", old_text: "zzz", new_text: "x" });
    expect(r).toMatch(/未找到/);
  });
});

describe("list_dir + grep", () => {
  it("list_dir 列出条目", async () => {
    const r = await listDirTool.invoke({ path: "." });
    expect(r).toContain("a.txt");
  });
  it("grep 找到匹配行", async () => {
    const r = await grepTool.invoke({ pattern: "foo", path: "." });
    expect(r).toMatch(/a\.txt.*foo/);
  });
});

describe("run_bash", () => {
  it("执行命令返回 stdout 与退出码", async () => {
    const r = await runBashTool.invoke({ command: "echo hi" });
    expect(r).toContain("hi");
    expect(r).toContain("退出码: 0");
  });
  it("在工作区目录执行（pwd 为工作区）", async () => {
    const r = await runBashTool.invoke({ command: "pwd" });
    // macOS 上 tmpdir 可能带 /private 前缀，做包含匹配
    expect(r).toMatch(/happyagent-tools-/);
  });
  it("非零退出码不抛出，回灌退出码", async () => {
    const r = await runBashTool.invoke({ command: "exit 3" });
    expect(r).toContain("退出码: 3");
  });
});
