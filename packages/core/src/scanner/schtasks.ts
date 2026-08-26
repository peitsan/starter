/**
 * 计划任务（Task Scheduler）扫描器 — schtasks.exe
 *
 * 与 Run/RunOnce 注册表项不同，计划任务可由任何用户/管理员自由创建，
 * 且触发器可以是"登录时/系统启动时/空闲时"，是除注册表启动管理器外的
 * 第二大持久化启动面（也是 PowerShell 定时脚本的常见落地方式）。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScannedItem } from './types.js';
import { fingerprint, parseCommand } from './command.js';

const execFileAsync = promisify(execFile);

/** 将 GBK Buffer 解码为 UTF-8 字符串（中文 Windows schtasks 输出用 GBK） */
export function decodeGbk(buf: Buffer): string {
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch {
    // fallback 兼容：部分 Node 版本可能不支持 gbk，用 utf8 凑合
    return buf.toString('utf8');
  }
}

/**
 * 简易 CSV 解析器（处理双引号包裹的字段和引号内的逗号）。
 * 不依赖第三方库，专为 schtasks.exe /fo CSV 输出设计。
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQ) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') {
        inQ = true;
      } else if (c === ',') {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
  }
  fields.push(cur.trim());
  return fields;
}

/** 与 schtasks /v /fo CSV 列索引对应的列名（verbose 格式，实测列序） */
const SCHTASKS_COL_INDEX = {
  HOST: 0,
  TASK_NAME: 1, // 形如 "\Microsoft\Windows\\.NET Framework\..."，本身含完整路径
  NEXT_RUN: 2,
  STATUS: 3,
  LOGON_MODE: 4,
  LAST_RUN: 5,
  LAST_RESULT: 6,
  AUTHOR: 7,
  TASK_TO_RUN: 8,
  START_IN: 9,
  COMMENT: 10,
  STATE: 11, // "Enabled" / "Disabled"
  IDLE_TIME: 12,
  POWER: 13,
  RUN_AS: 14,
  DELETE_IF: 15,
  STOP_IF: 16,
  SCHEDULE: 17,
  SCHEDULE_TYPE: 18, // "At logon time" / "At system startup" / "Daily" ...
} as const;

/** 判断该日程类型是否属于"开机启动"相关（兼容中英文系统） */
export function isStartupTrigger(type: string): boolean {
  const t = type.toLowerCase();
  const keyword =
    t.includes('logon') ||
    t.includes('登录') ||
    t.includes('登陆') || // 中文实际输出"登陆时"
    t.includes('system startup') ||
    t.includes('system startup time') ||
    t.includes('启动') || // 系统启动时 / 启动时
    t.includes('at idle') ||
    t.includes('on idle') ||
    t === 'idle' ||
    t.includes('空闲'); // 在空闲时间
  // 排除"每日/每周/一次性"等定时类（Daily/Weekly/One time 不在上述关键词里，天然被排除）
  return keyword;
}

/** 从任务路径/命令判断风险 */
export function classifyTaskRisk(
  taskName: string,
  taskToRun: string | null,
): 'critical' | 'normal' | 'recommend_off' {
  const tn = taskName.toLowerCase();
  const cmd = (taskToRun ?? '').toLowerCase();
  // 系统内置任务（Microsoft\Windows\... 或 %windir%\System32\Tasks\）标记为 critical
  if (tn.startsWith('\\microsoft\\windows\\')) return 'critical';
  if (cmd.startsWith('%windir%') || cmd.startsWith('%systemroot%')) return 'critical';
  if (cmd.includes('\\system32\\tasks\\')) return 'critical';
  // 常见的系统关键任务
  if (cmd.includes('\\windows\\system32\\')) return 'critical';
  // 正常任务（有明确厂商/路径）
  if (
    cmd &&
    (cmd.includes('\\program files\\') ||
      cmd.includes('\\program files (x86)\\') ||
      cmd.includes('\\appdata\\'))
  ) {
    return 'normal';
  }
  return 'recommend_off';
}

/** 判断任务是否启用（兼容中英文 state 值） */
export function isTaskEnabled(state: string): boolean {
  const s = state.toLowerCase();
  return s === 'enabled' || s === '已启用' || s === 'ready';
}

/**
 * 用 schtasks.exe 扫描计划任务，提取启动相关的任务（logon / system startup / idle）。
 *
 * 输出格式参考：
 *   "Folder","TaskName","Status","TaskType","Run As","Schedule Type","Start Time","Start Date","State","Last Run Time","Last Result","Author","Task To Run"
 *   "\Microsoft\Windows\\.NET Framework\","\.NET Framework NGEN v4.0.30319","Ready","","SYSTEM","At system startup","N/A","N/A","Enabled","8/26/2026 3:00:00 AM","0","Microsoft",""
 */
export async function scanTaskScheduler(): Promise<ScannedItem[]> {
  // 中文 Windows 下 schtasks 输出是 GBK，必须拿 buffer 再解码，否则乱码
  const { stdout } = await execFileAsync(
    'schtasks.exe',
    ['/query', '/v', '/fo', 'CSV', '/nh'],
    { encoding: 'buffer', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, // 任务列表可能很大
  );
  const text = decodeGbk(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
  const lines = text.split(/\r?\n/).filter(Boolean);
  const items: ScannedItem[] = [];
  const now = Date.now();

  for (const line of lines) {
    const fields = parseCsvLine(line);
    if (fields.length < 19) continue; // 不足 verbose 列数

    const taskName = fields[SCHTASKS_COL_INDEX.TASK_NAME] ?? '';
    const scheduleType = fields[SCHTASKS_COL_INDEX.SCHEDULE_TYPE] ?? '';
    const state = fields[SCHTASKS_COL_INDEX.STATE] ?? '';
    const taskToRun = fields[SCHTASKS_COL_INDEX.TASK_TO_RUN] ?? '';

    if (!isStartupTrigger(scheduleType)) continue;

    // TaskName 形如 "\Microsoft\Windows\....\Name"，\\ 的第一个是路径分隔符
    // 取最后一个 \ 后的部分作为显示名
    const name = taskName.replace(/\\+/g, '\\').replace(/^.*\\/, '').trim();
    // 完整路径作为 source_path
    const fullPath = taskName;
    const cmd = taskToRun || fullPath; // 如果无命令，至少用路径标识

    const parsed = parseCommand(cmd);
    items.push({
      fingerprint: fingerprint({
        source: 'TaskScheduler',
        source_path: fullPath,
        name,
      }),
      name,
      command: cmd,
      exe: parsed.exe,
      args: parsed.args,
      source: 'TaskScheduler',
      source_path: fullPath,
      enabled: isTaskEnabled(state),
      risk: classifyTaskRisk(fullPath, taskToRun),
      vendor: null,
      scanned_at: now,
    });
  }
  return items;
}
