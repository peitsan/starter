/**
 * SQLite 仓储 schema
 *
 * 表格与 docs/PRD.md §4 一一对应：
 *   - startup_item       启动项（包含延迟/优先级/启用态）
 *   - startup_dependency 启动顺序 DAG
 *   - startup_run        一次开机 / 一次手动 run
 *   - startup_run_event  每条 run 里每个 item 的状态
 *   - op_log             CLI / MCP 写操作审计
 *   - app_config         KV 配置
 */

import type { Database } from 'better-sqlite3';

export const DB_SCHEMA_VERSION = 1;

/** 在一个新打开的 db 上跑 schema（幂等）。 */
export function applySchema(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS startup_item (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      command       TEXT NOT NULL,
      source        TEXT NOT NULL,
      source_path   TEXT NOT NULL,
      enabled       INTEGER NOT NULL DEFAULT 1,
      delay_ms      INTEGER NOT NULL DEFAULT 0,
      priority      INTEGER NOT NULL DEFAULT 2,  -- 0=Idle 1=BelowNormal 2=Normal 3=AboveNormal 4=High 5=Realtime (RFC-001 §4.5)
      risk          TEXT NOT NULL,
      vendor        TEXT,
      updated_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_startup_item_source ON startup_item(source);
    CREATE INDEX IF NOT EXISTS idx_startup_item_enabled ON startup_item(enabled);

    CREATE TABLE IF NOT EXISTS startup_dependency (
      item_id     TEXT NOT NULL,
      depends_on  TEXT NOT NULL,
      PRIMARY KEY (item_id, depends_on),
      FOREIGN KEY (item_id)    REFERENCES startup_item(id) ON DELETE CASCADE,
      FOREIGN KEY (depends_on) REFERENCES startup_item(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_dep_depends ON startup_dependency(depends_on);

    CREATE TABLE IF NOT EXISTS startup_run (
      id          TEXT PRIMARY KEY,
      started_at  INTEGER NOT NULL,
      finished_at INTEGER,
      kind        TEXT NOT NULL DEFAULT 'boot'   -- 'boot' | 'manual' | 'simulate'
    );

    CREATE TABLE IF NOT EXISTS startup_run_event (
      run_id        TEXT NOT NULL,
      item_id       TEXT NOT NULL,
      scheduled_at  INTEGER,
      started_at    INTEGER,
      ready_at      INTEGER,
      ended_at      INTEGER,
      status        TEXT NOT NULL,
      PRIMARY KEY (run_id, item_id),
      FOREIGN KEY (run_id)  REFERENCES startup_run(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES startup_item(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS op_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      at          INTEGER NOT NULL,
      actor       TEXT NOT NULL,         -- 'cli' | 'mcp' | 'daemon' | 'doctor'
      action      TEXT NOT NULL,         -- e.g. 'disable' / 'set_delay' / 'add_dep'
      target      TEXT,                  -- item id or 'config:concurrent_max'
      args_json   TEXT,                  -- JSON-stringified args
      result      TEXT NOT NULL,         -- 'ok' | 'forbidden' | 'error'
      message     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_op_log_at ON op_log(at);

    CREATE TABLE IF NOT EXISTS app_config (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    INSERT OR IGNORE INTO schema_meta (k, v) VALUES ('version', '${DB_SCHEMA_VERSION}');
  `);
}
