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

test('new item default priority is 2 (Normal, RFC-001 §4.5)', () => {
  const ctx = freshDb();
  try {
    const row = ctx.items.get('a');
    assert.ok(row, 'item a should exist');
    // 默认值 3→2：所有新增启动项默认 Normal，不再被 daemon 起成 ABOVENORMAL
    assert.equal(row!.priority, 2);
  } finally {
    ctx.cleanup();
  }
});

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

// ---------- transfer: export / import (RFC-001 §4.9) ----------

import { exportSnapshot, importSnapshot } from '../src/store/transfer.js';

test('transfer.exportSnapshot round-trips items+deps+config', () => {
  const ctx = freshDb();
  try {
    const payload = exportSnapshot(ctx.db);
    assert.equal(payload.schema_version, 'v1');
    assert.ok(Array.isArray(payload.items));
    assert.ok(Array.isArray(payload.dependencies));
    assert.ok(payload.config && typeof payload.config === 'object');
    // freshDb 注入了 a/b/c
    const ids = payload.items.map((i) => i.fingerprint);
    assert.ok(ids.includes('a') && ids.includes('b') && ids.includes('c'));
  } finally {
    ctx.cleanup();
  }
});

test('transfer.importSnapshot merge adds new item and keeps others', () => {
  const ctx = freshDb();
  try {
    const payload = exportSnapshot(ctx.db);
    // 加入一个全新 item
    payload.items.push({ fingerprint: 'new1', enabled: true, delay_ms: 0, priority: 2 });
    const report = importSnapshot(ctx.db, JSON.stringify(payload), 'merge');
    assert.equal(report.ok, true);
    assert.equal(report.items_inserted, 1);
    const row = ctx.items.get('new1');
    assert.ok(row, 'new1 should exist');
  } finally {
    ctx.cleanup();
  }
});

test('transfer.importSnapshot append does not overwrite existing', () => {
  const ctx = freshDb();
  try {
    // 先把 a 改成 enabled=false
    ctx.db.prepare('UPDATE startup_item SET enabled=0 WHERE id=?').run('a');
    const payload = exportSnapshot(ctx.db);
    // append 模式：new1 插入，a 保持 disabled（不覆盖）
    payload.items.push({ fingerprint: 'new1', enabled: true, delay_ms: 0, priority: 2 });
    const report = importSnapshot(ctx.db, JSON.stringify(payload), 'append');
    assert.equal(report.ok, true);
    assert.equal(report.items_inserted, 1); // 只有 new1
    const a = ctx.items.get('a');
    assert.equal(a!.enabled, 0, 'append must not overwrite existing item');
    const n = ctx.items.get('new1');
    assert.ok(n, 'new1 should be inserted');
  } finally {
    ctx.cleanup();
  }
});

test('transfer.importSnapshot rejects bad schema_version', () => {
  const ctx = freshDb();
  try {
    const payload = exportSnapshot(ctx.db);
    payload.schema_version = 'v99';
    assert.throws(() => importSnapshot(ctx.db, JSON.stringify(payload), 'merge'), /unsupported/);
  } finally {
    ctx.cleanup();
  }
});
