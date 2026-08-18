/**
 * NodeSqliteSaver —— 用 Node 内置的 `node:sqlite` 手写的持久 checkpointer。
 *
 * 为什么不用官方 `@langchain/langgraph-checkpoint-sqlite`：它底层是原生模块
 * better-sqlite3，在 Electron 里必须用 electron-rebuild 把二进制重编到 Electron
 * 的 Node ABI，每次升级 Electron 都要重来一遍——这是长期的雷（较新的 Electron
 * V8 头文件甚至直接编译失败）。
 *
 * `node:sqlite` 是运行时内置的 SQLite（Node 22.5+ / Electron 内置 Node 均带），
 * 零原生编译、零 ABI 匹配、跟随运行时升级永不失配。这段实现忠实照搬官方
 * SqliteSaver 的表结构（checkpoints / writes）、序列化（复用 BaseCheckpointSaver
 * 的 serde）与查询逻辑，只把 better-sqlite3 的 API 换成 node:sqlite：
 *   - new Database(path)      → new DatabaseSync(path)
 *   - db.pragma(...)          → db.exec("PRAGMA ...")
 *   - db.transaction(fn)      → 手动 BEGIN / COMMIT / ROLLBACK
 *   - 绑定参数不接受 undefined → 统一强转为 null
 *
 * 手写 checkpointer 也正合这个仓库"拆开原语来理解 LangGraph"的初衷。
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
  BaseCheckpointSaver,
  TASKS,
  copyCheckpoint,
  maxChannelVersion,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type CheckpointListOptions,
  type PendingWrite,
  type SerializerProtocol,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

const checkpointMetadataKeys = ["source", "step", "parents"] as const;

/** node:sqlite 的绑定不接受 undefined，统一转成 null。 */
type Bindable = string | number | bigint | Uint8Array | null;
const nn = (v: unknown): Bindable => (v === undefined ? null : (v as Bindable));

interface CheckpointRow {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string | null;
  checkpoint: Uint8Array;
  metadata: Uint8Array;
  pending_writes: string;
  pending_sends: string;
}

function selectSql(withCheckpointId: boolean): string {
  return `
  SELECT
    thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata,
    (
      SELECT json_group_array(json_object(
        'task_id', pw.task_id, 'channel', pw.channel, 'type', pw.type, 'value', CAST(pw.value AS TEXT)))
      FROM writes as pw
      WHERE pw.thread_id = checkpoints.thread_id
        AND pw.checkpoint_ns = checkpoints.checkpoint_ns
        AND pw.checkpoint_id = checkpoints.checkpoint_id
    ) as pending_writes,
    (
      SELECT json_group_array(json_object('type', ps.type, 'value', CAST(ps.value AS TEXT)))
      FROM writes as ps
      WHERE ps.thread_id = checkpoints.thread_id
        AND ps.checkpoint_ns = checkpoints.checkpoint_ns
        AND ps.checkpoint_id = checkpoints.parent_checkpoint_id
        AND ps.channel = '${TASKS}'
      ORDER BY ps.idx
    ) as pending_sends
  FROM checkpoints
  WHERE thread_id = ? AND checkpoint_ns = ? ${
    withCheckpointId
      ? "AND checkpoint_id = ?"
      : "ORDER BY checkpoint_id DESC LIMIT 1"
  }`;
}

export class NodeSqliteSaver extends BaseCheckpointSaver {
  private db: DatabaseSync;
  private isSetup = false;
  private withCheckpoint!: StatementSync;
  private withoutCheckpoint!: StatementSync;

  constructor(db: DatabaseSync, serde?: SerializerProtocol) {
    super(serde);
    this.db = db;
  }

  static fromConnString(path: string): NodeSqliteSaver {
    return new NodeSqliteSaver(new DatabaseSync(path));
  }

