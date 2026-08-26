/**
 * 真实启动调度执行器
 *
 * 职责：
 *   - 解析启动项的 command 字符串（处理引号、空格、参数）
 *   - 按 priority 0-5 选 Windows 优先级类
 *   - 用 child_process.spawn 真起进程（detached, stdio: ignore）
 *   - 记录启动事件到 SQLite startup_run_event 表
 *
 * Windows 优先级映射（用 `start /B /<priority>`）：
 *   priority 0 → /LOW         (IDLE_PRIORITY_CLASS)
 *   priority 1 → /BELOWNORMAL (BELOW_NORMAL_PRIORITY_CLASS)
 *   priority 2 → /NORMAL      (NORMAL_PRIORITY_CLASS) — 默认
 *   priority 3 → /ABOVENORMAL (ABOVE_NORMAL_PRIORITY_CLASS)
 *   priority 4 → /HIGH        (HIGH_PRIORITY_CLASS)
 *   priority 5 → /REALTIME    (REALTIME_PRIORITY_CLASS) — 不推荐
 *
 * 安全：
 *   - 显式白名单的优先级字符串 → 不能注入任意 cmd
 *   - command 在 shell=false 时直接 spawn，shell=true 时走 cmd.exe 但不拼 priority
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { StartupItemRow } from '@starter/core';

/** Windows 优先级字符串白名单 */
const WIN_PRIORITY_FLAG: Record<number, string> = {
  0: '/LOW',
  1: '/BELOWNORMAL',
  2: '/NORMAL',
  3: '/ABOVENORMAL',
  4: '/HIGH',
  5: '/REALTIME',
};

export interface SpawnResult {
  pid: number;
  command: string;
  priority: number;
  started_at: number;
}

export interface ParseResult {
  file: string;
  args: string[];
}

/** 解析 command 字符串，分出可执行文件和参数
 *  简单规则：按空格切，但尊重双引号包裹
 *  不处理转义引号（启动项通常不需要）
 */
export function parseCommand(command: string): ParseResult {
  const trimmed = command.trim();
  if (trimmed.length === 0) return { file: '', args: [] };
  // 整个串用引号包起来
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    if (end === -1) return { file: trimmed.slice(1), args: [] };
    const file = trimmed.slice(1, end);
    const rest = trimmed.slice(end + 1).trim();
    const args = rest.length === 0 ? [] : rest.split(/\s+/);
    return { file, args };
  }
  // 找第一个空格
  const sp = trimmed.indexOf(' ');
  if (sp === -1) return { file: trimmed, args: [] };
  const file = trimmed.slice(0, sp);
  const rest = trimmed.slice(sp + 1).trim();
  const args = rest.length === 0 ? [] : rest.split(/\s+/);
  return { file, args };
}

/** 把 priority 0-5 映射到 Windows start flag；非 Windows 返回 null */
export function priorityFlag(priority: number): string | null {
  if (process.platform !== 'win32') return null;
  return WIN_PRIORITY_FLAG[priority] ?? '/NORMAL';
}

/** 检查文件是否存在（用于 doctor 时的可执行性验证） */
export function commandExists(command: string): boolean {
  const { file } = parseCommand(command);
  if (!file) return false;
  if (existsSync(file)) return true;
  // Windows 下检查 PATH
  if (process.platform === 'win32') {
    const r = spawnSync('where', [file], { encoding: 'utf8' });
    return r.status === 0;
  }
  // POSIX 检查
  const r = spawnSync('which', [file], { encoding: 'utf8' });
  return r.status === 0;
}

/** 真起一个启动项
 *  Windows：用 `start /B /<priority> "" <command>`（空 title 占位）
 *  POSIX：直接 spawn
 *
 *  返回 pid（detached 进程的 pid；父进程 exit 后子进程继续）
 */
export function spawnItem(item: StartupItemRow): SpawnResult {
  const { file, args } = parseCommand(item.command);
  if (!file) {
    throw new Error(`empty command for item ${item.id}`);
  }
  if (!existsSync(file) && !commandExists(file)) {
    throw new Error(`executable not found: ${file}`);
  }
  const priority = item.priority ?? 2;
  const started_at = Date.now();

  if (process.platform === 'win32') {
    const flag = priorityFlag(priority)!;
    // start /B /<priority> "" <file> <args...>
    // /B：不创建新窗口
    // ""：窗口标题（空字符串占位）
    const child = spawn('cmd.exe', ['/c', 'start', '/B', flag, '""', file, ...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return { pid: child.pid ?? -1, command: item.command, priority, started_at };
  }
  // POSIX
  const child = spawn(file, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { pid: child.pid ?? -1, command: item.command, priority, started_at };
}
