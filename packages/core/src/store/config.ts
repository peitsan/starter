/**
 * app_config KV 仓储（concurrent_max / io_busy_threshold_pct 等）
 *
 * 关于 priority 字段：startup_item.priority 用同一把标尺
 * （0=Idle 1=BelowNormal 2=Normal 3=AboveNormal 4=High 5=Realtime，RFC-001 §4.5）。
 * app_config 不存 priority 默认值——priority 走 schema DEFAULT 2。
 */
import type { DB } from './db.js';

export type ConfigKey =
  | 'concurrent_max'
  | 'io_queue_threshold'
  | 'io_busy_threshold_pct'
  | 'io_idle_confirm_ms'
  | 'auto_start';

const DEFAULTS: Record<ConfigKey, string> = {
  concurrent_max: '4',
  io_queue_threshold: '2',
  io_busy_threshold_pct: '80',
  io_idle_confirm_ms: '3000',
  auto_start: 'false',
};

/** set 时的范围校验（仅 io_* / concurrent_max），auto_start 不限 */
export function validateConfigValue(key: ConfigKey, value: string): void {
  switch (key) {
    case 'concurrent_max': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 16) {
        throw new Error(`concurrent_max out of range [1,16]: ${value}`);
      }
      return;
    }
    case 'io_queue_threshold': {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`io_queue_threshold must be a non-negative number: ${value}`);
      }
      return;
    }
    case 'io_busy_threshold_pct': {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new Error(`io_busy_threshold_pct out of range [0,100]: ${value}`);
      }
      return;
    }
    case 'io_idle_confirm_ms': {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`io_idle_confirm_ms must be a non-negative integer: ${value}`);
      }
      return;
    }
    case 'auto_start':
      if (value !== 'true' && value !== 'false') {
        throw new Error(`auto_start must be "true" or "false": ${value}`);
      }
      return;
  }
}

export class ConfigRepository {
  constructor(private db: DB) {}

  get(key: ConfigKey): string {
    const r = this.db
      .prepare<[ConfigKey], { value: string }>('SELECT value FROM app_config WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return r?.value ?? DEFAULTS[key];
  }

  set(key: ConfigKey, value: string, actor: string): void {
    validateConfigValue(key, value); // 统一范围校验（RFC-001 §4.2 的 config_set 也复用此逻辑）
    const prev = this.get(key);
    this.db
      .prepare(
        `INSERT INTO app_config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
    this.db
      .prepare(
        'INSERT INTO op_log (at, actor, action, target, args_json, result) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        Date.now(),
        actor,
        'config_set',
        `config:${key}`,
        JSON.stringify({ prev, next: value }),
        'ok',
      );
  }

  /** 全部 config（实际值 + 默认值来源标注）。供 get_config / starter://config 使用 */
  all(): Record<string, { value: string; source: 'db' | 'default' }> {
    const rows = this.db.prepare('SELECT key, value FROM app_config').all() as Array<{
      key: string;
      value: string;
    }>;
    const dbMap = new Map(rows.map((r) => [r.key, r.value]));
    const out: Record<string, { value: string; source: 'db' | 'default' }> = {};
    for (const k of Object.keys(DEFAULTS) as ConfigKey[]) {
      const v = dbMap.get(k);
      out[k] =
        v === undefined ? { value: DEFAULTS[k], source: 'default' } : { value: v, source: 'db' };
    }
    return out;
  }

  asNumber(key: ConfigKey): number {
    const v = Number(this.get(key));
    if (!Number.isFinite(v)) return Number(DEFAULTS[key]);
    return v;
  }

  asBool(key: ConfigKey): boolean {
    return this.get(key) === 'true';
  }
}