  private setup(): void {
    if (this.isSetup) return;
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);`);
    this.db.exec(`
CREATE TABLE IF NOT EXISTS writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);`);
    this.withCheckpoint = this.db.prepare(selectSql(true));
    this.withoutCheckpoint = this.db.prepare(selectSql(false));
    this.isSetup = true;
  }

  private async rowToTuple(
    row: CheckpointRow,
    config: RunnableConfig,
    checkpoint_ns: string,
  ): Promise<CheckpointTuple> {
    const pendingWrites = await Promise.all(
      (JSON.parse(row.pending_writes) as {
        task_id: string;
        channel: string;
        type: string | null;
        value: string | null;
      }[]).map(
        async (w) =>
          [
            w.task_id,
            w.channel,
            await this.serde.loadsTyped(w.type ?? "json", w.value ?? ""),
          ] as [string, string, unknown],
      ),
    );
    const checkpoint = (await this.serde.loadsTyped(
      row.type ?? "json",
      row.checkpoint,
    )) as Checkpoint;
    if (checkpoint.v < 4 && row.parent_checkpoint_id != null) {
      await this.migratePendingSends(
        checkpoint,
        row.thread_id,
        row.parent_checkpoint_id,
      );
    }
    return {
      config,
      checkpoint,
      metadata: (await this.serde.loadsTyped(
        row.type ?? "json",
        row.metadata,
      )) as CheckpointMetadata,
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: row.thread_id,
              checkpoint_ns,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    this.setup();
    const {
      thread_id,
      checkpoint_ns = "",
      checkpoint_id,
    } = config.configurable ?? {};
    const stmt = checkpoint_id ? this.withCheckpoint : this.withoutCheckpoint;
    const args: Bindable[] = [nn(thread_id), nn(checkpoint_ns)];
    if (checkpoint_id) args.push(nn(checkpoint_id));
    const row = stmt.get(...args) as CheckpointRow | undefined;
    if (row === undefined) return undefined;

    const finalConfig: RunnableConfig = checkpoint_id
      ? config
      : {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        };
    return this.rowToTuple(row, finalConfig, checkpoint_ns);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    this.setup();
    const { limit, before, filter } = options ?? {};
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns;

    const whereClause: string[] = [];
    if (thread_id) whereClause.push("thread_id = ?");
    if (checkpoint_ns !== undefined && checkpoint_ns !== null)
      whereClause.push("checkpoint_ns = ?");
    if (before?.configurable?.checkpoint_id !== undefined)
      whereClause.push("checkpoint_id < ?");

    const sanitizedFilter = Object.fromEntries(
      Object.entries(filter ?? {}).filter(
        ([key, value]) =>
          value !== undefined &&
          (checkpointMetadataKeys as readonly string[]).includes(key),
      ),
    );
    whereClause.push(
      ...Object.keys(sanitizedFilter).map(
        (key) => `jsonb(CAST(metadata AS TEXT))->'$.${key}' = ?`,
      ),
    );

    let sql = `${selectSql(false).split("FROM checkpoints")[0]}FROM checkpoints\n`;
    // 复用 select 列，但 list 用自定义 WHERE + ORDER，去掉单行 LIMIT 子句
    sql = sql.replace(/WHERE thread_id = \? AND checkpoint_ns = \?[\s\S]*$/, "");
    if (whereClause.length > 0) sql += `WHERE\n  ${whereClause.join(" AND\n  ")}\n`;
    sql += "\nORDER BY checkpoint_id DESC";
    if (limit) sql += ` LIMIT ${parseInt(String(limit), 10)}`;

    const args: Bindable[] = [
      nn(thread_id),
      nn(checkpoint_ns),
      nn(before?.configurable?.checkpoint_id),
      ...Object.values(sanitizedFilter).map((v) => JSON.stringify(v) as Bindable),
    ].filter((v) => v !== null && v !== undefined);

    const rows = this.db.prepare(sql).all(...args) as unknown as CheckpointRow[];
    for (const row of rows) {
      yield this.rowToTuple(
        row,
        {
          configurable: {
            thread_id: row.thread_id,
            checkpoint_ns: row.checkpoint_ns,
            checkpoint_id: row.checkpoint_id,
          },
        },
        row.checkpoint_ns,
      );
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    this.setup();
    if (!config.configurable) throw new Error("Empty configuration supplied.");
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? "";
    const parent_checkpoint_id = config.configurable?.checkpoint_id;
    if (!thread_id) {
      throw new Error(`Missing "thread_id" field in passed "config.configurable".`);
    }
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const [[type1, serializedCheckpoint], [type2, serializedMetadata]] =
      await Promise.all([
        this.serde.dumpsTyped(preparedCheckpoint),
        this.serde.dumpsTyped(metadata),
      ]);
    if (type1 !== type2) {
      throw new Error("Failed to serialized checkpoint and metadata to the same type.");
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        nn(thread_id),
        nn(checkpoint_ns),
        nn(checkpoint.id),
        nn(parent_checkpoint_id),
        nn(type1),
        serializedCheckpoint,
        serializedMetadata,
      );
    return {
      configurable: { thread_id, checkpoint_ns, checkpoint_id: checkpoint.id },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    this.setup();
    if (!config.configurable) throw new Error("Empty configuration supplied.");
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns;
    const checkpoint_id = config.configurable?.checkpoint_id;
    if (!thread_id) throw new Error("Missing thread_id field in config.configurable.");
    if (!checkpoint_id)
      throw new Error("Missing checkpoint_id field in config.configurable.");

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO writes
      (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    const rows = await Promise.all(
      writes.map(async (write, idx) => {
        const [type, serializedWrite] = await this.serde.dumpsTyped(write[1]);
        return [
          nn(thread_id),
          nn(checkpoint_ns),
          nn(checkpoint_id),
          nn(taskId),
          idx,
          nn(write[0]),
          nn(type),
          serializedWrite,
        ] as Bindable[];
      }),
    );

    // node:sqlite 无 db.transaction() 帮手，手动事务
    this.db.exec("BEGIN");
    try {
      for (const row of rows) stmt.run(...row);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.setup();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(threadId);
      this.db.prepare("DELETE FROM writes WHERE thread_id = ?").run(threadId);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  private async migratePendingSends(
    checkpoint: Checkpoint,
    threadId: string,
    parentCheckpointId: string,
  ): Promise<void> {
    const row = this.db
      .prepare(
        `SELECT json_group_array(json_object('type', ps.type, 'value', CAST(ps.value AS TEXT))) as pending_sends
         FROM writes as ps
         WHERE ps.thread_id = ? AND ps.checkpoint_id = ? AND ps.channel = '${TASKS}'
         ORDER BY ps.idx`,
      )
      .get(threadId, parentCheckpointId) as { pending_sends: string } | undefined;
    const mutable = checkpoint;
    mutable.channel_values ??= {};
    mutable.channel_values[TASKS] = await Promise.all(
      (JSON.parse(row?.pending_sends ?? "[]") as { type: string; value: string }[]).map(
        ({ type, value }) => this.serde.loadsTyped(type, value),
      ),
    );
    mutable.channel_versions[TASKS] =
      Object.keys(checkpoint.channel_versions).length > 0
        ? maxChannelVersion(...Object.values(checkpoint.channel_versions))
        : this.getNextVersion(undefined);
  }

  close(): void {
    this.db.close();
  }
}
