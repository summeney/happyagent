/**
 * LangGraph Server 的 graph 注册入口（spike）。
 *
 * server 自己按 thread 管理持久化，所以这里编译一个**不带 checkpointer**
 * 的 graph；`langgraph.json` 的 graphs.agent 指向此文件导出的 `graph`。
 */
import { buildGraph } from "./graph.js";

export const graph = buildGraph();
