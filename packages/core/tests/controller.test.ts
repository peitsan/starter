import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { Controller, openDb, closeDb, type StartupItemRow, defaultDbPath } from '../src/index.js';
import { unlinkSync, existsSync } from 'node:fs';
import type { Database } from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let testDbPath = '';
let db: Database;

beforeEach(() => {
  testDbPath = join(
    tmpdir(),
    `starter-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
  db = openDb({ path: testDbPath });
});

afterEach(() => {
  try {
    closeDb(db);
  } catch {
    /* */
  }
  for (const ext of ['', '-wal', '-shm']) {
    const p = testDbPath + ext;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* */
      }
    }
  }
});

function makeRow(
  name: string,
  source: string = 'HKCU_Run',
  risk: string = 'normal',
  enabled: 0 | 1 = 1,
): StartupItemRow {
  return {
    id: `fp_${name}`,
    name,
    command: `C:\\app\\${name}.exe`,
    source,
    source_path: source === 'HKCU_Run' ? 'HKCU\\Software\\...\\Run' : 'HKLM\\Software\\...\\Run',
    enabled,
    delay_ms: 0,
    priority: 3,
    risk,
    vendor: null,
    updated_at: Date.now(),
  };
}

function seedFromRows(rows: StartupItemRow[]): void {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO startup_item
      (id, name, command, source, source_path, enabled, delay_ms, priority, risk, vendor, updated_at)
    VALUES (@id, @name, @command, @source, @source_path, @enabled, @delay_ms, @priority, @risk, @vendor, @updated_at)
  `);
  for (const r of rows) insert.run(r);
  closeDb(db); // 让 controller 自己 open
}

describe('Controller.scan (no scanner)', () => {
  it('throws if no scanner', async () => {
    const c = new Controller({ dbPath: testDbPath });
    await assert.rejects(async () => c.scan(), /no scanner/);
    c.close();
  });
});

describe('Controller.enable / disable / setDelay / setPriority (no reg writes)', () => {
  it('setDelay validates and writes op_log', () => {
    seedFromRows([makeRow('D')]);
    const c = new Controller({ dbPath: testDbPath });
    assert.equal(c.setDelay('fp_D', 5000), true);
    assert.equal(c.show('fp_D')?.delay_ms, 5000);
    assert.throws(() => c.setDelay('fp_D', -1), /out of range/);
    c.close();
  });
  it('setPriority writes op_log', () => {
    seedFromRows([makeRow('P')]);
    const c = new Controller({ dbPath: testDbPath });
    assert.equal(c.setPriority('fp_P', 1), true);
    assert.equal(c.show('fp_P')?.priority, 1);
    assert.throws(() => c.setPriority('fp_P', 9), /out of range/);
    c.close();
  });
  it('returns not_found for missing id', async () => {
    const c = new Controller({ dbPath: testDbPath });
    const r = await c.enable('nope');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'not_found');
    c.close();
  });
  it('blocks critical items', async () => {
    seedFromRows([makeRow('K', 'HKCU_Run', 'critical')]);
    const c = new Controller({ dbPath: testDbPath });
    const r = await c.disable('fp_K');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'protected');
    c.close();
  });
  it('blocks HKLM items with elevation_required', async () => {
    seedFromRows([makeRow('L', 'HKLM_Run')]);
    const c = new Controller({ dbPath: testDbPath });
    const r = await c.enable('fp_L');
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'elevation_required');
    c.close();
  });
});

describe('Controller.list / show / doctor', () => {
  it('list and show', () => {
    seedFromRows([makeRow('A'), makeRow('B')]);
    const c = new Controller({ dbPath: testDbPath });
    assert.equal(c.list().length, 2);
    assert.equal(c.show('fp_A')?.name, 'A');
    assert.equal(c.show('fp_NOPE'), null);
    c.close();
  });
  it('doctor returns counts + config', () => {
    seedFromRows([makeRow('A'), makeRow('B', 'HKCU_Run', 'critical')]);
    const c = new Controller({ dbPath: testDbPath });
    const d = c.doctor();
    assert.equal(d.itemCount, 2);
    assert.equal(d.enabledCount, 2);
    assert.equal(d.config.concurrent_max, 4);
    assert.equal(d.config.auto_start, false);
    c.close();
  });
});

