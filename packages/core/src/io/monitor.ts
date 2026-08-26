/**
 * IO Watchdog — 实时监控磁盘 IO
 *
 * MVP 实现：用 node:os + readFileSync 读 /proc/diskstats（Linux），
 *          Windows 走 wmic 拿 disk time / queue（性能计数器可后续升级）
 *
 * 设计：
 *  - 抽象 IoSource 接口，测试用 fake
 *  - start() 周期采样；stop() 停止
 *  - 提供 isBusy(sample) 函数判忙
 *  - busy 持续 > confirm_ms 后切换 pause/resume 状态
 */

import { EventEmitter } from 'node:events';

export interface IoSample {
  /** 1.0 - 磁盘空闲率；越小越忙 */
  idle_pct: number;
  /** 当前队列长度 */
  queue_len: number;
  /** 时间戳 */
  at: number;
}

export interface IoSource {
  /** 拿一次采样 */
  sample(): Promise<IoSample>;
  /** 关闭资源 */
  close(): Promise<void>;
}

/** 判定是否繁忙 */
export function isBusy(s: IoSample, queueThreshold: number, busyThresholdPct: number): boolean {
  return s.queue_len >= queueThreshold || 100 - s.idle_pct >= busyThresholdPct;
}

/**
 * 始终空闲的 fake IoSource（用于测试 / 跨平台无 native 时）
 */
export class FakeIdleIoSource implements IoSource {
  async sample(): Promise<IoSample> {
    return { idle_pct: 100, queue_len: 0, at: Date.now() };
  }
  async close(): Promise<void> {
    /* */
  }
}

/**
 * Windows IoSource — 通过 wmic 拿 Win32_PerfRawData_PerfDisk_LogicalDisk
 * 简化：取 _Total 的 %IdleTime + 队列长度
 * 注意：wmic 在 Win11 已弃用但仍可用；v0.2 可换 PerformanceCounter / ETW
 */
export class WindowsIoSource implements IoSource {
  async sample(): Promise<IoSample> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    try {
      // 用 typeperf 拿 raw counter（更可靠，wmic 在新 PS 不可用）
      const { stdout } = await execFileAsync(
        'typeperf.exe',
        [
          '-sc',
          '1',
          '\\LogicalDisk(_Total)\\% Idle Time',
          '\\LogicalDisk(_Total)\\Current Disk Queue Length',
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 3000 },
      );
      return parseTypeperf(stdout);
    } catch {
      return { idle_pct: 100, queue_len: 0, at: Date.now() };
    }
  }
  async close(): Promise<void> {
    /* */
  }
}

/** 解析 typeperf 输出（CSV-like） */
export function parseTypeperf(stdout: string): IoSample {
  // 例：
  // "(PDH-CSV 4.0)","\\HOST\LogicalDisk(_Total)\% Idle Time","\\HOST\LogicalDisk(_Total)\Current Disk Queue Length"
  // "09/01/2026 12:00:00.000","99.5","0.1"
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 3) return { idle_pct: 100, queue_len: 0, at: Date.now() };
  const dataLine = lines[2] ?? '';
  // 去掉前后引号，按 "," split
  const parts = dataLine.split('","').map((p) => p.replace(/^"|"$/g, ''));
  const idle = parts[1] !== undefined ? Number(parts[1]) : NaN;
  const queue = parts[2] !== undefined ? Number(parts[2]) : NaN;
  return {
    idle_pct: Number.isFinite(idle) ? idle : 100,
    queue_len: Number.isFinite(queue) ? queue : 0,
    at: Date.now(),
  };
}

export interface WatchdogOptions {
  source: IoSource;
  queueThreshold: number;
  busyThresholdPct: number;
  /** 连续多少 ms 繁忙才切到 paused；默认 3000 */
  confirmMs?: number;
  /** 采样间隔 ms；默认 500 */
  intervalMs?: number;
}

export class Watchdog extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private firstBusySince: number | null = null;
  private currentPause = false;
  private last: IoSample | null = null;
  constructor(private opts: WatchdogOptions) {
    super();
  }

  start(): void {
    if (this.timer) return;
    const tick = async (): Promise<void> => {
      try {
        const s = await this.opts.source.sample();
        this.last = s;
        this.emit('sample', s);
        const busy = isBusy(s, this.opts.queueThreshold, this.opts.busyThresholdPct);
        if (busy) {
          if (this.firstBusySince === null) this.firstBusySince = s.at;
          const dur = s.at - this.firstBusySince;
          if (!this.currentPause && dur >= (this.opts.confirmMs ?? 3000)) {
            this.currentPause = true;
            this.emit('pause', s);
          }
        } else {
          this.firstBusySince = null;
          if (this.currentPause) {
            this.currentPause = false;
            this.emit('resume', s);
          }
        }
      } catch (e) {
        this.emit('error', e);
      }
    };
    const schedule = (): void => {
      if (!this.timer) return; // stopped
      void tick().finally(() => {
        if (this.timer) this.timer = setTimeout(schedule, this.opts.intervalMs ?? 500);
      });
    };
    this.timer = setTimeout(schedule, this.opts.intervalMs ?? 500);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isPaused(): boolean {
    return this.currentPause;
  }
  lastSample(): IoSample | null {
    return this.last;
  }
}
