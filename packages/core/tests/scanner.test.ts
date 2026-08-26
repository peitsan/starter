import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseCommand, fingerprint, parseRegQuery, type ScannedItem } from '../src/index.js';

describe('parseCommand', () => {
  it('splits simple exe + args', () => {
    const r = parseCommand('C:\\Windows\\notepad.exe foo.txt');
    assert.equal(r.exe, 'C:\\Windows\\notepad.exe');
    assert.deepEqual(r.args, ['foo.txt']);
  });

  it('handles quoted exe path with spaces', () => {
    const r = parseCommand('"C:\\Program Files\\App\\app.exe" --flag value');
    assert.equal(r.exe, 'C:\\Program Files\\App\\app.exe');
    assert.deepEqual(r.args, ['--flag', 'value']);
  });

  it('handles doubled quote inside quoted string (Windows CMD convention)', () => {
    //  Windows CMD-style: inside a quoted string, "" is a literal "
    const r = parseCommand('"a""b" c');
    assert.equal(r.exe, 'a"b');
    assert.deepEqual(r.args, ['c']);
  });

  it('returns null exe for empty input', () => {
    assert.deepEqual(parseCommand(''), { exe: null, args: [] });
    assert.deepEqual(parseCommand('   '), { exe: null, args: [] });
  });

  it('parses real OneDrive command line', () => {
    const r = parseCommand('"C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background');
    assert.equal(r.exe, 'C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe');
    assert.deepEqual(r.args, ['/background']);
  });
});

describe('fingerprint', () => {
  it('is deterministic', () => {
    const a = fingerprint({ source: 'HKCU_Run', source_path: 'p', name: 'X' });
    const b = fingerprint({ source: 'HKCU_Run', source_path: 'p', name: 'X' });
    assert.equal(a, b);
  });
  it('differs when name changes', () => {
    const a = fingerprint({ source: 'HKCU_Run', source_path: 'p', name: 'X' });
    const b = fingerprint({ source: 'HKCU_Run', source_path: 'p', name: 'Y' });
    assert.notEqual(a, b);
  });
});

describe('parseRegQuery', () => {
  it('parses standard reg.exe output', () => {
    const stdout = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '    OneDrive    REG_SZ    "C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe" /background',
      '    Discord    REG_SZ    C:\\Users\\me\\AppData\\Local\\Discord\\Update.exe --processStart=Discord.exe',
      '',
    ].join('\r\n');
    const items: ScannedItem[] = parseRegQuery(stdout, 'HKCU_Run', 'HKCU\\Software\\...\\Run');
    assert.equal(items.length, 2);
    const [one, two] = items;
    assert.equal(one?.name, 'OneDrive');
    assert.equal(one?.exe, 'C:\\Program Files\\Microsoft OneDrive\\OneDrive.exe');
    assert.deepEqual(one?.args, ['/background']);
    assert.equal(two?.exe, 'C:\\Users\\me\\AppData\\Local\\Discord\\Update.exe');
    assert.deepEqual(two?.args, ['--processStart=Discord.exe']);
  });

  it('skips empty values', () => {
    const stdout = [
      'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
      '    Empty    REG_SZ    ',
      '    Real    REG_SZ    notepad.exe',
    ].join('\r\n');
    const items = parseRegQuery(stdout, 'HKCU_Run', 'HKCU\\Run');
    assert.equal(items.length, 1);
    assert.equal(items[0]?.name, 'Real');
  });

  it('skips REG_DWORD / REG_BINARY (not REG_SZ-like)', () => {
    const stdout = [
      '    Dword    REG_DWORD    0x1',
      '    Bin      REG_BINARY    0102',
      '    Str      REG_SZ    calc.exe',
    ].join('\r\n');
    const items = parseRegQuery(stdout, 'HKCU_Run', 'HKCU\\Run');
    assert.equal(items.length, 1);
    assert.equal(items[0]?.name, 'Str');
  });
});

describe('WindowsScanner (real reg.exe, gated by env)', () => {
  it('runs on Windows when STARTER_RUN_REG_SCAN=1', async () => {
    if (process.env.STARTER_RUN_REG_SCAN !== '1') {
      return; // skip on default CI; opt-in for manual Windows smoke
    }
    if (process.platform !== 'win32') return;
    const { WindowsScanner } = await import('../src/index.js');
    const items = await new WindowsScanner().scan();
    assert.ok(Array.isArray(items));
    // 不强制数量，但至少能找到几个常见项
  });
});
