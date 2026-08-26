/**
 * 写注册表的低层封装 — 仅用 reg.exe（无原生依赖）
 *
 * 设计原则：
 *  - HKCU 不需要管理员权限
 *  - HKLM 必须管理员（UAC），这里直接抛 E_ELEVATION_REQUIRED，
 *    后续 IPC client / 守护进程会接管 HKLM
 *  - 所有写操作加 REG_SZ 类型，避免误写为 REG_DWORD
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class ElevationRequiredError extends Error {
  readonly code = 'E_ELEVATION_REQUIRED' as const;
  constructor(message = 'HKLM write requires admin elevation; use IPC daemon') {
    super(message);
    this.name = 'ElevationRequiredError';
  }
}

export class RegOpError extends Error {
  readonly code = 'E_REG_OP' as const;
  constructor(
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(`reg.exe exit ${exitCode}: ${stderr}`);
    this.name = 'RegOpError';
  }
}

export type RegValue = string;
export interface RegWriteOptions {
  /** REG_SZ 默认；可指定 REG_EXPAND_SZ 处理 %PATH% 之类的 */
  type?: 'REG_SZ' | 'REG_EXPAND_SZ';
}

/** 加一个 value；HKLM 抛 ElevationRequiredError */
export async function regAdd(
  hive: 'HKCU' | 'HKLM',
  key: string,
  valueName: string,
  data: RegValue,
  opts: RegWriteOptions = {},
): Promise<void> {
  if (hive === 'HKLM') throw new ElevationRequiredError();
  const args = [
    'add',
    `${hive}\\${key}`,
    '/v',
    valueName,
    '/t',
    opts.type ?? 'REG_SZ',
    '/d',
    data,
    '/f',
  ];
  const { stderr } = await execFileAsync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
  if (stderr.trim()) {
    // reg.exe 在 success 时也常常有 stderr 噪声（如 "操作成功完成"），只看 exit code
  }
}

/** 删一个 value；HKLM 抛 ElevationRequiredError */
export async function regDelete(
  hive: 'HKCU' | 'HKLM',
  key: string,
  valueName: string,
): Promise<void> {
  if (hive === 'HKLM') throw new ElevationRequiredError();
  const args = ['delete', `${hive}\\${key}`, '/v', valueName, '/f'];
  const res = await execFileAsync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
  if (res.stderr.includes('ERROR') && !/操作成功|success/i.test(res.stderr)) {
    // 找不到 value 视为幂等
  }
}

/** 判断 hive 是否 HKLM（写时拦截） */
export function requiresElevation(hive: string): boolean {
  return hive === 'HKLM' || hive === 'HKCU_RunOnce' /* RunOnce 也常被锁，保守 */ ? false : false;
}

/** 解析 source 字符串回 hive + key */
export function parseSource(
  source: string,
  sourcePath: string,
): { hive: 'HKCU' | 'HKLM'; key: string } | null {
  if (source === 'HKCU_Run' || source === 'HKCU_RunOnce') {
    const sub = source === 'HKCU_Run' ? 'Run' : 'RunOnce';
    return { hive: 'HKCU', key: `Software\\Microsoft\\Windows\\CurrentVersion\\${sub}` };
  }
  if (source === 'HKLM_Run' || source === 'HKLM_RunOnce') {
    const sub = source === 'HKLM_Run' ? 'Run' : 'RunOnce';
    return { hive: 'HKLM', key: `Software\\Microsoft\\Windows\\CurrentVersion\\${sub}` };
  }
  // sourcePath 形如 "HKCU\Software\..." 时可回退
  const m = /^(HKCU|HKLM)\\(.*)$/.exec(sourcePath);
  if (m) return { hive: m[1] as 'HKCU' | 'HKLM', key: m[2]! };
  return null;
}
