/**
 * OpLogRepository — op_log 表
 *
 * 写操作审计 + undo support
 * 列：id, at, actor, action, target, args_json, result, message
 *
 * action 约定：
 *   - enable / disable              → target=itemId, args_json={prev:0|1}
 *   - set_delay / set_priority      → target=itemId, args_json={prev:number}
 *   - add_dep / remove_dep          → target=itemId, args_json={with:string}
 *   - apply_preset                  → target=null,    args_json={items:[{id, action, prev}]}
 */

import type { Database } from 'better-sqlite3';
import type { Actor } from '../controller.js';

export interface OpLogRow {
  id: number;
  at: number;
  actor: Actor | string;
  action: string;
  target: string | null;
  args_json: string | null;
  result: string;
  message: string | null;
}

export interface UndoableChange {
  id: number;
  at: number;
  action: string;
  target: string | null;
  args: Record<string, unknown> | null;
}

export class OpLogRepository {
  constructor(private readonly db: Database) {}

  write(entry: {
    actor: Actor | string;
    action: string;
    target?: string | null;
    args?: Record<string, unknown> | null;
    result: 'ok' | 'forbidden' | 'error';
    message?: string | null;
  }): number {
    const at = Date.now();
    const r = this.db
      .prepare(
        `INSERT INTO op_log (at, actor, action, target, args_json, result, message)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        at,
        entry.actor,
        entry.action,
        entry.target ?? null,
        entry.args ? JSON.stringify(entry.args) : null,
        entry.result,
        entry.message ?? null,
      );
    return Number(r.lastInsertRowid);
  }

  list(limit = 50): OpLogRow[] {
    return this.db
      .prepare('SELECT * FROM op_log ORDER BY id DESC LIMIT ?')
      .all(limit) as OpLogRow[];
  }

  /** 取最近 N 条成功的、可 undo 的变更。 */
  listUndoable(limit = 10): UndoableChange[] {
    const rows = this.list(limit);
    const out: UndoableChange[] = [];
    for (const r of rows.reverse()) {
      // ignore: not ok / non-undoable actions
      if (r.result !== 'ok') continue;
      if (!UNDOABLE_ACTIONS.has(r.action)) continue;
      if (!r.target) continue;
      out.push({
        id: r.id,
        at: r.at,
        action: r.action,
        target: r.target,
        args: r.args_json ? (JSON.parse(r.args_json) as Record<string, unknown>) : null,
      });
    }
    return out.reverse();
  }
}

const UNDOABLE_ACTIONS = new Set([
  'disable',
  'enable',
  'set_delay',
  'set_priority',
  'add_dep',
  'rm_dep',
]);
