/**
 * startup_item 仓储
 *
 * 设计：
 *  - id = fingerprint（来自 scanner.fingerprint）保证可复现
 *  - upsert by id（如果源扫到就 refresh，其它字段保留）
 *  - 删/启/停都进 op_log
 */

import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import type { ScannedItem } from '../scanner/index.js';

export interface StartupItemRow {
  id: string;
  name: string;
  command: string;
  source: string;
  source_path: string;
  enabled: 0 | 1;
  delay_ms: number;
  priority: number;
  risk: string;
  vendor: string | null;
  updated_at: number;
}

export interface StartupItemFilter {
  enabled?: boolean;
  source?: string;
  risk?: string;
  search?: string;
}

export class ItemRepository {
  constructor(private db: DB) {}

  /** 扫描结果全量 upsert（保留原有 delay/priority/enabled） */
  upsertFromScan(scanned: ScannedItem[]): { inserted: number; updated: number } {
    const select = this.db.prepare<
      [string],
      { delay_ms: number; priority: number; enabled: 0 | 1 }
    >('SELECT delay_ms, priority, enabled FROM startup_item WHERE id = ?');
    const upsert = this.db.prepare(`
      INSERT INTO startup_item
        (id, name, command, source, source_path, enabled, delay_ms, priority, risk, vendor, updated_at)
      VALUES
        (@id, @name, @command, @source, @source_path, @enabled, @delay_ms, @priority, @risk, @vendor, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        command = excluded.command,
        source = excluded.source,
        source_path = excluded.source_path,
        risk = excluded.risk,
        vendor = excluded.vendor,
        updated_at = excluded.updated_at
    `);
    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    const tx = this.db.transaction((rows: ScannedItem[]) => {
      for (const r of rows) {
        const prev = select.get(r.fingerprint);
        if (prev) {
          upsert.run({
            id: r.fingerprint,
            name: r.name,
            command: r.command,
            source: r.source,
            source_path: r.source_path,
            enabled: prev.enabled,
            delay_ms: prev.delay_ms,
            priority: prev.priority,
            risk: r.risk,
            vendor: r.vendor,
            updated_at: now,
          });
          updated++;
        } else {
          upsert.run({
            id: r.fingerprint,
            name: r.name,
            command: r.command,
            source: r.source,
            source_path: r.source_path,
            enabled: r.enabled ? 1 : 0,
            delay_ms: 0,
            priority: 3,
            risk: r.risk,
            vendor: r.vendor,
            updated_at: now,
          });
          inserted++;
        }
      }
    });
    tx(scanned);
    return { inserted, updated };
  }

