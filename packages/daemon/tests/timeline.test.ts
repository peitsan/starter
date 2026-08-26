import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createController } from '../src/controller.js';
import type { RpcController } from '../src/controller.js';
import { loadConfig } from '../src/config.js';

let tmp: string;
let ctrl: RpcController;

beforeEach(() => {
  tmp = join(tmpdir(), `starter-timeline-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const cfg = loadConfig({ dataDir: tmp });
  ctrl = createController({ config: cfg });
});
afterEach(() => {
  ctrl.close();
  if (existsSync(tmp)) rmSync(tmp, { recursive: true });
});

describe('RpcController.timelineData', () => {
  it('returns empty array when no log file', () => {
    const r = ctrl['timelineData'](10);
    assert.deepEqual(r, []);
  });
  it('returns empty when no *run started marker', () => {
    const path = join(tmp, 'run_events.ndjson');
    writeFileSync(path, '{"t":1,"run":"r1","item":"fp_xx","status":"started"}\n', 'utf8');
    const r = ctrl['timelineData'](10);
    assert.deepEqual(r, []);
  });
  it('returns events from latest run only', () => {
    const path = join(tmp, 'run_events.ndjson');
    // run 1
    appendFileSync(
      path,
      '{"t":100,"run":"r1","item":"*run","status":"started","detail":"items=2"}\n',
      'utf8',
    );
    appendFileSync(
      path,
      '{"t":110,"run":"r1","item":"fp_a","status":"started","detail":"pid=1"}\n',
      'utf8',
    );
    appendFileSync(
      path,
      '{"t":120,"run":"r1","item":"fp_b","status":"started","detail":"pid=2"}\n',
      'utf8',
    );
    // run 2 (newer)
    appendFileSync(
      path,
      '{"t":300,"run":"r2","item":"*run","status":"started","detail":"items=1"}\n',
      'utf8',
    );
    appendFileSync(
      path,
      '{"t":310,"run":"r2","item":"fp_c","status":"started","detail":"pid=3"}\n',
      'utf8',
    );
    const r = ctrl['timelineData'](10);
    assert.equal(r.length, 1);
    assert.equal(r[0]?.item_id, 'fp_c');
    assert.equal(r[0]?.run_id, 'r2');
    assert.equal(r[0]?.status, 'started');
  });
  it('respects limit', () => {
    const path = join(tmp, 'run_events.ndjson');
    appendFileSync(path, '{"t":100,"run":"r1","item":"*run","status":"started"}\n', 'utf8');
    for (let i = 0; i < 10; i++) {
      appendFileSync(
        path,
        `{"t":${200 + i * 10},"run":"r1","item":"fp_${i}","status":"started"}\n`,
        'utf8',
      );
    }
    const r = ctrl['timelineData'](3);
    assert.equal(r.length, 3);
  });
  it('skips bad json lines', () => {
    const path = join(tmp, 'run_events.ndjson');
    appendFileSync(path, '{"t":100,"run":"r1","item":"*run","status":"started"}\n', 'utf8');
    appendFileSync(path, '{not json\n', 'utf8');
    appendFileSync(path, '{"t":200,"run":"r1","item":"fp_a","status":"started"}\n', 'utf8');
    const r = ctrl['timelineData'](10);
    assert.equal(r.length, 1);
    assert.equal(r[0]?.item_id, 'fp_a');
  });
});

describe('RpcController.ioStatus', () => {
  it('returns sample with ok=true or ok=false with error', async () => {
    const r = await ctrl['ioStatus']();
    assert.ok(typeof r.idle_pct === 'number');
    assert.ok(typeof r.queue_len === 'number');
    assert.ok(typeof r.at === 'number');
    assert.ok(typeof r.ok === 'boolean');
  });
});

describe('RpcController.serviceStatus', () => {
  it('returns non-installed on test env', async () => {
    const r = await ctrl['serviceStatus']();
    if (process.platform === 'win32') {
      // 可能 installed / not installed 都行
      assert.ok(typeof r.installed === 'boolean');
    } else {
      assert.equal(r.installed, false);
      assert.equal(r.state, 'unsupported');
    }
  });
});
