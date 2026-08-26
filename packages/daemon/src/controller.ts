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
import type { DaemonConfig } from './config.js';

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
        return this.core.show(id);
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
  }): Promise<{ total: number; paused_count: number; started: string[]; failed: string[] }> {
    const items = this.core.list({ enabled: true });
    if (items.length === 0) return { total: 0, paused_count: 0, started: [], failed: [] };

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
      // 真起进程（用 spawn —— v0.3 改 child_process CreateProcessW）
      const item = items.find((i: StartupItemRow) => i.id === e.id);
      if (item) {
        try {
          this.spawnItem(item);
          started.push(e.id);
        } catch (err) {
          failed.push(`${e.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
    const r = await sched.run();
    return { total: r.total, paused_count: r.paused_count, started, failed };
  }

  private spawnItem(item: StartupItemRow): void {
    if (process.platform !== 'win32') {
      // POSIX：直接 execve
      const child = spawn(item.command, { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    }
    // Windows：reg.exe 没现成 API 提优先级，spawn 后用 child.pid + SetPriorityClass
    // v0.3 用 ffi-napi 调 SetPriorityClass；MVP 直接 spawn
    const child = spawn(item.command, { detached: true, stdio: 'ignore', shell: false });
    child.unref();
  }
}

export function createController(ctx: RpcContext): RpcController {
  return new RpcController(ctx);
}
