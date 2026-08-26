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
): StartupItemRow {
  return {
    id: `fp_${name}`,
    name,
    command: `C:\\app\\${name}.exe`,
    source,
    source_path: source === 'HKCU_Run' ? 'HKCU\\Software\\...\\Run' : 'HKLM\\Software\\...\\Run',
    enabled: 1,
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