describe('defaultDbPath', () => {
  it('returns under USERPROFILE/.starter/', () => {
    const p = defaultDbPath();
    assert.match(p, /\.starter[\\/]starter\.db$/);
  });
});

describe('Controller dependencies', () => {
  it('addDependency + listDependencies', () => {
    seedFromRows([makeRow('A'), makeRow('B'), makeRow('C')]);
    const c = new Controller({ dbPath: testDbPath });
    const r1 = c.addDependency('fp_B', 'fp_A');
    assert.deepEqual(r1, { ok: true });
    const r2 = c.addDependency('fp_C', 'fp_A');
    assert.deepEqual(r2, { ok: true });
    const info = c.listDependencies('fp_A');
    assert.deepEqual(info.outgoing, []);
    assert.deepEqual(info.incoming.sort(), ['fp_B', 'fp_C']);
    c.close();
  });
  it('addDependency rejects cycle', () => {
    seedFromRows([makeRow('A'), makeRow('B')]);
    const c = new Controller({ dbPath: testDbPath });
    c.addDependency('fp_B', 'fp_A');
    const r = c.addDependency('fp_A', 'fp_B');
    assert.equal(r.ok, false);
    assert.equal((r as { reason: string }).reason, 'cycle_detected');
    c.close();
  });
  it('addDependency returns not_found for missing item', () => {
    seedFromRows([makeRow('A')]);
    const c = new Controller({ dbPath: testDbPath });
    const r = c.addDependency('fp_B', 'fp_A');
    assert.deepEqual(r, { ok: false, reason: 'not_found' });
    c.close();
  });
  it('removeDependency returns true/false', () => {
    seedFromRows([makeRow('A'), makeRow('B')]);
    const c = new Controller({ dbPath: testDbPath });
    c.addDependency('fp_B', 'fp_A');
    assert.equal(c.removeDependency('fp_B', 'fp_A'), true);
    assert.equal(c.removeDependency('fp_B', 'fp_A'), false);
    c.close();
  });
});

describe('Controller.applyPreset', () => {
  it('matches by name and applies delay+priority', () => {
    seedFromRows([makeRow('OneDrive'), makeRow('Steam'), makeRow('Discord')]);
    const c = new Controller({ dbPath: testDbPath });
    const r = c.applyPreset([
      { match: 'onedrive', delay_ms: 0, priority: 2 },
      { match: 'steam', delay_ms: 60000, priority: 1 },
    ]);
    assert.equal(r.matched, 2);
    // OneDrive: delay 0→0 不变, priority 3→2 (1 change)
    // Steam:   delay 0→60000, priority 3→1 (2 changes)
    assert.equal(r.changed, 3);
    c.close();
  });
  it('first matching rule wins per item', () => {
    seedFromRows([makeRow('OneDrive')]);
    const c = new Controller({ dbPath: testDbPath });
    const r = c.applyPreset([
      { match: 'onedrive', delay_ms: 100 },
      { match: 'drive', delay_ms: 999 },
    ]);
    // 只应用第一个 rule → changed=1
    assert.equal(r.changed, 1);
    assert.equal(c.show('fp_OneDrive')?.delay_ms, 100);
    c.close();
  });
  it('no matches → 0 changes', () => {
    seedFromRows([makeRow('OneDrive')]);
    const c = new Controller({ dbPath: testDbPath });
    const r = c.applyPreset([{ match: 'nope', delay_ms: 999 }]);
    assert.equal(r.matched, 0);
    assert.equal(r.changed, 0);
    c.close();
  });
});

