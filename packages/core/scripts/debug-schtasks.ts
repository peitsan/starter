import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseCsvLine, isStartupTrigger } from '../src/scanner/schtasks.js';

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const { stdout } = await execFileAsync('schtasks.exe', ['/query', '/v', '/fo', 'CSV', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  console.log('total lines:', lines.length);
  // 第一行字段数 + 抽样检查
  const first = lines[0] ?? '';
  const f = parseCsvLine(first);
  console.log('first line fields:', f.length);
  console.log('raw first 200:', JSON.stringify(first.slice(0, 200)));
  console.log('field[1] (taskname):', JSON.stringify(f[1]));
  console.log('field[18] (schedule):', JSON.stringify(f[18]));
  console.log('field[11] (state):', JSON.stringify(f[11]));
  // 统计 schedule type 分布
  const types = new Map<string, number>();
  for (const line of lines) {
    const ff = parseCsvLine(line);
    const t = ff[18] ?? '';
    types.set(t, (types.get(t) ?? 0) + 1);
  }
  console.log('schedule type distribution:');
  for (const [k, v] of types) console.log(`  ${JSON.stringify(k)}: ${v}`);
  // 检查 isStartupTrigger
  for (const t of [...types.keys()].slice(0, 20)) {
    if (isStartupTrigger(t)) console.log('  STARTUP-TRIGGER:', JSON.stringify(t));
  }
}
void main();
