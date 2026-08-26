/**
 * app_config KV 仓储（concurrent_max / io_busy_threshold_pct 等）
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

export class ConfigRepository {
  constructor(private db: DB) {}

  get(key: ConfigKey): string {
    const r = this.db
      .prepare<[ConfigKey], { value: string }>('SELECT value FROM app_config WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return r?.value ?? DEFAULTS[key];
  }

  set(key: ConfigKey, value: string, actor: string): void {
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

  asNumber(key: ConfigKey): number {
    const v = Number(this.get(key));
    if (!Number.isFinite(v)) return Number(DEFAULTS[key]);
    return v;
  }

  asBool(key: ConfigKey): boolean {
    return this.get(key) === 'true';
  }
}
