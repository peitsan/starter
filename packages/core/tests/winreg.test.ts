import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { ElevationRequiredError, parseSource } from '../src/index.js';

describe('ElevationRequiredError', () => {
  it('has stable code', () => {
    const e = new ElevationRequiredError();
    assert.equal(e.code, 'E_ELEVATION_REQUIRED');
    assert.equal(e.name, 'ElevationRequiredError');
  });
});

describe('parseSource', () => {
  it('parses HKCU_Run', () => {
    const r = parseSource('HKCU_Run', '');
    assert.deepEqual(r, { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run' });
  });
  it('parses HKLM_Run', () => {
    const r = parseSource('HKLM_Run', '');
    assert.deepEqual(r, { hive: 'HKLM', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run' });
  });
  it('falls back to sourcePath', () => {
    const r = parseSource('unknown', 'HKCU\\Software\\Custom\\App');
    assert.deepEqual(r, { hive: 'HKCU', key: 'Software\\Custom\\App' });
  });
  it('returns null for unknown', () => {
    assert.equal(parseSource('StartupFolder', 'C:\\path'), null);
  });
});
