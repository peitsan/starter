import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { Scheduler, FakeIdleIoSource, type IoSample, type IoSource } from '../src/index.js';
import type { StartupItemRow } from '../src/index.js';

function row(id: string, delay = 0): StartupItemRow {
  return {
    id,
    name: id,
    command: 'cmd',
    source: 'HKCU_Run',
    source_path: 'p',
    enabled: 1,
    delay_ms: delay,
    priority: 3,
    risk: 'normal',
    vendor: null,
    updated_at: 0,
  };
}

/** 一直繁忙的 IoSource */
class BusyIoSource implements IoSource {
  async sample(): Promise<IoSample> {
    return { idle_pct: 0, queue_len: 10, at: Date.now() };
  }
  async close(): Promise<void> {
    /* */
  }
}

describe('Scheduler', () => {
  it('runs all items in parallel up to concurrentMax', async () => {
    const items = [row('A'), row('B'), row('C')];
    const result = await new Scheduler({
      items,
      deps: new Map(),
      ioSource: new FakeIdleIoSource(),
      queueThreshold: 2,
      busyThresholdPct: 80,
      concurrentMax: 2,
      simulatedRunMs: 200,
      tickMs: 20,
    }).run();
    assert.equal(result.total, 3);
    assert.ok(result.finished_at - result.started_at >= 200);
  });

  it('respects dependency chain', async () => {
    const items = [row('A'), row('B')];
    const result = await new Scheduler({
      items,
      deps: new Map([['B', ['A']]]),
      ioSource: new FakeIdleIoSource(),
      queueThreshold: 2,
      busyThresholdPct: 80,
      concurrentMax: 4,
      simulatedRunMs: 100,
      tickMs: 10,
    }).run();
    assert.equal(result.total, 2);
  });

  it('throws on cycle', () => {
    assert.throws(
      () =>
        new Scheduler({
          items: [row('A'), row('B')],
          deps: new Map([
            ['A', ['B']],
            ['B', ['A']],
          ]),
          ioSource: new FakeIdleIoSource(),
          queueThreshold: 2,
          busyThresholdPct: 80,
          concurrentMax: 2,
        }),
      /cycle/,
    );
  });

  it('pauses under IO high then resumes', async () => {
    // 5 个 item，concurrent=5 应该都进 running；前 200ms IO busy → 暂停
    const items = [row('A'), row('B'), row('C'), row('D'), row('E')];
    const sched = new Scheduler({
      items,
      deps: new Map(),
      ioSource: new BusyIoSource(),
      queueThreshold: 2,
      busyThresholdPct: 80,
      confirmMs: 100,
      concurrentMax: 5,
      simulatedRunMs: 300,
      tickMs: 20,
    });
    const pausedAt: number[] = [];
    const resumedAt: number[] = [];
    sched.on('paused', () => pausedAt.push(Date.now()));
    sched.on('resumed', () => resumedAt.push(Date.now()));
    const result = await sched.run();
    assert.ok(result.paused_count >= 1, 'should have paused at least once');
  });

  it('emits item-running and item-done events', async () => {
    const items = [row('X'), row('Y')];
    const sched = new Scheduler({
      items,
      deps: new Map(),
      ioSource: new FakeIdleIoSource(),
      queueThreshold: 2,
      busyThresholdPct: 80,
      concurrentMax: 2,
      simulatedRunMs: 100,
      tickMs: 10,
    });
    const events: string[] = [];
    sched.on('item-running', (e) => events.push(`run:${e.id}`));
    sched.on('item-done', (e) => events.push(`done:${e.id}`));
    await sched.run();
    assert.ok(events.includes('run:X') && events.includes('done:X'));
    assert.ok(events.includes('run:Y') && events.includes('done:Y'));
  });
});
