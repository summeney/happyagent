/**
 * 会话目录表。
 *
 * LangGraph 的嵌入式 checkpointer 只能"给定 thread_id 取内容"，没有
 * "列出全部会话"的能力（那是 Platform 层才有的）。这张自建的 sessions 表
 * 补上这个缺口，并顺带存人类可读的标题与时间（见 design.md D4/D5）。
 *
 * 与 checkpointer 共用同一个 .db 文件，但各管各的表：checkpointer 管
 * 会话"内容"，这张表管会话"目录 + 门牌"。sessions 表是会话存在性的唯一真源，
 * 允许"新建了却从未发消息"的空会话存在（此时 checkpointer 里没有记录）。
 */
import { DatabaseSync } from "node:sqlite";

/** 一条会话目录项。 */
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface Row {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

const toMeta = (r: Row): SessionMeta => ({
  id: r.id,
  title: r.title,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

export class SessionStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /** 列出全部会话，按最近更新时间倒序。 */
  list(): SessionMeta[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
      .all() as unknown as Row[];
    return rows.map(toMeta);
  }

  /** 读取单条会话；不存在返回 undefined。 */
  get(id: string): SessionMeta | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as unknown as Row | undefined;
    return row ? toMeta(row) : undefined;
  }

  /** 新建一条会话（空标题、历史为空），返回其元数据。 */
  create(id: string): SessionMeta {
    const now = Date.now();
    this.db
      .prepare(
        "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, '', ?, ?)",
      )
      .run(id, now, now);
    return { id, title: "", createdAt: now, updatedAt: now };
  }

  /** 仅在标题为空时写入标题（首条用户消息触发）。 */
  setTitleIfEmpty(id: string, title: string): void {
    this.db
      .prepare("UPDATE sessions SET title = ? WHERE id = ? AND title = ''")
      .run(title, id);
  }

  /** 刷新最近更新时间（每轮交互结束调用），使其在列表中上移。 */
  touch(id: string): void {
    this.db
      .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run(Date.now(), id);
  }

  close(): void {
    this.db.close();
  }
}
