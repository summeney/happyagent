import { describe, it, expect, afterEach } from "vitest";
import { isAbsolute } from "node:path";
import { workspaceRoot, resolveInWorkspace } from "../../src/core/workspace.js";

afterEach(() => {
  delete process.env.HAPPYAGENT_WORKDIR;
});

describe("workspace", () => {
  it("HAPPYAGENT_WORKDIR 指定工作区根", () => {
    process.env.HAPPYAGENT_WORKDIR = "/tmp/ws";
    expect(workspaceRoot()).toBe("/tmp/ws");
  });

  it("未设置时回落到 process.cwd()", () => {
    expect(workspaceRoot()).toBe(process.cwd());
  });

  it("相对路径解析到工作区根", () => {
    process.env.HAPPYAGENT_WORKDIR = "/tmp/ws";
    expect(resolveInWorkspace("a/b.txt")).toBe("/tmp/ws/a/b.txt");
  });

  it("绝对路径原样返回", () => {
    process.env.HAPPYAGENT_WORKDIR = "/tmp/ws";
    const abs = "/etc/hosts";
    expect(resolveInWorkspace(abs)).toBe(abs);
    expect(isAbsolute(resolveInWorkspace(abs))).toBe(true);
  });
});
