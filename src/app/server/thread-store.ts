/**
 * 线程目录：createEmbedServer 需要注入的 ThreadSaver（get/set/delete/search）。
 *
 * embed server 自身按 thread 管理"内容"（经注入的 checkpointer 落盘），但"目录"
 * ——列出全部线程、标题等元数据——由这里承担（对应 session-management 的会话目录、
 * 以及 concurrent-sessions 的多会话列举）。用运行时内置 node:sqlite 落盘，跨重启保留。
 *
 * 取代学习期的 SessionStore：接口对齐 ThreadSaver，元数据以 JSON 整体存储
 * （标题等由上层写入 metadata.title）。
 */
import { DatabaseSync } from "node:sqlite";
import type { ThreadSaver } from "@langchain/langgraph-api/experimental/embed";

interface Row {
  thread_id: string;
  metadata: string;
  created_at: number;
  updated_at: number;
}

/** 用给定 SQLite 文件创建一个落盘的 ThreadSaver。 */
export function createThreadSaver(dbPath: string): ThreadSaver & { close(): void } {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      thread_id  TEXT PRIMARY KEY,
      metadata   TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const toThread = (r: Row) => ({
    thread_id: r.thread_id,
    metadata: JSON.parse(r.metadata) as Record<string, unknown>,
  });

  return {
    get: async (id) => {
      const row = db
        .prepare("SELECT * FROM threads WHERE thread_id = ?")
        .get(id) as unknown as Row | undefined;
      return (row ? toThread(row) : undefined) as never;
    },

    set: async (id, { kind, metadata }) => {
      const now = Date.now();
      const existing = db
        .prepare("SELECT * FROM threads WHERE thread_id = ?")
        .get(id) as unknown as Row | undefined;

      // put 覆盖元数据；patch 合并到已有元数据之上
      const base = existing ? (JSON.parse(existing.metadata) as Record<string, unknown>) : {};
      const nextMeta = kind === "patch" ? { ...base, ...(metadata ?? {}) } : { ...(metadata ?? {}) };
      const json = JSON.stringify(nextMeta);

      if (existing) {
        db.prepare("UPDATE threads SET metadata = ?, updated_at = ? WHERE thread_id = ?").run(json, now, id);
        return { thread_id: id, metadata: nextMeta };
      }
      db.prepare(
        "INSERT INTO threads (thread_id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?)",
      ).run(id, json, now, now);
      return { thread_id: id, metadata: nextMeta };
    },

    delete: async (id) => {
      db.prepare("DELETE FROM threads WHERE thread_id = ?").run(id);
    },

    search: async function* ({ limit, offset, sortBy, sortOrder }) {
      const col = sortBy === "created_at" ? "created_at" : "updated_at";
      const dir = sortOrder === "asc" ? "ASC" : "DESC";
      const total = (
        db.prepare("SELECT COUNT(*) AS n FROM threads").get() as unknown as { n: number }
      ).n;
      const rows = db
        .prepare(`SELECT * FROM threads ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`)
        .all(limit, offset) as unknown as Row[];
      for (const r of rows) yield { thread: toThread(r), total };
    },

    close: () => db.close(),
  };
}
