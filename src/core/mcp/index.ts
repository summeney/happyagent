/**
 * MCP 接入：按配置连接外部 MCP server，把其工具并入 agent 工具集。
 *
 * 配置文件（JSON）格式（标准 MCP）：
 *   { "mcpServers": { "<name>": { "command": "...", "args": [...] } | { "url": "..." } } }
 *
 * 路径优先级：环境变量 HAPPYAGENT_MCP_CONFIG > 传入的默认路径（通常 userData/mcp.json）。
 * 无配置 / 空配置 / 连接失败时，一律返回可用工具（可能为空），绝不让 agent 崩溃
 * （mcp-integration：故障降级）。`throwOnLoadError: false` 使单个 server 失败被跳过。
 */
import { readFileSync, existsSync } from "node:fs";
import type { StructuredToolInterface } from "@langchain/core/tools";

/** 解析生效的 MCP 配置文件路径（不存在返回 undefined）。 */
export function resolveMcpConfigPath(defaultPath?: string): string | undefined {
  const p = process.env.HAPPYAGENT_MCP_CONFIG || defaultPath;
  return p && existsSync(p) ? p : undefined;
}

/** 加载 MCP 工具；任何失败都降级为返回已成功的工具（可能为空）。 */
export async function loadMcpTools(defaultPath?: string): Promise<StructuredToolInterface[]> {
  const path = resolveMcpConfigPath(defaultPath);
  if (!path) return [];

  let servers: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { mcpServers?: Record<string, unknown> };
    servers = parsed.mcpServers ?? {};
  } catch (e) {
    console.error(`MCP 配置解析失败（${path}），跳过 MCP：`, (e as Error).message);
    return [];
  }
  if (Object.keys(servers).length === 0) return [];

  try {
    const { MultiServerMCPClient } = await import("@langchain/mcp-adapters");
    const client = new MultiServerMCPClient({
      mcpServers: servers as never,
      throwOnLoadError: false, // 单个 server 失败则跳过其工具，不抛
      prefixToolNameWithServerName: true,
      useStandardContentBlocks: true,
    });
    const tools = (await client.getTools()) as unknown as StructuredToolInterface[];
    console.error(`MCP：接入 ${tools.length} 个工具（配置 ${Object.keys(servers).length} 个 server）`);
    return tools;
  } catch (e) {
    console.error("MCP 连接整体失败，agent 以内置工具继续运行：", (e as Error).message);
    return [];
  }
}
