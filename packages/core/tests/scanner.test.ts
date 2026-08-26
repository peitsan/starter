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

// ---------- 计划任务（schtasks）扫描 ----------

import {
  parseCsvLine,
  isStartupTrigger,
  classifyTaskRisk,
  isTaskEnabled,
  scanTaskScheduler,
} from '../src/index.js';

describe('parseCsvLine', () => {
  it('splits plain comma fields', () => {
    assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  });
  it('handles quoted field containing comma', () => {
    assert.deepEqual(parseCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
  });
  it('handles doubled quotes inside quoted field', () => {
    assert.deepEqual(parseCsvLine('"he said ""hi""",x'), ['he said "hi"', 'x']);
  });
  it('handles empty fields', () => {
    assert.deepEqual(parseCsvLine('a,,c,'), ['a', '', 'c', '']);
  });
});

describe('isStartupTrigger', () => {
  it('accepts logon / system startup / idle (English)', () => {
    assert.equal(isStartupTrigger('At logon'), true);
    assert.equal(isStartupTrigger('At system startup'), true);
    assert.equal(isStartupTrigger('At idle'), true);
    assert.equal(isStartupTrigger('On idle'), true);
  });
  it('accepts Chinese schedule types (GBK-decoded)', () => {
    assert.equal(isStartupTrigger('登录时'), true);
    assert.equal(isStartupTrigger('系统启动时'), true);
    assert.equal(isStartupTrigger('空闲时'), true);
  });
  it('rejects daily / weekly / one-time', () => {
    assert.equal(isStartupTrigger('Daily'), false);
    assert.equal(isStartupTrigger('每周'), false);
    assert.equal(isStartupTrigger('One time only'), false);
    assert.equal(isStartupTrigger(''), false);
  });
});

describe('isTaskEnabled', () => {
  it('accepts English and Chinese enabled states', () => {
    assert.equal(isTaskEnabled('Enabled'), true);
    assert.equal(isTaskEnabled('已启用'), true);
    assert.equal(isTaskEnabled('Ready'), true);
  });
  it('rejects disabled states', () => {
    assert.equal(isTaskEnabled('Disabled'), false);
    assert.equal(isTaskEnabled('已禁用'), false);
    assert.equal(isTaskEnabled(''), false);
  });
});

describe('classifyTaskRisk', () => {
  it('marks Microsoft\\Windows\\... tasks as critical (system)', () => {
    assert.equal(
      classifyTaskRisk('\\Microsoft\\Windows\\\\.NET Framework\\NGEN task', ''),
      'critical',
    );
  });
  it('marks %windir% / system32 commands as critical', () => {
    assert.equal(classifyTaskRisk('X', '%windir%\\system32\\something.exe'), 'critical');
    assert.equal(classifyTaskRisk('X', 'C:\\Windows\\System32\\foo.exe'), 'critical');
  });
  it('marks Program Files / AppData commands as normal', () => {
    assert.equal(
      classifyTaskRisk('AppUpdater', 'C:\\Program Files\\App\\app.exe --update'),
      'normal',
    );
    assert.equal(classifyTaskRisk('X', 'C:\\Users\\me\\AppData\\Local\\X\\x.exe'), 'normal');
  });
  it('marks unknown as recommend_off', () => {
    assert.equal(classifyTaskRisk('Mystery', 'C:\\Temp\\run.ps1'), 'recommend_off');
  });
});

describe('scanTaskScheduler (real schtasks.exe, gated by env)', () => {
  it('returns startup-triggered tasks when STARTER_RUN_SCHTASKS=1', async () => {
    if (process.env.STARTER_RUN_SCHTASKS !== '1') {
      return; // opt-in: 手动 Windows 冒烟
    }
    if (process.platform !== 'win32') return;
    const items = await scanTaskScheduler();
    assert.ok(Array.isArray(items));
    for (const it of items) {
      assert.equal(it.source, 'TaskScheduler');
      assert.ok(typeof it.name === 'string' && it.name.length > 0);
    }
  });
});
