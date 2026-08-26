/**
 * 新 Repository 测试
 * - DependencyRepository: add/remove/list/cycle detect
 * - OpLogRepository: write/list/undoable
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, closeDb } from '../src/store/db.js';
import { applySchema } from '../src/store/schema.js';
import { ItemRepository } from '../src/store/items.js';
import { DependencyRepository } from '../src/store/dependencies.js';
import { OpLogRepository } from '../src/store/op-log.js';

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'starter-store-'));
  const db = openDb({ path: join(dir, 'test.db') });
  applySchema(db);
  const items = new ItemRepository(db);
  // 注入 3 个 item
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
      vendor: 'x',
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
      vendor: 'x',
      enabled: true,
    },
    {
      fingerprint: 'c',
      name: 'C',
      command: 'c.exe',
      exe: 'c.exe',
      args: [],
      source: 'HKCU_Run',
      source_path: 'HKCU\\...\\Run',
      risk: 'normal',
      vendor: 'x',
      enabled: true,
    },
  ]);
  return {
    db,
    dir,
    items,
    deps: new DependencyRepository(db),
    opLog: new OpLogRepository(db),
    cleanup: () => {
      closeDb(db);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('DependencyRepository.add + listFor', () => {
  const ctx = freshDb();
  try {
    const r1 = ctx.deps.add('b', 'a'); // b 依赖 a
    assert.deepEqual(r1, { ok: true });
    const r2 = ctx.deps.add('c', 'a'); // c 依赖 a
    assert.deepEqual(r2, { ok: true });
    const info = ctx.deps.listFor('a');
    assert.deepEqual(info.outgoing, []);
    assert.deepEqual(info.incoming.sort(), ['b', 'c']);
    const infoB = ctx.deps.listFor('b');
    assert.deepEqual(infoB.outgoing, ['a']);
    assert.deepEqual(infoB.incoming, []);
  } finally {
    ctx.cleanup();
  }
});

test('DependencyRepository.add rejects self-dependency', () => {
  const ctx = freshDb();
  try {
    const r = ctx.deps.add('a', 'a');
    assert.deepEqual(r, { ok: false, reason: 'self_dependency' });
  } finally {
    ctx.cleanup();
  }
});

test('DependencyRepository.add rejects direct cycle', () => {
  const ctx = freshDb();
  try {
    ctx.deps.add('b', 'a');
    const r = ctx.deps.add('a', 'b');
    assert.deepEqual(r, { ok: false, reason: 'cycle_detected' });
  } finally {
    ctx.cleanup();
  }
});

test('DependencyRepository.add rejects indirect cycle', () => {
  const ctx = freshDb();
  try {
    ctx.deps.add('c', 'b');
    ctx.deps.add('b', 'a');
    const r = ctx.deps.add('a', 'c'); // a -> c -> b -> a
    assert.deepEqual(r, { ok: false, reason: 'cycle_detected' });
  } finally {
    ctx.cleanup();
  }
});

test('DependencyRepository.add rejects duplicate', () => {
  const ctx = freshDb();
  try {
    ctx.deps.add('b', 'a');
    const r = ctx.deps.add('b', 'a');
    assert.deepEqual(r, { ok: false, reason: 'duplicate' });
  } finally {
    ctx.cleanup();
  }
});

test('DependencyRepository.remove', () => {
  const ctx = freshDb();
  try {
    ctx.deps.add('b', 'a');
    const ok1 = ctx.deps.remove('b', 'a');
    assert.equal(ok1, true);
    const ok2 = ctx.deps.remove('b', 'a'); // already gone
    assert.equal(ok2, false);
  } finally {
    ctx.cleanup();
  }
});

test('OpLogRepository.write + list', () => {
  const ctx = freshDb();
  try {
    const id1 = ctx.opLog.write({
      actor: 'mcp',
      action: 'disable',
      target: 'a',
      args: { prev: 1 },
      result: 'ok',
    });
    const id2 = ctx.opLog.write({
      actor: 'mcp',
      action: 'set_delay',
      target: 'b',
      args: { prev: 0, next: 5000 },
      result: 'ok',
    });
    assert.ok(id1 > 0 && id2 > id1);
    const rows = ctx.opLog.list(10);
    assert.equal(rows.length, 2);
    // list 是按 id DESC
    assert.equal(rows[0]!.action, 'set_delay');
    assert.equal(rows[1]!.action, 'disable');
  } finally {
    ctx.cleanup();
  }
});

test('OpLogRepository.listUndoable filters non-ok and unknown actions', () => {
  const ctx = freshDb();
  try {
    ctx.opLog.write({ actor: 'mcp', action: 'disable', target: 'a', result: 'ok' });
    ctx.opLog.write({ actor: 'mcp', action: 'disable', target: 'a', result: 'forbidden' }); // skip
    ctx.opLog.write({ actor: 'mcp', action: 'schedule_run', target: null, result: 'ok' }); // non-undoable
    ctx.opLog.write({ actor: 'mcp', action: 'set_priority', target: 'b', result: 'ok' });
    const u = ctx.opLog.listUndoable(10);
    assert.equal(u.length, 2);
    const actions = u.map((r) => r.action);
    assert.ok(actions.includes('disable'));
    assert.ok(actions.includes('set_priority'));
  } finally {
    ctx.cleanup();
  }
});
