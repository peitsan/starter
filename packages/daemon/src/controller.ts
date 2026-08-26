/**
 * 业务控制器：把 RPC method 映射到 @starter/core 的能力
 *
 * RPC API:
 *   scan          → 扫描并入库
 *   list          → 列表
 *   show          → 详情
 *   enable        → 启用
 *   disable       → 禁用
 *   set_delay     → 设延迟
 *   set_priority  → 设优先级
 *   set_io_config → 设 IO 节流阈值
 *   doctor        → 自检
 *   get_token     → 返回当前 auth token（仅 127.0.0.1）
 *   schedule_run  → 真实启动调度（用 CreateProcess 拉起进程）
 */

import { Controller, detectScanner, Scheduler, WindowsIoSource } from '@starter/core';
import type { StartupItemRow, StartupItemFilter } from '@starter/core';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DaemonConfig } from './config.js';
import { spawnItem } from './scheduler-exec.js';

export interface RpcContext {
  config: DaemonConfig;
}

export class RpcController {
  private core: Controller;

  constructor(private ctx: RpcContext) {
    this.core = new Controller({ scanner: detectScanner(), actor: 'daemon' });
  }

  close(): void {
    this.core.close();
  }

  async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'scan':
        return await this.core.scan();
      case 'list': {
        const filter: StartupItemFilter = {};
        if (typeof params.source === 'string') filter.source = params.source;
        if (typeof params.enabled === 'boolean') filter.enabled = params.enabled;
        if (typeof params.risk === 'string') filter.risk = params.risk;
        if (typeof params.search === 'string') filter.search = params.search;
        return this.core.list(filter);
      }
      case 'show': {
        const id = String(params.id ?? '');
        const item = this.core.show(id);
        if (!item) return null;
        const deps = this.core.listDependencies(id);
        return { ...item, dependencies: deps };
      }
      case 'enable': {
        const id = String(params.id ?? '');
        return await this.core.enable(id);
      }
      case 'disable': {
        const id = String(params.id ?? '');
        return await this.core.disable(id);
      }
      case 'set_delay': {
        const id = String(params.id ?? '');
        const ms = Number(params.delay_ms);
        return this.core.setDelay(id, ms);
      }
      case 'set_priority': {
        const id = String(params.id ?? '');
        const p = Number(params.priority);
        return this.core.setPriority(id, p);
      }
      case 'set_io_config': {
        const k = String(params.key ?? '');
        const v = String(params.value ?? '');
        (this.core.config.set as (k: string, v: string, a: string) => void)(k, v, 'daemon');
        return { ok: true };
      }
      case 'doctor':
        return this.core.doctor();
      case 'schedule_run': {
        return await this.scheduleRun({
          concurrentMax: Number(params.concurrent_max ?? 4),
          simulatedRunMs: Number(params.simulated_ms ?? 5000),
          tickMs: Number(params.tick_ms ?? 200),
        });
      }
      case 'timeline': {
        const limit = Number(params.limit ?? 50);
        return this.timelineData(limit);
      }
      case 'io_status': {
        return await this.ioStatus();
      }
      case 'service_status': {
        return await this.serviceStatus();
      }
      case 'add_dependency': {
        const id = String(params.id ?? '');
        const dep = String(params.depends_on ?? '');
        return this.core.addDependency(id, dep);
      }
      case 'remove_dependency': {
        const id = String(params.id ?? '');
        const dep = String(params.depends_on ?? '');
        return { ok: this.core.removeDependency(id, dep), id, depends_on: dep };
      }
      case 'list_dependencies': {
        const id = String(params.id ?? '');
        return { ok: true, ...this.core.listDependencies(id) };
      }
      case 'apply_preset': {
        const rules = Array.isArray(params.rules) ? params.rules : [];
        return this.core.applyPreset(rules as Parameters<typeof this.core.applyPreset>[0]);
      }
      case 'undo_last_change': {
        const limit = Number(params.limit ?? 5);
        return await this.core.undoLast(limit);
      }
      default:
        throw new Error(`unknown method: ${method}`);
    }
  }

  /**
   * 真实启动调度：扫描 enabled items + 按 DAG + 延迟 + 并发 + IO 节流真起进程
   * 仅做架构骨架：MVP 用 spawn 同步拉起，v0.3 接 Windows CreateProcess + Priority
   */
  private async scheduleRun(opts: {
    concurrentMax: number;
    simulatedRunMs: number;
    tickMs: number;
  }): Promise<{
    total: number;
    paused_count: number;
    started: string[];
    failed: string[];
    run_id: string;
    dry_run: boolean;
  }> {
    const items = this.core.list({ enabled: true });
    if (items.length === 0) {
      return {
        total: 0,
        paused_count: 0,
        started: [],
        failed: [],
        run_id: '',
        dry_run: opts.simulatedRunMs > 0,
      };
    }

    const runId = randomUUID();
    const startedAt = Date.now();
    this.logRunEvent(runId, '*run', 'started', startedAt, `items=${items.length}`);

    const sched = new Scheduler({
      items,
      deps: new Map(),
      ioSource: new WindowsIoSource(),
      queueThreshold: this.core.config.asNumber('io_queue_threshold'),
      busyThresholdPct: this.core.config.asNumber('io_busy_threshold_pct'),
      confirmMs: this.core.config.asNumber('io_idle_confirm_ms'),
      concurrentMax: opts.concurrentMax,
      simulatedRunMs: opts.simulatedRunMs,
      tickMs: opts.tickMs,
    });
    const started: string[] = [];
    const failed: string[] = [];
    sched.on('item-running', (e: { id: string }) => {
      const item = items.find((i: StartupItemRow) => i.id === e.id);
      if (!item) {
        failed.push(`${e.id}: item vanished`);
        this.logRunEvent(runId, e.id, 'missing', Date.now());
        return;
      }
      // simulatedRunMs > 0 → 干跑（不真起进程）
      if (opts.simulatedRunMs > 0) {
        started.push(e.id);
        this.logRunEvent(runId, e.id, 'simulated', Date.now(), `prio=${item.priority}`);
        return;
      }
      try {
        const r = spawnItem(item);
        started.push(e.id);
        this.logRunEvent(runId, e.id, 'started', Date.now(), `pid=${r.pid} prio=${r.priority}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failed.push(`${e.id}: ${msg}`);
        this.logRunEvent(runId, e.id, 'failed', Date.now(), msg);
      }
    });
    const r = await sched.run();
    this.logRunEvent(
      runId,
      '*run',
      'finished',
      Date.now(),
      `started=${started.length} failed=${failed.length} paused=${r.paused_count}`,
    );
    return {
      total: r.total,
      paused_count: r.paused_count,
      started,
      failed,
      run_id: runId,
      dry_run: opts.simulatedRunMs > 0,
    };
  }

  private spawnItem(item: StartupItemRow): void {
    if (process.platform !== 'win32') {
      // POSIX：直接 execve
      const child = spawn(item.command, { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
    // 真起：走 scheduler-exec（处理 priority + Windows quirks）
    spawnItem(item);
  }

  /** 写一行启动事件到本地 db（不依赖 core，daemon 自己负责） */
  private logRunEvent(
    runId: string,
    itemId: string,
    status: string,
    ts: number,
    detail = '',
  ): void {
    try {
      const line = `${JSON.stringify({ t: ts, run: runId, item: itemId, status, detail })}\n`;
      appendFileSync(join(this.ctx.config.dataDir, 'run_events.ndjson'), line, 'utf8');
    } catch {
      // 静默失败：log 错误不该 crash 调度
    }
  }

  /**
   * timeline data — 从 run_events.ndjson 解析最近 N 个 item 状态
   * 返回：[{ run_id, item_id, status, t, detail }]  按 t 升序
   */
  timelineData(
    limit: number,
  ): Array<{ run_id: string; item_id: string; status: string; t: number; detail: string }> {
    const path = join(this.ctx.config.dataDir, 'run_events.ndjson');
    if (!existsSync(path)) return [];
    try {
      const raw = readFileSync(path, 'utf8');
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const startIdx: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i] ?? '';
        if (ln.includes('"item":"*run"') && ln.includes('"status":"started"')) {
          startIdx.push(i);
        }
      }
      if (startIdx.length === 0) return [];
      const start = startIdx[startIdx.length - 1]!;
      const block = lines.slice(start);
      const out: Array<{
        run_id: string;
        item_id: string;
        status: string;
        t: number;
        detail: string;
      }> = [];
      for (const ln of block) {
        try {
          const o = JSON.parse(ln) as {
            run: string;
            item: string;
            status: string;
            t: number;
            detail?: string;
          };
          if (o.item === '*run') continue;
          out.push({
            run_id: o.run,
            item_id: o.item,
            status: o.status,
            t: o.t,
            detail: o.detail ?? '',
          });
        } catch {
          // skip bad lines
        }
        if (out.length >= limit) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  /** 当前磁盘 IO 状态（采样一次） */
  async ioStatus(): Promise<{
    idle_pct: number;
    queue_len: number;
    at: number;
    ok: boolean;
    error?: string;
  }> {
    const src = new WindowsIoSource();
    try {
      const s = await src.sample();
      return { idle_pct: s.idle_pct, queue_len: s.queue_len, at: s.at, ok: true };
    } catch (e) {
      return {
        idle_pct: 100,
        queue_len: 0,
        at: Date.now(),
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    } finally {
      await src.close();
    }
  }

  /** Windows Service 状态（sc query） */
  async serviceStatus(): Promise<{
    installed: boolean;
    running: boolean;
    state: string;
    pid?: number;
  }> {
    if (process.platform !== 'win32') {
      return { installed: false, running: false, state: 'unsupported' };
    }
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    try {
      const { stdout } = await execFileAsync('sc', ['query', 'StarterDaemon'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const stateMatch = /STATE\s+:\s+(\d+)\s+(\w+)/.exec(stdout);
      const pidMatch = /\((\d+)\)/.exec(stdout);
      const state = stateMatch?.[2] ?? 'UNKNOWN';
      const pid = pidMatch ? Number(pidMatch[1]) : undefined;
      const out: { installed: boolean; running: boolean; state: string; pid?: number } = {
        installed: true,
        running: state === 'RUNNING',
        state,
      };
      if (pid !== undefined) out.pid = pid;
      return out;
    } catch (e) {
      return {
        installed: false,
        running: false,
        state: e instanceof Error ? e.message : 'not installed',
      };
    }
  }
}

export function createController(ctx: RpcContext): RpcController {
  return new RpcController(ctx);
}
