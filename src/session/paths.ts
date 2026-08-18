/**
 * 数据文件路径。
 *
 * checkpointer 表与 sessions 目录表共用同一个 SQLite 文件（见 design.md D4）。
 * 默认落在项目根的 data/ 下；桌面端主进程会传入 Electron 的 userData 路径。
 */
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

/** 返回 SQLite 文件的绝对路径，并确保其所在目录存在。 */
export function resolveDbPath(baseDir?: string): string {
  const dir = baseDir ?? resolve(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  return resolve(dir, "sessions.db");
}
