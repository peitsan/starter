import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  openDb,
  closeDb,
  ItemRepository,
  ConfigRepository,
  type ScannedItem,
} from '../src/index.js';
import type { Database } from 'better-sqlite3';

let db: Database;
beforeEach(() => {
  db = openDb({ path: ':memory:' });
});

function makeScan(name: string, source: ScannedItem['source'] = 'HKCU_Run'): ScannedItem {
  return {
    fingerprint: `fp_${name}`,
    name,
    command: `C:\\app\\${name}.exe`,
    exe: `C:\\app\\${name}.exe`,
    args: [],
    source,
    source_path: `HKCU\\Software\\...\\Run`,
    enabled: true,
    risk: 'normal',
    vendor: 'ACME',
    scanned_at: Date.now(),
  };
}

describe('ItemRepository.upsertFromScan', () => {
  it('inserts new items, updates existing (preserves delay/priority/enabled)', () => {
    const repo = new ItemRepository(db);
    const r1 = repo.upsertFromScan([makeScan('A')]);
    assert.deepEqual(r1, { inserted: 1, updated: 0 });
    // user sets delay
    assert.equal(repo.setDelay('fp_A', 5000, 'test'), true);
    assert.equal(repo.setPriority('fp_A', 1, 'test'), true);
    assert.equal(repo.setEnabled('fp_A', false, 'test'), true);

    // re-scan
    const r2 = repo.upsertFromScan([makeScan('A')]);
    assert.deepEqual(r2, { inserted: 0, updated: 1 });
    const row = repo.get('fp_A')!;
    assert.equal(row.delay_ms, 5000);
    assert.equal(row.priority, 1);
    assert.equal(row.enabled, 0);
  });
});

describe('ItemRepository.list', () => {
  it('filters by source, enabled, search', () => {
    const repo = new ItemRepository(db);
    repo.upsertFromScan([
      makeScan('A', 'HKCU_Run'),
      makeScan('B', 'HKLM_Run'),
      makeScan('CC', 'HKCU_Run'),
    ]);
    repo.setEnabled('fp_B', false, 'test');

    assert.equal(repo.list().length, 3);
    assert.equal(repo.list({ source: 'HKCU_Run' }).length, 2);
    assert.equal(repo.list({ enabled: true }).length, 2);
    assert.equal(repo.list({ search: 'CC' }).length, 1);
  });
});

describe('ItemRepository.setEnabled / setDelay / setPriority', () => {
  it('rejects out-of-range', () => {
    const repo = new ItemRepository(db);
    repo.upsertFromScan([makeScan('A')]);
    assert.throws(() => repo.setDelay('fp_A', -1, 't'), /out of range/);
    assert.throws(() => repo.setDelay('fp_A', 1e9, 't'), /out of range/);
    assert.throws(() => repo.setPriority('fp_A', 9, 't'), /out of range/);
  });
  it('returns false for missing id', () => {
    const repo = new ItemRepository(db);
    assert.equal(repo.setEnabled('nope', true, 't'), false);
    assert.equal(repo.setDelay('nope', 0, 't'), false);
  });
  it('writes op_log entries', () => {
    const repo = new ItemRepository(db);
    repo.upsertFromScan([makeScan('A')]);
    repo.setEnabled('fp_A', false, 'cli');
    repo.setDelay('fp_A', 1234, 'mcp');
    const logs = db
      .prepare<[], { action: string; actor: string }>(
        "SELECT action, actor FROM op_log WHERE target = 'fp_A' ORDER BY id",
      )
      .all();
    assert.equal(logs.length, 2);
    assert.equal(logs[0]?.action, 'disable');
    assert.equal(logs[0]?.actor, 'cli');
    assert.equal(logs[1]?.action, 'set_delay');
    assert.equal(logs[1]?.actor, 'mcp');
  });
});

describe('ItemRepository dependencies', () => {
  it('adds a dep, returns false on dup', () => {
    const repo = new ItemRepository(db);
    repo.upsertFromScan([makeScan('A'), makeScan('B')]);
    assert.equal(repo.addDependency('fp_A', 'fp_B', 'test'), true);
    assert.equal(repo.addDependency('fp_A', 'fp_B', 'test'), false);
    assert.deepEqual(repo.listDependencies('fp_A'), ['fp_B']);
  });
  it('rejects self dep', () => {
    const repo = new ItemRepository(db);
    repo.upsertFromScan([makeScan('A')]);
    assert.throws(() => repo.addDependency('fp_A', 'fp_A', 't'), /self/);
  });
  it('rejects cycle: A->B, B->A', () => {
    const repo = new ItemRepository(db);
    repo.upsertFromScan([makeScan('A'), makeScan('B')]);
    assert.equal(repo.addDependency('fp_A', 'fp_B', 't'), true);
    assert.throws(() => repo.addDependency('fp_B', 'fp_A', 't'), /cycle/);
  });
  it('rejects cycle: A->B->C, C->A', () => {
    const repo = new ItemRepository(db);
    repo.upsertFromScan([makeScan('A'), makeScan('B'), makeScan('C')]);
    repo.addDependency('fp_A', 'fp_B', 't');
    repo.addDependency('fp_B', 'fp_C', 't');
    assert.throws(() => repo.addDependency('fp_C', 'fp_A', 't'), /cycle/);
  });
  it('removes dep', () => {
    const repo = new ItemRepository(db);
    repo.upsertFromScan([makeScan('A'), makeScan('B')]);
    repo.addDependency('fp_A', 'fp_B', 't');
    assert.equal(repo.removeDependency('fp_A', 'fp_B', 't'), true);
    assert.equal(repo.removeDependency('fp_A', 'fp_B', 't'), false);
  });
});

describe('ConfigRepository', () => {
  it('returns defaults', () => {
    const c = new ConfigRepository(db);
    assert.equal(c.get('concurrent_max'), '4');
    assert.equal(c.get('auto_start'), 'false');
    assert.equal(c.asNumber('concurrent_max'), 4);
    assert.equal(c.asBool('auto_start'), false);
  });
  it('sets & logs', () => {
    const c = new ConfigRepository(db);
    c.set('concurrent_max', '8', 'cli');
    assert.equal(c.get('concurrent_max'), '8');
    assert.equal(c.asNumber('concurrent_max'), 8);
  });
});

describe('openDb / closeDb', () => {
  it('round-trip', () => {
    const d = openDb({ path: ':memory:' });
    d.exec('CREATE TABLE t(x INTEGER)');
    d.prepare('INSERT INTO t VALUES (1)').run();
    const r = d.prepare<[], { x: number }>('SELECT * FROM t').get() as { x: number };
    assert.equal(r.x, 1);
    closeDb(d);
  });
});
