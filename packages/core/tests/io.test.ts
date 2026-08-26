import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { isBusy, parseTypeperf, Watchdog, FakeIdleIoSource } from '../src/index.js';
import type { IoSample, IoSource } from '../src/index.js';

/** 测试用可控 IoSource：按序列返回 samples */
class ScriptedIoSource implements IoSource {
  private i = 0;
  constructor(private script: IoSample[]) {}
  async sample(): Promise<IoSample> {
    const s = this.script[this.i] ?? this.script[this.script.length - 1]!;
    this.i++;
    return { ...s, at: Date.now() + this.i * 600 }; // 间隔 600ms
  }
  async close(): Promise<void> {
    /* */
  }
}

describe('isBusy', () => {
  it('idle when both thresholds met', () => {
    assert.equal(isBusy({ idle_pct: 100, queue_len: 0, at: 0 }, 2, 80), false);
  });
  it('busy when queue >= threshold', () => {
    assert.equal(isBusy({ idle_pct: 99, queue_len: 2, at: 0 }, 2, 80), true);
  });
  it('busy when activity >= threshold', () => {
    assert.equal(isBusy({ idle_pct: 19, queue_len: 0, at: 0 }, 2, 80), true); // 100-19=81% >= 80
  });
});

describe('parseTypeperf', () => {
  it('parses standard CSV output', () => {
    const stdout = [
      '"(PDH-CSV 4.0)","\\\\HOST\\LogicalDisk(_Total)\\% Idle Time","\\\\HOST\\LogicalDisk(_Total)\\Current Disk Queue Length"',
      '"09/01/2026 12:00:00.000"',
      '"09/01/2026 12:00:01.000","95.3","0.5"',
    ].join('\r\n');
    const s = parseTypeperf(stdout);
    assert.equal(s.idle_pct, 95.3);
    assert.equal(s.queue_len, 0.5);
  });
  it('returns safe defaults on malformed input', () => {
    const s = parseTypeperf('garbage');
    assert.equal(s.idle_pct, 100);
    assert.equal(s.queue_len, 0);
  });
});

describe('Watchdog', () => {
  it('emits pause after confirmMs of busy', async () => {
    const source = new ScriptedIoSource([
      { idle_pct: 0, queue_len: 5, at: 0 }, // busy
      { idle_pct: 0, queue_len: 5, at: 0 },
      { idle_pct: 0, queue_len: 5, at: 0 },
      { idle_pct: 0, queue_len: 5, at: 0 },
      { idle_pct: 100, queue_len: 0, at: 0 }, // back to idle
    ]);
    const wd = new Watchdog({
      source,
      queueThreshold: 2,
      busyThresholdPct: 80,
      confirmMs: 100,
      intervalMs: 30,
    });
    let pausedFired = 0;
    let resumedFired = 0;
    wd.on('pause', () => pausedFired++);
    wd.on('resume', () => resumedFired++);
    wd.start();
    await new Promise((r) => setTimeout(r, 400));
    wd.stop();
    assert.equal(pausedFired, 1);
    assert.equal(resumedFired, 1);
  });
  it('does not pause on brief busy', async () => {
    const source = new ScriptedIoSource([
      { idle_pct: 0, queue_len: 5, at: 0 },
      { idle_pct: 100, queue_len: 0, at: 0 },
    ]);
    const wd = new Watchdog({
      source,
      queueThreshold: 2,
      busyThresholdPct: 80,
      confirmMs: 1000,
      intervalMs: 30,
    });
    let pausedFired = 0;
    wd.on('pause', () => pausedFired++);
    wd.start();
    await new Promise((r) => setTimeout(r, 200));
    wd.stop();
    assert.equal(pausedFired, 0);
  });
  it('FakeIdleIoSource never busy', async () => {
    const wd = new Watchdog({
      source: new FakeIdleIoSource(),
      queueThreshold: 2,
      busyThresholdPct: 80,
    });
    wd.start();
    await new Promise((r) => setTimeout(r, 100));
    wd.stop();
    assert.equal(wd.isPaused(), false);
  });
});
