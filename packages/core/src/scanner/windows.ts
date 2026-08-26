/**
 * Windows 启动项扫描器
 *
 * 实现：用 `reg.exe query` 读注册表 Run / RunOnce 键；
 *       用 `fs.readdir` 读启动文件夹；MVP 暂不实现计划任务和服务。
 *
 * 之所以走 reg.exe 而不是 ffi-napi / regodit 之类：
 *  - 零原生依赖；pnpm 装包即用
 *  - reg.exe 自带于 Windows，无需额外安装
 *  - 输出格式稳定（REG_SZ / REG_BINARY / REG_DWORD 等）
 *  - 行为与"在 cmd 里手动 reg query"完全一致，方便调试
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ScanOptions, Scanner, ScannedItem, Source } from './types.js';
import { fingerprint, parseCommand } from './command.js';

const execFileAsync = promisify(execFile);

interface RegQueryResult {
  stdout: string;
  stderr: string;
}

/** 注册表路径到 Source 的映射 */
const REG_KEYS: ReadonlyArray<{ hive: string; key: string; source: Source }> = [
  { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', source: 'HKCU_Run' },
  { hive: 'HKLM', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Run', source: 'HKLM_Run' },
  {
    hive: 'HKCU',
    key: 'Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
    source: 'HKCU_RunOnce',
  },
  {
    hive: 'HKLM',
    key: 'Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
    source: 'HKLM_RunOnce',
  },
];

/** 已知的系统关键厂商路径（粗粒度） */
function classifyRisk(name: string, exe: string | null): 'critical' | 'normal' | 'recommend_off' {
  const n = name.toLowerCase();
  const x = (exe ?? '').toLowerCase();
  if (n === 'securityhealth' || x.includes('securityhealth')) return 'critical';
  if (n === 'windowsdefender' || x.includes('windowsdefender')) return 'critical';
  if (n === 'onedrive' && x.includes('microsoft')) return 'normal';
  return 'recommend_off';
}

export class WindowsScanner implements Scanner {
  readonly platform = 'win32';

  async scan(opts: ScanOptions = {}): Promise<ScannedItem[]> {
    const wantAll = !opts.sources || opts.sources.length === 0;
    const include = (s: Source) => wantAll || (opts.sources ?? []).includes(s);
    const skipCritical = opts.skipCritical ?? true;

    const results: ScannedItem[] = [];
    const tasks: Array<Promise<void>> = [];

    for (const { hive, key, source } of REG_KEYS) {
      if (!include(source)) continue;
      tasks.push(
        this.scanRegKey(hive, key, source)
          .then((items) => {
            for (const it of items) {
              if (skipCritical && it.risk === 'critical') continue;
              results.push(it);
            }
          })
          .catch(() => {
            /* 读不到（无权限 / 键不存在）就跳过 */
          }),
      );
    }

    if (include('StartupFolder')) {
      tasks.push(
        this.scanStartupFolder('user').then((items) => {
          results.push(...items);
        }),
      );
    }
    if (include('CommonStartupFolder')) {
      tasks.push(
        this.scanStartupFolder('common').then((items) => {
          results.push(...items);
        }),
      );
    }

    await Promise.all(tasks);
    return results;
  }

  private async scanRegKey(hive: string, key: string, source: Source): Promise<ScannedItem[]> {
    const { stdout } = await this.runReg(['query', `${hive}\\${key}`]);
    return parseRegQuery(stdout, source, `${hive}\\${key}`);
  }

  private async runReg(args: string[]): Promise<RegQueryResult> {
    // 注意：key 内可能含空格（虽然常见 key 不会），但 reg.exe 对引号处理很挑剔
    // 这里 key 不带空格，所以直接传
    return execFileAsync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
  }

  private async scanStartupFolder(kind: 'user' | 'common'): Promise<ScannedItem[]> {
    const path =
      kind === 'user'
        ? join(
            process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'),
            'Microsoft\\Windows\\Start Menu\\Programs\\Startup',
          )
        : join(
            process.env.PROGRAMDATA ?? join(homedir(), 'AppData', 'Roaming'),
            'Microsoft\\Windows\\Start Menu\\Programs\\Startup',
          );
    let entries: string[];
    try {
      entries = await fs.readdir(path);
    } catch {
      return [];
    }
    const now = Date.now();
    return entries
      .filter((e) => /\.(lnk|bat|cmd|exe|vbs|js|jar)$/i.test(e))
      .map((name) => {
        const cmd = `${path}\\${name}`;
        const parsed = parseCommand(cmd);
        return {
          fingerprint: fingerprint({
            source: kind === 'user' ? 'StartupFolder' : 'CommonStartupFolder',
            source_path: path,
            name,
          }),
          name: name.replace(/\.[^.]+$/, ''),
          command: cmd,
          exe: parsed.exe,
          args: parsed.args,
          source: kind === 'user' ? 'StartupFolder' : 'CommonStartupFolder',
          source_path: path,
          enabled: true,
          risk: classifyRisk(name, parsed.exe),
          vendor: null,
          scanned_at: now,
        };
      });
  }
}

/**
 * 解析 reg.exe query 输出：
 *
 *   HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
 *       OneDrive    REG_SZ    "C:\Program Files\Microsoft OneDrive\OneDrive.exe" /background
 *       Discord    REG_SZ    C:\Users\me\AppData\Local\Discord\Update.exe --processStart=Discord.exe
 */
export function parseRegQuery(stdout: string, source: Source, sourcePath: string): ScannedItem[] {
  const items: ScannedItem[] = [];
  const lines = stdout.split(/\r?\n/);
  const now = Date.now();
  // 匹配: "    ValueName    REG_SZ    Data"
  const re = /^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ|MULTI_SZ)\s+(.*)$/;
  for (const line of lines) {
    const m = re.exec(line);
    if (!m) continue;
    const name = m[1]!;
    let data = m[2]!.trim();
    // 去掉前后引号（如果整个值都带引号）
    if (data.startsWith('"') && data.endsWith('"') && data.length >= 2) {
      data = data.slice(1, -1);
    }
    if (!data) continue;
    const parsed = parseCommand(data);
    items.push({
      fingerprint: fingerprint({ source, source_path: sourcePath, name }),
      name,
      command: data,
      exe: parsed.exe,
      args: parsed.args,
      source,
      source_path: sourcePath,
      enabled: true, // 注册表 Run 项存在即视为启用；RunOnce 一次性也记启用
      risk: classifyRisk(name, parsed.exe),
      vendor: null,
      scanned_at: now,
    });
  }
  return items;
}
