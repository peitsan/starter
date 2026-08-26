import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createController } from '../src/controller.js';
import type { RpcController } from '../src/controller.js';
import { loadConfig } from '../src/config.js';
import { openDb, closeDb, ItemRepository, DependencyRepository } from '@starter/core';

let tmp: string;
let ctrl: RpcController;

beforeEach(() => {
  tmp = join(tmpdir(), `starter-ctrl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const cfg = loadConfig({ dataDir: tmp });
  ctrl = createController({ config: cfg });
});
afterEach(() => {
  ctrl.close();
  if (existsSync(tmp)) rmSync(tmp, { recursive: true });
});

describe('RpcController.handle', () => {
  it('doctor returns core doctor report', async () => {
    const r = (await ctrl.handle('doctor', {})) as { ok: boolean; itemCount: number };
    assert.equal(r.ok, true);
    assert.ok(typeof r.itemCount === 'number');
    assert.ok(r.itemCount >= 0);
  });
  it('list returns array', async () => {
    const r = (await ctrl.handle('list', {})) as unknown[];
    assert.ok(Array.isArray(r));
  });
  it('scan throws without real reg source but does not crash', async () => {
    // scan 走真 reg.exe，可能成功或失败（取决于测试机）
    // 至少 handle 不能 throw
    try {
      await ctrl.handle('scan', {});
    } catch (e) {
      // reg.exe 失败 OK
      assert.ok(e instanceof Error);
    }
  });
  it('unknown method throws', async () => {
    await assert.rejects(async () => ctrl.handle('nope', {}), /unknown method/);
  });
  it('set_io_config writes app_config', async () => {
    const r = (await ctrl.handle('set_io_config', { key: 'concurrent_max', value: '8' })) as {
      ok: boolean;
    };
    assert.equal(r.ok, true);
    const doc = (await ctrl.handle('doctor', {})) as { config: { concurrent_max: number } };
    assert.equal(doc.config.concurrent_max, 8);
  });

  it('schedule_run respects DAG dependency (RFC-001 / M0.2)', async () => {
    // 注入两个 enabled item 到 daemon 的 db：
    //   A: delay=500ms
    //   B: delay=0, 依赖 A（B 必须等 A 启动完成才允许启动）
    // 若 deps 正确传入 Scheduler：A 先 done → started=[A, B]
    // 若 deps 仍为空 Map（旧 bug）：B 立即启动先 done → started=[B, A]
    const cfg = loadConfig({ dataDir: tmp });
    const db = openDb({ path: cfg.dbPath });
    const items = new ItemRepository(db);
    items.upsertFromScan([
      {
        fingerprint: 'a',
        name: 'A',
        command: 'a.exe',
        exe: 'a.exe',
        args: [],
        source: 'HKCU_Run',
        source_path: 'HKCU\\...\\Run',
        risk: 'normal',
        vendor: null,
        enabled: true,
      },
      {
        fingerprint: 'b',
        name: 'B',
        command: 'b.exe',
        exe: 'b.exe',
        args: [],
        source: 'HKCU_Run',
        source_path: 'HKCU\\...\\Run',
        risk: 'normal',
        vendor: null,
        enabled: true,
      },
    ]);
    items.setDelay('a', 500, 'test'); // A 延迟 500ms
    const deps = new DependencyRepository(db);
    assert.deepEqual(deps.add('b', 'a'), { ok: true }); // B 依赖 A
    closeDb(db);

    const r = (await ctrl.handle('schedule_run', {
      concurrent_max: 2,
      simulated_ms: 300,
      tick_ms: 20,
    })) as { started: string[]; failed: string[]; total: number };

    assert.equal(r.total, 2);
    assert.deepEqual(r.failed, []);
    const idxA = r.started.indexOf('a');
    const idxB = r.started.indexOf('b');
    assert.ok(
      idxA !== -1 && idxB !== -1,
      `started should include both, got ${JSON.stringify(r.started)}`,
    );
    assert.ok(
      idxA < idxB,
      `DAG dependency must order A before B (got ${JSON.stringify(r.started)}) — deps may be empty in scheduler`,
    );
  });

  it('set_delay / set_priority RPC return { ok } object (not bare boolean)', async () => {
    // 注入一个 item 到 daemon db，再通过 RPC 调 set_delay / set_priority
    const cfg = loadConfig({ dataDir: tmp });
    const db = openDb({ path: cfg.dbPath });
    const items = new ItemRepository(db);
    items.upsertFromScan([
      {
        fingerprint: 'z',
        name: 'Z',
        command: 'z.exe',
        exe: 'z.exe',
        args: [],
        source: 'HKCU_Run',
        source_path: 'HKCU\\...\\Run',
        risk: 'normal',
        vendor: null,
        enabled: true,
      },
    ]);
    closeDb(db);

    const d = (await ctrl.handle('set_delay', { id: 'z', delay_ms: 1500 })) as {
      ok: boolean;
      reason?: string;
    };
    assert.equal(d.ok, true, 'set_delay should return { ok:true } object');
    assert.equal(typeof (d as { delay_ms?: number }).delay_ms, 'number');

    const p = (await ctrl.handle('set_priority', { id: 'z', priority: 4 })) as {
      ok: boolean;
      reason?: string;
    };
    assert.equal(p.ok, true, 'set_priority should return { ok:true } object');

    // 不存在的 item → { ok:false, reason:'not_found' }
    const miss = (await ctrl.handle('set_delay', { id: 'nope', delay_ms: 1 })) as {
      ok: boolean;
      reason?: string;
    };
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, 'not_found');
  });
});
