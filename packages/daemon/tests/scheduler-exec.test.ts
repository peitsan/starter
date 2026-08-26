import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseCommand, priorityFlag, commandExists, spawnItem } from '../src/scheduler-exec.js';
import type { StartupItemRow } from '@starter/core';

const baseItem = (overrides: Partial<StartupItemRow> = {}): StartupItemRow => ({
  id: 'fp_test',
  name: 'test',
  command: 'notepad.exe',
  source: 'HKCU_Run',
  source_path: 'HKCU\\...\\Run\\test',
  enabled: 1,
  delay_ms: 0,
  priority: 2,
  risk: 'normal',
  vendor: null,
  updated_at: 0,
  ...overrides,
});

describe('parseCommand', () => {
  it('splits simple command', () => {
    const r = parseCommand('notepad.exe');
    assert.equal(r.file, 'notepad.exe');
    assert.deepEqual(r.args, []);
  });
  it('splits with args', () => {
    const r = parseCommand('notepad.exe foo.txt');
    assert.equal(r.file, 'notepad.exe');
    assert.deepEqual(r.args, ['foo.txt']);
  });
  it('handles quoted path with spaces', () => {
    const r = parseCommand('"C:\\Program Files\\Notepad++\\notepad++.exe" --help');
    assert.equal(r.file, 'C:\\Program Files\\Notepad++\\notepad++.exe');
    assert.deepEqual(r.args, ['--help']);
  });
  it('handles quoted path without trailing args', () => {
    const r = parseCommand('"C:\\App\\app.exe"');
    assert.equal(r.file, 'C:\\App\\app.exe');
    assert.deepEqual(r.args, []);
  });
  it('returns empty for empty string', () => {
    const r = parseCommand('');
    assert.equal(r.file, '');
    assert.deepEqual(r.args, []);
  });
});

describe('priorityFlag', () => {
  it('maps priority 0..5', () => {
    if (process.platform === 'win32') {
      assert.equal(priorityFlag(0), '/LOW');
      assert.equal(priorityFlag(1), '/BELOWNORMAL');
      assert.equal(priorityFlag(2), '/NORMAL');
      assert.equal(priorityFlag(3), '/ABOVENORMAL');
      assert.equal(priorityFlag(4), '/HIGH');
      assert.equal(priorityFlag(5), '/REALTIME');
    } else {
      assert.equal(priorityFlag(0), null);
    }
  });
  it('falls back to NORMAL for unknown priority on win', () => {
    if (process.platform === 'win32') {
      assert.equal(priorityFlag(99), '/NORMAL');
    }
  });
});

describe('commandExists', () => {
  it('finds notepad on windows', () => {
    if (process.platform === 'win32') {
      assert.equal(commandExists('notepad.exe'), true);
    } else {
      assert.equal(commandExists('sh'), true);
    }
  });
  it('rejects nonexistent', () => {
    assert.equal(commandExists('definitely-not-a-real-binary-xyz-9999'), false);
  });
});

describe('spawnItem', () => {
  it('returns pid for valid command', () => {
    const item = baseItem({ command: process.platform === 'win32' ? 'notepad.exe' : 'sh' });
    const r = spawnItem(item);
    assert.ok(r.pid > 0);
    assert.equal(r.priority, 2);
  });
  it('throws for nonexistent command', () => {
    const item = baseItem({ command: 'definitely-not-a-real-binary-xyz-9999.exe' });
    assert.throws(() => spawnItem(item), /not found/);
  });
  it('uses item priority', () => {
    const item = baseItem({
      command: process.platform === 'win32' ? 'notepad.exe' : 'sh',
      priority: 4,
    });
    const r = spawnItem(item);
    assert.equal(r.priority, 4);
  });
});
