/**
 * 控制器层 — 把 scanner / store / winreg / scheduler 串起来
 *
 * 暴露给 CLI / MCP / Daemon / UI 用。
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ScannedItem, Scanner } from './scanner/index.js';
import type { StartupItemRow, StartupItemFilter } from './store/index.js';
import {
  ItemRepository,
  ConfigRepository,
  DependencyRepository,
  OpLogRepository,
  exportSnapshot,
  importSnapshot,
  type ImportMode,
  type ExportPayload,
  type ImportReport,
} from './store/index.js';
import { openDb, closeDb, type DB } from './store/db.js';
import { defaultDbPath } from './store/items.js';
import { ElevationRequiredError, regAdd, regDelete, parseSource } from './winreg.js';
import { Scheduler, type RunResult } from './scheduler/engine.js';
import { WindowsIoSource, FakeIdleIoSource, type IoSource, type IoSample } from './io/monitor.js';

export type Actor = 'cli' | 'mcp' | 'daemon' | 'doctor' | 'ui';

export interface ControllerOptions {
  dbPath?: string;
  scanner?: Scanner | null;
  actor?: Actor;
}

export interface PresetRule {
  /** 匹配 name 的子串（大小写不敏感） */
  match: string;
  delay_ms?: number;
  priority?: number;
  enabled?: boolean;
}

export interface PresetReport {
  matched: number;
  changed: number;
  changes: Array<{
    id: string;
    name: string;
    action: string;
    prev: number | boolean;
    next: number | boolean;
  }>;
}

export interface UndoResult {
  reverted: number;
  failed: number;
  entries: Array<{ id: number; action: string; target: string; ok: boolean; reason?: string }>;
}

export interface ScheduleRunOptions {
  /** true = 真 spawn；false（默认）= 干跑 */
  real?: boolean;
  /** 干跑时每个 item 模拟耗时 */
  simulatedMs?: number;
  /** 并发上限（默认 config） */
  concurrentMax?: number;
  /** IO 队列阈值（默认 config） */
  ioQueueThreshold?: number;
  /** IO busy 阈值（默认 config） */
  ioBusyThresholdPct?: number;
  /** IO idle 确认 ms（默认 config） */
  ioIdleConfirmMs?: number;
  /** 注入的 IO source（用于测试） */
  ioSource?: IoSource;
}

export interface ScheduleRunReport {
  kind: 'manual' | 'simulate';
  run_id: string;
  total: number;
  paused_count: number;
  paused_events: Array<{ reason: string; at: number }>;
  started: string[];
  failed: string[];
  started_at: number;
  finished_at: number;
  dry_run: boolean;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  state: string;
  pid?: number | undefined;
}

export class Controller {
  private db: DB;
  public readonly items: ItemRepository;
  public readonly config: ConfigRepository;
  public readonly deps: DependencyRepository;
  public readonly opLog: OpLogRepository;
  public readonly actor: Actor;
  public readonly scanner: Scanner | null;

  constructor(opts: ControllerOptions = {}) {
    this.db = openDb({ path: opts.dbPath ?? defaultDbPath() });
    this.items = new ItemRepository(this.db);
    this.config = new ConfigRepository(this.db);
    this.deps = new DependencyRepository(this.db);
    this.opLog = new OpLogRepository(this.db);
    this.actor = opts.actor ?? 'cli';
    this.scanner = opts.scanner ?? null;
  }

  close(): void {
    closeDb(this.db);
  }

  // ============ Scan / list / show ============

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

  list(filter?: StartupItemFilter): StartupItemRow[] {
    return this.items.list(filter);
  }

  show(id: string): StartupItemRow | null {
    return this.items.get(id);
  }

  // ============ Toggle / delay / priority ============

