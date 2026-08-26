import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { formatItemRow, formatItemTable, formatItemDetail, formatDoctor } from '../src/format.js';
import type { StartupItemRow, DoctorReport } from '@starter/core';

function makeRow(over: Partial<StartupItemRow> = {}): StartupItemRow {
  return {
    id: 'fp_X',
    name: 'X',
    command: 'C:\\X.exe',
    source: 'HKCU_Run',
    source_path: 'HKCU\\Software\\...\\Run',
    enabled: 1,
    delay_ms: 0,
    priority: 3,
    risk: 'normal',
    vendor: null,
    updated_at: 0,
    ...over,
  };
}

describe('formatItemRow', () => {
  it('shows ON and command', () => {
    const s = formatItemRow(
      makeRow({ name: 'OneDrive', command: 'C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe' }),
    );
    assert.match(s, /ON /);
    assert.match(s, /OneDrive/);
    assert.match(s, /risk=normal/);
  });
  it('shows off for disabled', () => {
    const s = formatItemRow(makeRow({ enabled: 0 }));
    assert.match(s, /^off /);
  });
  it('formats delay in seconds', () => {
    const s = formatItemRow(makeRow({ delay_ms: 5000 }));
    assert.match(s, /delay=5\.0s/);
  });
  it('shows - for zero delay', () => {
    const s = formatItemRow(makeRow({ delay_ms: 0 }));
    assert.match(s, /delay=-/);
  });
});

describe('formatItemTable', () => {
  it('handles empty', () => {
    assert.equal(formatItemTable([]), '(no items)');
  });
  it('joins multiple rows', () => {
    const s = formatItemTable([makeRow({ id: 'a', name: 'A' }), makeRow({ id: 'b', name: 'B' })]);
    assert.match(s, /\n/);
  });
});

describe('formatItemDetail', () => {
  it('shows all fields', () => {
    const s = formatItemDetail(makeRow({ name: 'A', command: 'cmd' }));
    assert.match(s, /id:\s+fp_X/);
    assert.match(s, /name:\s+A/);
    assert.match(s, /command:\s+cmd/);
  });
});

describe('formatDoctor', () => {
  it('formats config', () => {
    const d: DoctorReport = {
      ok: true,
      platform: 'win32',
      dbPath: 'X:\\db',
      itemCount: 5,
      enabledCount: 3,
      config: {
        concurrent_max: 4,
        io_busy_threshold_pct: 80,
        io_queue_threshold: 2,
        io_idle_confirm_ms: 3000,
        auto_start: false,
      },
    };
    const s = formatDoctor(d);
    assert.match(s, /platform:\s+win32/);
    assert.match(s, /items:\s+5/);
    assert.match(s, /concurrent_max:\s+4/);
  });
});
