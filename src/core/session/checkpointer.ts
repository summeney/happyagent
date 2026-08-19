/**
 * 持久 checkpointer 工厂。
 *
 * 用 `node:sqlite`（运行时内置）手写的 NodeSqliteSaver，而非官方基于原生模块
 * better-sqlite3 的 SqliteSaver——后者在 Electron 里要 electron-rebuild 匹配
 * ABI，每次升级 Electron 都要重来且较新版本直接编译失败。内置 SQLite 零原生
 * 编译、跟随运行时升级永不失配（见 design.md D4）。
 *
 * 会话历史（thread_id → 完整消息）由它落到本地磁盘，跨进程/重启保留。
 * `buildGraph({ checkpointer })` 一行不用改。
 */
import { NodeSqliteSaver } from "./node-sqlite-saver.js";

/** 用给定的 SQLite 文件路径创建一个持久 checkpointer。 */
export function createSqliteCheckpointer(dbPath: string): NodeSqliteSaver {
  return NodeSqliteSaver.fromConnString(dbPath);
}
