/**
 * 调度引擎 — F3/F4/F5/F6 合一
 *
 * 不真启动进程（MVP：模拟延迟后写 startup_run_event；v0.2 接 spawner）
 *
 * 主循环伪代码：
 *   while (!dag.allTerminal()) {
 *     if (watchdog.isPaused()) { sleep(200); continue; }
 *     if (workerPool.inUse() >= concurrentMax) { sleep(200); continue; }
 *     const next = dag.readyNodes(now - startTime);
 *     if (next.length === 0) { sleep(200); continue; }
 *     const node = next[0];
 *     dag.setStatus(node.id, 'running');
 *     workerPool.acquire();
 *     runAsync(node);   // 模拟
 *   }
 */

import { EventEmitter } from 'node:events';
import { Dag, type DagNode } from '../dag/index.js';
import { Watchdog, FakeIdleIoSource, type IoSource } from '../io/index.js';
import type { StartupItemRow } from '../store/index.js';
import { randomUUID } from 'node:crypto';

export interface SchedulerOptions {
  items: StartupItemRow[];
  deps: Map<string, string[]>;
  ioSource?: IoSource;
  queueThreshold: number;
  busyThresholdPct: number;
  confirmMs?: number;
  concurrentMax: number;
  /** 每个 item 模拟运行多久 ms；默认 1000 */
  simulatedRunMs?: number;
  /** tick 间隔 ms；默认 100 */
  tickMs?: number;
}

export type SchedulerEvent =
  | 'start'
  | 'item-scheduled'
  | 'item-running'
  | 'item-done'
  | 'item-failed'
  | 'paused'
  | 'resumed'
  | 'complete';

export class Scheduler extends EventEmitter {
  private dag: Dag;
  private watchdog: Watchdog;
  private inUse = 0;
  private startedAt = 0;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private simulatedRunMs: number;
  private tickMs: number;
  private concurrentMax: number;
  private pausedEvents: Array<{ reason: string; at: number }> = [];

  constructor(private opts: SchedulerOptions) {
    super();
    // 验证 DAG
    const v = Dag.validate(opts.items, opts.deps);
    if (!v.ok) throw new Error(`DAG cycle: ${v.cycle.join(' -> ')}`);
    this.dag = new Dag(opts.items, opts.deps);
    const ioSource = opts.ioSource ?? new FakeIdleIoSource();
    this.watchdog = new Watchdog({
      source: ioSource,
      queueThreshold: opts.queueThreshold,
      busyThresholdPct: opts.busyThresholdPct,
      ...(opts.confirmMs !== undefined ? { confirmMs: opts.confirmMs } : {}),
      ...(opts.tickMs !== undefined ? { intervalMs: opts.tickMs } : {}),
    });
    this.simulatedRunMs = opts.simulatedRunMs ?? 1000;
    this.tickMs = opts.tickMs ?? 100;
    this.concurrentMax = opts.concurrentMax;

    this.watchdog.on('pause', (s) => {
      this.pausedEvents.push({ reason: 'io_high', at: s.at });
      this.emit('paused', s);
    });
    this.watchdog.on('resume', (s) => {
      this.emit('resumed', s);
    });
  }

  /** 启动并等所有节点完成（返回 run 统计） */
  async run(): Promise<RunResult> {
    if (this.running) throw new Error('already running');
    this.running = true;
    this.startedAt = Date.now();
    this.watchdog.start();
    this.emit('start', { at: this.startedAt, count: this.dag.size() });

    return new Promise((resolve) => {
      const tick = (): void => {
        if (this.dag.allTerminal()) {
          this.watchdog.stop();
          this.running = false;
          const result: RunResult = {
            run_id: randomUUID(),
            started_at: this.startedAt,
            finished_at: Date.now(),
            total: this.dag.size(),
            paused_count: this.pausedEvents.length,
            paused_events: this.pausedEvents,
          };
          this.emit('complete', result);
          resolve(result);
          return;
        }

        // IO 繁忙 → 暂停
        if (this.watchdog.isPaused()) {
          this.timer = setTimeout(tick, this.tickMs * 2);
          return;
        }
        // 并发满了
        if (this.inUse >= this.concurrentMax) {
          this.timer = setTimeout(tick, this.tickMs);
          return;
        }
        // 找下一个 ready
        const now = Date.now() - this.startedAt;
        const next = this.dag.readyNodes(now);
        if (next.length === 0) {
          this.timer = setTimeout(tick, this.tickMs);
          return;
        }

        const node = next[0]!;
        const id = node.item.id;
        this.dag.setStatus(id, 'running');
        this.inUse++;
        this.emit('item-running', { id, name: node.item.name, at: Date.now() });
        this.timer = setTimeout(tick, this.tickMs);

        // 模拟运行
        setTimeout(() => {
          this.dag.setStatus(id, 'done');
          this.inUse--;
          this.emit('item-done', { id, name: node.item.name, at: Date.now() });
        }, this.simulatedRunMs);
      };
      tick();
    });
  }

  /** 中途停止 */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.watchdog.stop();
    this.running = false;
  }

  /** 当前状态快照（用于 UI / test） */
  snapshot(): { status: Array<{ id: string; status: string }>; paused: boolean; inUse: number } {
    const status: Array<{ id: string; status: string }> = [];
    for (const [id, n] of (this.dag as unknown as { nodes: Map<string, DagNode> }).nodes) {
      status.push({ id, status: n.status });
    }
    return { status, paused: this.watchdog.isPaused(), inUse: this.inUse };
  }
}

export interface RunResult {
  run_id: string;
  started_at: number;
  finished_at: number;
  total: number;
  paused_count: number;
  paused_events: Array<{ reason: string; at: number }>;
}
