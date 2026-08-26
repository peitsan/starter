/**
 * 控制器层 — 把 scanner / store / winreg 串起来
 */

import type { ScannedItem, Scanner } from './scanner/index.js';
import type { StartupItemRow, StartupItemFilter } from './store/index.js';
import { ItemRepository, ConfigRepository } from './store/index.js';
import { openDb, closeDb, type DB } from './store/db.js';
import { defaultDbPath } from './store/items.js';
import { ElevationRequiredError, regAdd, regDelete, parseSource } from './winreg.js';

export type Actor = 'cli' | 'mcp' | 'daemon' | 'doctor';

export interface ControllerOptions {
  dbPath?: string;
  scanner?: Scanner | null;
  actor?: Actor;
}

export class Controller {
  private db: DB;
  public readonly items: ItemRepository;
  public readonly config: ConfigRepository;
  public readonly actor: Actor;
  public readonly scanner: Scanner | null;

  constructor(opts: ControllerOptions = {}) {
    this.db = openDb({ path: opts.dbPath ?? defaultDbPath() });
    this.items = new ItemRepository(this.db);
    this.config = new ConfigRepository(this.db);
    this.actor = opts.actor ?? 'cli';
    this.scanner = opts.scanner ?? null;
  }

  close(): void {
    closeDb(this.db);
  }

  async scan(): Promise<{
    inserted: number;
    updated: number;
    items: StartupItemRow[];
    total: number;
  }> {
    if (!this.scanner) throw new Error('no scanner configured (pass scanner in ControllerOptions)');
    const scanned: ScannedItem[] = await this.scanner.scan();
    const stats = this.items.upsertFromScan(scanned);
    const items = this.items.list();
    return { ...stats, items, total: items.length };
  }

  async enable(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const row = this.items.get(id);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.risk === 'critical') return { ok: false, reason: 'protected' };
    const parsed = parseSource(row.source, row.source_path);
    if (!parsed) return { ok: false, reason: 'unsupported_source' };
    try {
      await regAdd(parsed.hive, parsed.key, row.name, row.command);
    } catch (e) {
      if (e instanceof ElevationRequiredError) return { ok: false, reason: 'elevation_required' };
      throw e;
    }
    this.items.setEnabled(id, true, this.actor);
    return { ok: true };
  }

  async disable(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const row = this.items.get(id);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.risk === 'critical') return { ok: false, reason: 'protected' };
    const parsed = parseSource(row.source, row.source_path);
    if (!parsed) return { ok: false, reason: 'unsupported_source' };
    try {
      await regDelete(parsed.hive, parsed.key, row.name);
    } catch (e) {
      if (e instanceof ElevationRequiredError) return { ok: false, reason: 'elevation_required' };
      // reg.exe delete 找不到时仍可能成功（幂等）
    }
    this.items.setEnabled(id, false, this.actor);
    return { ok: true };
  }

  setDelay(id: string, delayMs: number): boolean {
    return this.items.setDelay(id, delayMs, this.actor);
  }

  setPriority(id: string, priority: number): boolean {
    return this.items.setPriority(id, priority, this.actor);
  }

  list(filter?: StartupItemFilter): StartupItemRow[] {
    return this.items.list(filter);
  }

  show(id: string): StartupItemRow | null {
    return this.items.get(id);
  }

  doctor(): DoctorReport {
    const total = this.items.list().length;
    const enabled = this.items.list({ enabled: true }).length;
    return {
      ok: true,
      platform: process.platform,
      dbPath: this.dbPath(),
      itemCount: total,
      enabledCount: enabled,
      config: {
        concurrent_max: this.config.asNumber('concurrent_max'),
        io_busy_threshold_pct: this.config.asNumber('io_busy_threshold_pct'),
        io_queue_threshold: this.config.asNumber('io_queue_threshold'),
        io_idle_confirm_ms: this.config.asNumber('io_idle_confirm_ms'),
        auto_start: this.config.asBool('auto_start'),
      },
    };
  }

  dbPath(): string {
    return (this.db as unknown as { name?: string }).name ?? '(unknown)';
  }
}

export interface DoctorReport {
  ok: boolean;
  platform: string;
  dbPath: string;
  itemCount: number;
  enabledCount: number;
  config: {
    concurrent_max: number;
    io_busy_threshold_pct: number;
    io_queue_threshold: number;
    io_idle_confirm_ms: number;
    auto_start: boolean;
  };
}
