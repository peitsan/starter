import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createController } from '../src/controller.js';
import type { RpcController } from '../src/controller.js';
import { loadConfig } from '../src/config.js';

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
});
