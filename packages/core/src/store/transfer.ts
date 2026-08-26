/**
 * 配置导入/导出（F9 / RFC-001 §4.9）
 *
 * 导出格式（v1）：
 * ```json
 * {
 *   "schema_version": "v1",
 *   "exported_at": 1787000000000,
 *   "items": [{ "fingerprint": "...", "enabled": true, "delay_ms": 0, "priority": 1 }],
 *   "dependencies": [{ "item_id": "fp_a", "depends_on": "fp_b" }],
 *   "config": { "concurrent_max": "4", "io_busy_threshold_pct": "80", ... }
 * }
 * ```
 *
 * 导入 mode：
 *   - merge   : 按 fingerprint upsert；文件里没出现的项不动
 *   - replace : 清空 startup_item/dependency/config 后全量导入（危险，需 yes）
 *   - append  : 只插入文件里当前不存在的项，不覆盖已有
 *
 * 导入前调用方应自动备份 db（RFC §4.9）。
 */

import type { DB } from './db.js';

export const TRANSFER_VERSION = 'v1' as const;

export interface ExportItem {
  fingerprint: string;
  enabled: boolean;
  delay_ms: number;
  priority: number;
}
export interface ExportDependency {
  item_id: string;
  depends_on: string;
}
export interface ConfigSnapshot {
  [k: string]: string;
}
export interface ExportPayload {
  schema_version: string;
  exported_at: number;
  items: ExportItem[];
  dependencies: ExportDependency[];
  config: ConfigSnapshot;
}

export type ImportMode = 'merge' | 'replace' | 'append';

export interface ImportReport {
  ok: boolean;
  mode: ImportMode;
  items_inserted: number;
  items_updated: number;
  dependencies_added: number;
  dependencies_removed: number;
  config_updated: number;
  reason?: string;
}

function parsePayload(raw: string): ExportPayload {
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    throw new Error('invalid JSON');
  }
  if (!p || typeof p !== 'object') throw new Error('payload must be an object');
  const o = p as ExportPayload;
  if (o.schema_version !== TRANSFER_VERSION) {
    throw new Error(
      `unsupported schema_version: ${String(o.schema_version)} (expect ${TRANSFER_VERSION})`,
    );
  }
  if (!Array.isArray(o.items)) throw new Error('payload.items must be an array');
  if (!Array.isArray(o.dependencies)) throw new Error('payload.dependencies must be an array');
  if (!o.config || typeof o.config !== 'object') o.config = {};
  return o;
}

export function exportSnapshot(db: DB): ExportPayload {
  const items = (
    db
      .prepare('SELECT id, enabled, delay_ms, priority FROM startup_item ORDER BY id')
      .all() as Array<{ id: string; enabled: number; delay_ms: number; priority: number }>
  ).map((r) => ({
    fingerprint: r.id,
    enabled: r.enabled === 1,
    delay_ms: r.delay_ms,
    priority: r.priority,
  }));
  const dependencies = db
    .prepare('SELECT item_id, depends_on FROM startup_dependency ORDER BY item_id, depends_on')
    .all() as Array<{ item_id: string; depends_on: string }>;
  const configRows = db.prepare('SELECT key, value FROM app_config').all() as Array<{
    key: string;
    value: string;
  }>;
  const config: ConfigSnapshot = {};
  for (const r of configRows) config[r.key] = r.value;
  return { schema_version: TRANSFER_VERSION, exported_at: Date.now(), items, dependencies, config };
}

export function importSnapshot(db: DB, raw: string, mode: ImportMode): ImportReport {
  const p = parsePayload(raw);
  const report: ImportReport = {
    ok: true,
    mode,
    items_inserted: 0,
    items_updated: 0,
    dependencies_added: 0,
    dependencies_removed: 0,
    config_updated: 0,
  };
  const tx = db.transaction(() => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM startup_dependency').run();
      db.prepare('DELETE FROM startup_item').run();
      db.prepare('DELETE FROM app_config').run();
    }

    const sel = db.prepare('SELECT id FROM startup_item WHERE id = ?');
    const upsert = db.prepare(`
      INSERT INTO startup_item (id, name, command, source, source_path, enabled, delay_ms, priority, risk, vendor, updated_at)
      VALUES (@id, @name, @command, @source, @source_path, @enabled, @delay_ms, @priority, @risk, @vendor, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        delay_ms = excluded.delay_ms,
        priority = excluded.priority,
        updated_at = excluded.updated_at
    `);
    const now = Date.now();
    for (const it of p.items) {
      if (!it || typeof it.fingerprint !== 'string' || !it.fingerprint) continue;
      const exists = sel.get(it.fingerprint) !== undefined;
      if (mode === 'append' && exists) continue; // append 不覆盖已有
      upsert.run({
        id: it.fingerprint,
        name: it.fingerprint,
        command: '',
        source: 'Import',
        source_path: 'import',
        enabled: it.enabled ? 1 : 0,
        delay_ms: Number(it.delay_ms) || 0,
        priority: typeof it.priority === 'number' && Number.isFinite(it.priority) ? it.priority : 2,
        risk: 'normal',
        vendor: null,
        updated_at: now,
      });
      if (exists && mode !== 'append') report.items_updated++;
      else report.items_inserted++;
    }

    if (mode !== 'append') {
      db.prepare('DELETE FROM startup_dependency').run();
      report.dependencies_removed = 0;
    }
    const addDep = db.prepare(
      'INSERT OR IGNORE INTO startup_dependency (item_id, depends_on) VALUES (?, ?)',
    );
    for (const d of p.dependencies) {
      if (!d || typeof d.item_id !== 'string' || typeof d.depends_on !== 'string') continue;
      const r = addDep.run(d.item_id, d.depends_on);
      if (r.changes > 0) report.dependencies_added++;
    }

    for (const [k, v] of Object.entries(p.config)) {
      if (typeof k !== 'string' || typeof v !== 'string') continue;
      const prev = db.prepare('SELECT value FROM app_config WHERE key = ?').get(k) as
        { value: string } | undefined;
      if (prev?.value === v) continue;
      db.prepare(
        `INSERT INTO app_config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run(k, v);
      report.config_updated++;
    }
  });
  tx();
  return report;
}