  async enable(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const row = this.items.get(id);
    if (!row) {
      this.opLog.write({
        actor: this.actor,
        action: 'enable',
        target: id,
        result: 'error',
        message: 'not_found',
      });
      return { ok: false, reason: 'not_found' };
    }
    if (row.risk === 'critical') {
      this.opLog.write({
        actor: this.actor,
        action: 'enable',
        target: id,
        args: { prev: row.enabled },
        result: 'forbidden',
        message: 'critical',
      });
      return { ok: false, reason: 'protected' };
    }
    const parsed = parseSource(row.source, row.source_path);
    if (!parsed) return { ok: false, reason: 'unsupported_source' };
    try {
      await regAdd(parsed.hive, parsed.key, row.name, row.command);
    } catch (e) {
      if (e instanceof ElevationRequiredError) {
        this.opLog.write({
          actor: this.actor,
          action: 'enable',
          target: id,
          result: 'forbidden',
          message: 'elevation_required',
        });
        return { ok: false, reason: 'elevation_required' };
      }
      throw e;
    }
    this.items.setEnabled(id, true, this.actor); // 内部写 op_log: enable {prev}
    return { ok: true };
  }

  async disable(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const row = this.items.get(id);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.risk === 'critical') {
      this.opLog.write({
        actor: this.actor,
        action: 'disable',
        target: id,
        args: { prev: row.enabled },
        result: 'forbidden',
        message: 'critical',
      });
      return { ok: false, reason: 'protected' };
    }
    const parsed = parseSource(row.source, row.source_path);
    if (!parsed) return { ok: false, reason: 'unsupported_source' };
    try {
      await regDelete(parsed.hive, parsed.key, row.name);
    } catch (e) {
      if (e instanceof ElevationRequiredError) {
        this.opLog.write({
          actor: this.actor,
          action: 'disable',
          target: id,
          result: 'forbidden',
          message: 'elevation_required',
        });
        return { ok: false, reason: 'elevation_required' };
      }
      // reg.exe delete 找不到时仍可能成功（幂等）
    }
    this.items.setEnabled(id, false, this.actor); // 内部写 op_log: disable {prev}
    return { ok: true };
  }

  setDelay(id: string, delayMs: number): boolean {
    return this.items.setDelay(id, delayMs, this.actor); // 内部写 op_log: set_delay {prev,next}
  }

  setPriority(id: string, priority: number): boolean {
    return this.items.setPriority(id, priority, this.actor); // 内部写 op_log: set_priority {prev,next}
  }

  // ============ Dependencies ============

  addDependency(itemId: string, dependsOn: string): { ok: true } | { ok: false; reason: string } {
    if (!this.items.get(itemId) || !this.items.get(dependsOn)) {
      this.opLog.write({
        actor: this.actor,
        action: 'add_dep',
        target: itemId,
        args: { depends_on: dependsOn },
        result: 'error',
        message: 'not_found',
      });
      return { ok: false, reason: 'not_found' };
    }
    try {
      const ok = this.items.addDependency(itemId, dependsOn, this.actor); // 内部写 op_log: add_dep
      if (!ok) return { ok: false, reason: 'duplicate' };
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('cycle')) return { ok: false, reason: 'cycle_detected' };
      if (msg.includes('self')) return { ok: false, reason: 'self_dependency' };
      throw e;
    }
  }

  removeDependency(itemId: string, dependsOn: string): boolean {
    return this.items.removeDependency(itemId, dependsOn, this.actor); // 内部写 op_log: rm_dep
  }

  listDependencies(itemId: string): { outgoing: string[]; incoming: string[] } {
    return this.deps.listFor(itemId);
  }

  // ============ Preset / Undo ============

  applyPreset(rules: PresetRule[]): PresetReport {
    const items = this.items.list();
    const report: PresetReport = { matched: 0, changed: 0, changes: [] };
    for (const it of items) {
      for (const rule of rules) {
        if (!it.name.toLowerCase().includes(rule.match.toLowerCase())) continue;
        report.matched++;
        if (rule.delay_ms !== undefined && it.delay_ms !== rule.delay_ms) {
          const prev = it.delay_ms;
          this.items.setDelay(it.id, rule.delay_ms, this.actor);
          report.changes.push({
            id: it.id,
            name: it.name,
            action: 'set_delay',
            prev,
            next: rule.delay_ms,
          });
          report.changed++;
        }
        if (rule.priority !== undefined && it.priority !== rule.priority) {
          const prev = it.priority;
          this.items.setPriority(it.id, rule.priority, this.actor);
          report.changes.push({
            id: it.id,
            name: it.name,
            action: 'set_priority',
            prev,
            next: rule.priority,
          });
          report.changed++;
        }
        if (rule.enabled !== undefined && !!it.enabled !== rule.enabled) {
          const prev = !!it.enabled;
          this.items.setEnabled(it.id, rule.enabled, this.actor);
          report.changes.push({
            id: it.id,
            name: it.name,
            action: rule.enabled ? 'enable' : 'disable',
            prev,
            next: rule.enabled,
          });
          report.changed++;
        }
        break; // 一个 item 只匹配第一个 rule
      }
    }
    this.opLog.write({
      actor: this.actor,
      action: 'apply_preset',
      target: null,
      args: { rules, matched: report.matched, changed: report.changed },
      result: 'ok',
    });
    return report;
  }

  async undoLast(limit = 5): Promise<UndoResult> {
    const changes = this.opLog.listUndoable(limit);
    const out: UndoResult = { reverted: 0, failed: 0, entries: [] };
    for (const ch of changes.reverse()) {
      const args = ch.args ?? {};
      let ok = false;
      let reason: string | undefined;
      try {
        switch (ch.action) {
          case 'disable':
          case 'enable': {
            const prev = args.prev as number;
            const desired = prev === 1;
            if (desired) ok = (await this.enable(ch.target!)).ok;
            else ok = (await this.disable(ch.target!)).ok;
            if (!ok) reason = 'toggle_failed';
            break;
          }
          case 'set_delay': {
            ok = this.setDelay(ch.target!, args.prev as number);
            if (!ok) reason = 'set_delay_failed';
            break;
          }
          case 'set_priority': {
            ok = this.setPriority(ch.target!, args.prev as number);
            if (!ok) reason = 'set_priority_failed';
            break;
          }
          case 'add_dep': {
            ok = this.removeDependency(ch.target!, (args.depends_on as string) ?? '');
            if (!ok) reason = 'remove_dep_not_found';
            break;
          }
          case 'rm_dep': {
            const r = this.addDependency(ch.target!, (args.depends_on as string) ?? '');
            ok = r.ok;
            if (!r.ok) reason = r.reason;
            break;
          }
          default:
            reason = 'unknown_action';
        }
      } catch (e) {
        reason = e instanceof Error ? e.message : String(e);
      }
      const entry: { id: number; action: string; target: string; ok: boolean; reason?: string } = {
        id: ch.id,
        action: ch.action,
        target: ch.target ?? '',
        ok,
      };
      if (reason !== undefined) entry.reason = reason;
      out.entries.push(entry);
      if (ok) out.reverted++;
      else out.failed++;
    }
    return out;
  }

  // ============ Schedule / Timeline / IO / Service ============

  async scheduleRun(opts: ScheduleRunOptions = {}): Promise<ScheduleRunReport> {
    const items = this.items.list({ enabled: true });
    const concurrentMax = opts.concurrentMax ?? this.config.asNumber('concurrent_max') ?? 4;
    const queueThreshold = opts.ioQueueThreshold ?? this.config.asNumber('io_queue_threshold') ?? 2;
    const busyThresholdPct =
      opts.ioBusyThresholdPct ?? this.config.asNumber('io_busy_threshold_pct') ?? 80;
    const confirmMs = opts.ioIdleConfirmMs ?? this.config.asNumber('io_idle_confirm_ms') ?? 500;

    // 收集 deps
    const deps = new Map<string, string[]>();
    for (const it of items) deps.set(it.id, this.deps.listFor(it.id).outgoing);

    const ioSource =
      opts.ioSource ??
      (process.platform === 'win32' ? new WindowsIoSource() : new FakeIdleIoSource());
    const scheduler = new Scheduler({
      items,
      deps,
      ioSource,
      concurrentMax,
      queueThreshold,
      busyThresholdPct,
      confirmMs,
      simulatedRunMs: opts.simulatedMs ?? 1000,
    });

    // 收集 started / failed
    const started: string[] = [];
    const failed: string[] = [];
    const startedAt = new Map<string, number>();
    const finishedAt = new Map<string, number>();
    scheduler.on('item-running', (e: { id: string; at: number }) => {
      startedAt.set(e.id, e.at);
    });
    scheduler.on('item-done', (e: { id: string; at: number }) => {
      finishedAt.set(e.id, e.at);
      started.push(e.id);
    });
    scheduler.on('item-failed', (e: { id: string }) => {
      failed.push(e.id);
    });

    const runId = randomUUID();
    const r: RunResult = await scheduler.run();
    const dryRun = !opts.real;

    // 写 startup_run + startup_run_event
    const insertRun = this.db.prepare(
      'INSERT INTO startup_run (id, started_at, finished_at, kind) VALUES (?, ?, ?, ?)',
    );
    const insertEvent = this.db.prepare(
      `INSERT INTO startup_run_event (run_id, item_id, scheduled_at, started_at, ready_at, ended_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const scheduledAt = r.started_at;
    insertRun.run(runId, r.started_at, r.finished_at ?? Date.now(), dryRun ? 'simulate' : 'manual');
    for (const it of items) {
      const sAt = startedAt.get(it.id) ?? null;
      const fAt = finishedAt.get(it.id) ?? null;
      const status = failed.includes(it.id) ? 'failed' : sAt ? 'started' : 'skipped';
      insertEvent.run(runId, it.id, scheduledAt, sAt, fAt ?? sAt, fAt ?? sAt, status);
    }

    this.opLog.write({
      actor: this.actor,
      action: 'schedule_run',
      target: null,
      args: { run_id: runId, dry_run: dryRun, total: items.length },
      result: 'ok',
    });

    return {
      kind: dryRun ? 'simulate' : 'manual',
      run_id: runId,
      total: r.total,
      paused_count: r.paused_count,
      paused_events: r.paused_events,
      started,
      failed,
      started_at: r.started_at,
      finished_at: r.finished_at ?? Date.now(),
      dry_run: dryRun,
    };
  }

  timeline(limit = 50): Array<{
    run_id: string;
    item_id: string;
    scheduled_at: number | null;
    started_at: number | null;
    ready_at: number | null;
    ended_at: number | null;
    status: string;
  }> {
    const rows = this.db
      .prepare(
        `SELECT e.run_id, e.item_id, e.scheduled_at, e.started_at, e.ready_at, e.ended_at, e.status
         FROM startup_run_event e
         JOIN startup_run r ON r.id = e.run_id
         WHERE r.id = (SELECT id FROM startup_run ORDER BY started_at DESC LIMIT 1)
         ORDER BY e.scheduled_at ASC
         LIMIT ?`,
      )
      .all(limit);
    return rows as Array<{
      run_id: string;
      item_id: string;
      scheduled_at: number | null;
      started_at: number | null;
      ready_at: number | null;
      ended_at: number | null;
      status: string;
    }>;
  }

  /**
   * run 历史：列出最近 N 次 startup_run（含摘要）。
   * 供 `starter run history` 与 MCP get_run_history 使用。
   */
  runHistory(limit = 5): Array<{
    run_id: string;
    kind: string;
    started_at: number;
    finished_at: number | null;
    total: number;
    paused_count: number;
  }> {
    const rows = this.db
      .prepare(
        `SELECT id as run_id, kind, started_at, finished_at,
                (SELECT COUNT(*) FROM startup_run_event e WHERE e.run_id = r.id) AS total
         FROM startup_run r
         ORDER BY started_at DESC
         LIMIT ?`,
      )
      .all(limit);
    return (
      rows as Array<{
        run_id: string;
        kind: string;
        started_at: number;
        finished_at: number | null;
        total: number;
      }>
    ).map((r) => ({ ...r, paused_count: 0 }));
  }

  /** 导出配置快照（F9 / RFC-001 §4.9）。返回 payload；可选写盘 */
  exportConfig(): ExportPayload {
    return exportSnapshot(this.db);
  }

  /**
   * 导入配置快照。导入前自动备份当前 db 到同目录 starter.db.bak-<ts>。
   * 返回导入报告（RFC-001 §4.9 merge/replace/append）。
   */
  importConfig(raw: string, mode: ImportMode = 'merge'): ImportReport {
    // 自动备份
    const path = this.dbPath();
    if (path && path !== ':memory:' && path !== '(unknown)') {
      try {
        const bak = `${path}.bak-${Date.now()}`;
        mkdirSync(dirname(path), { recursive: true });
        copyFileSync(path, bak);
      } catch {
        // 备份失败不阻断（只读/内存库）
      }
    }
    const report = importSnapshot(this.db, raw, mode);
    // 写 op_log
    try {
      this.opLog.write({
        actor: this.actor,
        action: 'import_config',
        args: { mode },
        result: 'ok',
        message: `items_in=${report.items_inserted} items_up=${report.items_updated}`,
      });
    } catch {
      // 忽略审计失败
    }
    return report;
  }

  /** 全部 config（含默认来源标注）。供 get_config / starter://config */
  configAll(): Record<string, { value: string; source: 'db' | 'default' }> {
    return this.config.all();
  }

  /** 全量依赖图（节点 + 边）。供 get_dependency_graph */
  dependencyGraph(): { nodes: string[]; edges: Array<{ from: string; to: string }> } {
    const items = this.items.list();
    const nodes = items.map((i) => i.id);
    const edges: Array<{ from: string; to: string }> = [];
    for (const it of items) {
      for (const dep of this.deps.listFor(it.id).outgoing) {
        edges.push({ from: it.id, to: dep });
      }
    }
    return { nodes, edges };
  }

  /** op_log 审计查询（最新优先）。供 list_changes */
  listChanges(limit = 50): unknown[] {
    return this.opLog.list(limit);
  }

  async ioStatus(): Promise<IoSample & { ok: boolean; error?: string }> {
    const source = process.platform === 'win32' ? new WindowsIoSource() : new FakeIdleIoSource();
    try {
      const s = await source.sample();
      return { ...s, ok: true };
    } catch (e) {
      return {
        idle_pct: 0,
        queue_len: 0,
        at: Date.now(),
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      await source.close?.();
    }
  }

  async serviceStatus(): Promise<ServiceStatus> {
    // 简单版本：调 sc query StarterDaemon（要 child_process）
    if (process.platform !== 'win32') {
      return { installed: false, running: false, state: 'unsupported_platform' };
    }
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('sc.exe', ['query', 'StarterDaemon'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 3000,
      });
      const stateMatch = stdout.match(/STATE\s*:\s*\d+\s+(\w+)/);
      const pidMatch = stdout.match(/PID\s*:\s*(\d+)/);
      const state = stateMatch?.[1] ?? 'UNKNOWN';
      const status: ServiceStatus = {
        installed: true,
        running: state === 'RUNNING',
        state,
      };
      if (pidMatch) status.pid = Number(pidMatch[1]);
      return status;
    } catch {
      return { installed: false, running: false, state: 'NOT_INSTALLED' };
    }
  }

  // ============ Doctor ============

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