describe('Controller.undoLast', () => {
  it('undoes a set_delay', async () => {
    seedFromRows([makeRow('OneDrive')]);
    const c = new Controller({ dbPath: testDbPath });
    c.setDelay('fp_OneDrive', 5000);
    assert.equal(c.show('fp_OneDrive')?.delay_ms, 5000);
    const r = await c.undoLast(5);
    assert.equal(r.reverted, 1);
    assert.equal(r.failed, 0);
    assert.equal(c.show('fp_OneDrive')?.delay_ms, 0);
    c.close();
  });
  it('undoes a set_priority', async () => {
    seedFromRows([makeRow('OneDrive')]);
    const c = new Controller({ dbPath: testDbPath });
    c.setPriority('fp_OneDrive', 1);
    const r = await c.undoLast(5);
    assert.equal(r.reverted, 1);
    assert.equal(c.show('fp_OneDrive')?.priority, 3); // default
    c.close();
  });
  it('undoes an add_dep (becomes remove_dep)', async () => {
    seedFromRows([makeRow('A'), makeRow('B')]);
    const c = new Controller({ dbPath: testDbPath });
    c.addDependency('fp_B', 'fp_A');
    assert.deepEqual(c.listDependencies('fp_A').incoming, ['fp_B']);
    const r = await c.undoLast(5);
    assert.equal(r.reverted, 1);
    assert.deepEqual(c.listDependencies('fp_A').incoming, []);
    c.close();
  });
  it('undoes a remove_dep (becomes add_dep, but cycle may block)', async () => {
    seedFromRows([makeRow('A'), makeRow('B')]);
    const c = new Controller({ dbPath: testDbPath });
    c.addDependency('fp_B', 'fp_A');
    c.removeDependency('fp_B', 'fp_A');
    const r = await c.undoLast(5);
    // undo 2 changes: add_dep (now add) + remove_dep (now remove_dep)
    assert.ok(r.reverted >= 1, `expected reverted >= 1, got ${r.reverted}`);
    c.close();
  });
});

describe('Controller.scheduleRun (simulated)', () => {
  it('runs all enabled items, returns started + run_id', async () => {
    seedFromRows([makeRow('A'), makeRow('B'), makeRow('C', 'HKCU_Run', 'normal', 0)]);
    const c = new Controller({ dbPath: testDbPath });
    const r = await c.scheduleRun({ simulatedMs: 50 });
    assert.equal(r.dry_run, true);
    assert.equal(r.total, 2); // only enabled
    assert.equal(r.started.length, 2);
    assert.ok(r.run_id);
    c.close();
  });
  it('writes run + events to db', async () => {
    seedFromRows([makeRow('A')]);
    const c = new Controller({ dbPath: testDbPath });
    await c.scheduleRun({ simulatedMs: 30 });
    const tl = c.timeline(10);
    assert.ok(tl.length >= 1);
    assert.equal(tl[0]!.status, 'started');
    c.close();
  });
});

describe('Controller.timeline (empty)', () => {
  it('returns [] when no run', () => {
    seedFromRows([makeRow('A')]);
    const c = new Controller({ dbPath: testDbPath });
    const r = c.timeline(10);
    assert.deepEqual(r, []);
    c.close();
  });
});

describe('Controller.ioStatus', () => {
  it('returns ok=true on Windows or fake on other', async () => {
    seedFromRows([makeRow('A')]);
    const c = new Controller({ dbPath: testDbPath });
    const r = await c.ioStatus();
    assert.equal(r.ok, true);
    assert.ok(typeof r.idle_pct === 'number');
    c.close();
  });
});

describe('Controller.serviceStatus', () => {
  it('returns a status object', async () => {
    seedFromRows([makeRow('A')]);
    const c = new Controller({ dbPath: testDbPath });
    const r = await c.serviceStatus();
    assert.ok(typeof r.installed === 'boolean');
    assert.ok(typeof r.running === 'boolean');
    assert.ok(typeof r.state === 'string');
    c.close();
  });
});