  list(filter: StartupItemFilter = {}): StartupItemRow[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.enabled !== undefined) {
      where.push('enabled = @enabled');
      params.enabled = filter.enabled ? 1 : 0;
    }
    if (filter.source) {
      where.push('source = @source');
      params.source = filter.source;
    }
    if (filter.risk) {
      where.push('risk = @risk');
      params.risk = filter.risk;
    }
    if (filter.search) {
      // INSTR 比 LIKE 更可靠；用普通字符串包含（大小写不敏感）
      const needle = filter.search.toLowerCase();
      // 编译期把 needle 拷进闭包，再做 toLowerCase
      const all = this.db
        .prepare<[], StartupItemRow>(
          `SELECT * FROM startup_item ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY source, name`,
        )
        .all() as StartupItemRow[];
      return all.filter(
        (r) => r.name.toLowerCase().includes(needle) || r.command.toLowerCase().includes(needle),
      );
    }
    const sql = `SELECT * FROM startup_item ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY source, name`;
    return this.db.prepare<typeof params, StartupItemRow>(sql).all(params) as StartupItemRow[];
  }

  get(id: string): StartupItemRow | null {
    return (this.db
      .prepare<[string], StartupItemRow>('SELECT * FROM startup_item WHERE id = ?')
      .get(id) ?? null) as StartupItemRow | null;
  }

  setEnabled(id: string, enabled: boolean, actor: string): boolean {
    const exists = this.get(id);
    if (!exists) return false;
    const prev = exists.enabled;
    this.db
      .prepare('UPDATE startup_item SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, Date.now(), id);
    this.db
      .prepare(
        'INSERT INTO op_log (at, actor, action, target, args_json, result) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(Date.now(), actor, enabled ? 'enable' : 'disable', id, JSON.stringify({ prev }), 'ok');
    return prev !== (enabled ? 1 : 0);
  }

  setDelay(id: string, delayMs: number, actor: string): boolean {
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 24 * 3600 * 1000) {
      throw new Error(`delay_ms out of range: ${delayMs}`);
    }
    const exists = this.get(id);
    if (!exists) return false;
    this.db
      .prepare('UPDATE startup_item SET delay_ms = ?, updated_at = ? WHERE id = ?')
      .run(Math.floor(delayMs), Date.now(), id);
    this.db
      .prepare(
        'INSERT INTO op_log (at, actor, action, target, args_json, result) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        Date.now(),
        actor,
        'set_delay',
        id,
        JSON.stringify({ delay_ms: Math.floor(delayMs) }),
        'ok',
      );
    return true;
  }

  setPriority(id: string, priority: number, actor: string): boolean {
    if (!Number.isInteger(priority) || priority < 0 || priority > 5) {
      throw new Error(`priority out of range [0,5]: ${priority}`);
    }
    const exists = this.get(id);
    if (!exists) return false;
    this.db
      .prepare('UPDATE startup_item SET priority = ?, updated_at = ? WHERE id = ?')
      .run(priority, Date.now(), id);
    this.db
      .prepare(
        'INSERT INTO op_log (at, actor, action, target, args_json, result) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(Date.now(), actor, 'set_priority', id, JSON.stringify({ priority }), 'ok');
    return true;
  }

  addDependency(fromId: string, toId: string, actor: string): boolean {
    if (fromId === toId) throw new Error('self dependency');
    // 防环：粗粒度 O(n) DFS；启动项规模 < 200，OK
    if (this.wouldCreateCycle(fromId, toId)) throw new Error('cycle detected');
    try {
      this.db
        .prepare('INSERT INTO startup_dependency (item_id, depends_on) VALUES (?, ?)')
        .run(fromId, toId);
    } catch (e) {
      if (e instanceof Error && e.message.includes('UNIQUE')) return false;
      throw e;
    }
    this.db
      .prepare(
        'INSERT INTO op_log (at, actor, action, target, args_json, result) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(Date.now(), actor, 'add_dep', fromId, JSON.stringify({ depends_on: toId }), 'ok');
    return true;
  }

  removeDependency(fromId: string, toId: string, actor: string): boolean {
    const r = this.db
      .prepare('DELETE FROM startup_dependency WHERE item_id = ? AND depends_on = ?')
      .run(fromId, toId);
    if (r.changes > 0) {
      this.db
        .prepare(
          'INSERT INTO op_log (at, actor, action, target, args_json, result) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(Date.now(), actor, 'rm_dep', fromId, JSON.stringify({ depends_on: toId }), 'ok');
      return true;
    }
    return false;
  }

  listDependencies(id: string): string[] {
    return (
      this.db
        .prepare<[string], { depends_on: string }>(
          'SELECT depends_on FROM startup_dependency WHERE item_id = ?',
        )
        .all(id) as { depends_on: string }[]
    ).map((r) => r.depends_on);
  }

  private wouldCreateCycle(fromId: string, toId: string): boolean {
    // 添加 fromId -> toId 后成环 iff：toId 已经（直接或间接）依赖 fromId
    // 即正向走从 toId 出发，看能否到达 fromId
    const stack = [toId];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === fromId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const next = (
        this.db
          .prepare<[string], { depends_on: string }>(
            'SELECT depends_on FROM startup_dependency WHERE item_id = ?',
          )
          .all(cur) as { depends_on: string }[]
      ).map((r) => r.depends_on);
      stack.push(...next);
    }
    return false;
  }
}

/** 默认 db 路径（用户态） */
export function defaultDbPath(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '.';
  return `${home}/.starter/starter.db`;
}

/** UUID v4 — 不依赖 fingerprint 的临时 id */
export function newId(): string {
  return randomUUID();
}
