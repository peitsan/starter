/**
 * DB 连接管理：单例 open / close / migrate
 *
 * MVP：不带迁移（schema_version=1）；后续加表结构变更时按 schema_meta.version 走 PRAGMA user_version。
 */

import BetterSqlite3 from 'better-sqlite3';
import { applySchema } from './schema.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DB = BetterSqlite3.Database;

export interface OpenOptions {
  /** 文件路径或 ':memory:' */
  path: string;
  /** 是否只读；只读不开 WAL */
  readonly?: boolean;
}

/** 打开 db，应用 schema，返回实例 */
export function openDb(opts: OpenOptions): DB {
  if (opts.path !== ':memory:') {
    mkdirSync(dirname(opts.path), { recursive: true });
  }
  const db = new BetterSqlite3(opts.path, {
    readonly: opts.readonly ?? false,
    fileMustExist: false,
  });
  if (!opts.readonly) {
    applySchema(db);
  }
  return db;
}

/** 关闭 db（捕获错误向上抛） */
export function closeDb(db: DB): void {
  try {
    db.close();
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error(String(e), { cause: e });
  }
}
